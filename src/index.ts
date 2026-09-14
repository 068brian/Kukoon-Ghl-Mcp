import "dotenv/config";
import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  listReceiptEmails,
  listAttachments,
  getAttachmentContent,
  saveEmailAttachmentToSharePoint,
  saveReceiptAsNumberedPdf,
  saveAndLogReceipt,
  extractPdfText,
  getExcelTableColumns,
  getExcelTableRows,
  addReceiptRow,
} from "./graph";

function buildServer() {
  const server = new McpServer({
    name: "receipt-automation-mcp",
    version: "1.0.0",
  });

  server.registerTool(
    "search_receipt_emails",
    {
      title: "Search receipt emails",
      description:
        "List recent emails in the shared receipts mailbox, optionally filtered by a search term (e.g. sender name or subject keyword). Use this first to find the email containing a receipt screenshot. IMPORTANT: the 'hasAttachments' field in the result is UNRELIABLE for this mailbox — it has been observed to say false on emails that do have a real attachment. Never skip an email based on hasAttachments alone; call list_email_attachments to check for real.",
      inputSchema: {
        search: z.string().optional().describe("Optional search term, e.g. a client name"),
        top: z.number().optional().describe("Max results, default 25"),
      },
    },
    async ({ search, top }) => {
      const emails = await listReceiptEmails(search, top);
      return {
        content: [
          {
            type: "text",
            text:
              "NOTE: 'hasAttachments' below is unreliable for this mailbox — it can say false even when a real attachment exists. Call list_email_attachments to check, don't trust this field alone.\n\n" +
              JSON.stringify(emails, null, 2),
          },
        ],
      };
    }
  );

  server.registerTool(
    "list_email_attachments",
    {
      title: "List email attachments",
      description: "List attachments (name, type, size) on a specific email. Call this before view_attachment_image, read_pdf_attachment, or save_email_attachment_to_sharepoint — and call it regardless of what the email's hasAttachments field said, since that field is known to be unreliable for this mailbox.",
      inputSchema: {
        messageId: z.string().describe("The email's id, from search_receipt_emails"),
      },
    },
    async ({ messageId }) => {
      const attachments = await listAttachments(messageId);
      return { content: [{ type: "text", text: JSON.stringify(attachments, null, 2) }] };
    }
  );

  server.registerTool(
    "view_attachment_image",
    {
      title: "View attachment image",
      description:
        "View an email attachment's content — ONLY for reading/inspecting an image (e.g. to read the vendor/date/amount off a receipt screenshot before logging it). For PDF attachments, use read_pdf_attachment instead. This does NOT return usable data for PDFs or other non-image types, and its output must NOT be used as input to save_email_attachment_to_sharepoint — that tool fetches and saves the file itself server-side.",
      inputSchema: {
        messageId: z.string(),
        attachmentId: z.string(),
      },
    },
    async ({ messageId, attachmentId }) => {
      const attachment = await getAttachmentContent(messageId, attachmentId);
      if (attachment.contentType.startsWith("image/")) {
        return {
          content: [
            {
              type: "image",
              data: attachment.contentBytes,
              mimeType: attachment.contentType,
            },
          ],
        };
      }
      const isPdf = attachment.contentType === "application/pdf" || attachment.name.toLowerCase().endsWith(".pdf");
      return {
        content: [
          {
            type: "text",
            text: isPdf
              ? `Attachment "${attachment.name}" is a PDF, not an image — use read_pdf_attachment instead to extract its text.`
              : `Attachment "${attachment.name}" is ${attachment.contentType}, which isn't an image or a PDF, so this connector can't read its contents automatically. You can still save it to SharePoint with save_email_attachment_to_sharepoint, but log Excel values only from what you can otherwise verify (e.g. the email body) — do not invent/estimate values.`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "read_pdf_attachment",
    {
      title: "Read PDF attachment",
      description:
        "Extract the text content of a PDF email attachment (e.g. a PDF invoice/receipt/statement), so vendor/date/amount details can be read from it before logging to Excel. Works well for normal text-based PDFs. If a PDF is a scanned image with no embedded text, the extracted text will be empty or near-empty — in that case, say so rather than guessing values.",
      inputSchema: {
        messageId: z.string(),
        attachmentId: z.string(),
      },
    },
    async ({ messageId, attachmentId }) => {
      const result = await extractPdfText(messageId, attachmentId);
      return {
        content: [
          {
            type: "text",
            text: result.text && result.text.trim().length > 0
              ? `Extracted text from "${result.name}":\n\n${result.text}`
              : `"${result.name}" produced no extractable text — it's likely a scanned/image-only PDF, which this connector can't read automatically. Don't guess at values; save the file and flag that the amount needs manual entry.`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "save_email_attachment_to_sharepoint",
    {
      title: "Save email attachment to SharePoint",
      description:
        "Fetch an email attachment and upload it directly to the configured SharePoint client folder AS-IS (original filename, original format), entirely server-side. For the normal receipt workflow, prefer save_receipt_as_numbered_pdf instead, which also converts images to PDF and applies the FY naming convention. Use this plain version only when you specifically need the original file unconverted.",
      inputSchema: {
        messageId: z.string().describe("The email's id"),
        attachmentId: z.string().describe("The attachment's id, from list_email_attachments"),
        fileName: z.string().optional().describe("Optional override for the saved file name; defaults to the attachment's original name"),
      },
    },
    async ({ messageId, attachmentId, fileName }) => {
      const result = await saveEmailAttachmentToSharePoint(messageId, attachmentId, fileName);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "save_and_log_receipt",
    {
      title: "Save and log receipt (all-in-one)",
      description:
        "THE PREFERRED TOOL for the normal receipt workflow — saves the receipt as a correctly FY-numbered PDF AND logs it to the Excel table in one call, guaranteeing the saved filename and the Excel row's File Name column always match exactly (they cannot diverge, because this tool computes the filename once and uses it in both places). AUTOMATICALLY checks for an existing row with the same vendor + date before doing anything — if found, it skips both the save and the log entirely (returns skipped: true with the existing row) rather than creating a duplicate file/row. A real duplicate (same receipt saved twice as FY27 - 1 and FY27 - 2) happened before this check existed. Prefer this over calling save_receipt_as_numbered_pdf and add_receipt_row separately. Column matching is automatic (by keyword: date/vendor/amount/gst/net/category/file) — you don't need to know the exact column order. SAFETY: this mailbox holds receipts for MULTIPLE different clients, but this tool always saves/logs into ONE specific client's folder+table (configured server-side) — only use this on a receipt you've confirmed belongs to that client.",
      inputSchema: {
        messageId: z.string().describe("The email's id"),
        attachmentId: z.string().describe("The attachment's id, from list_email_attachments"),
        receiptDate: z.string().describe("The date shown on the receipt itself (ISO YYYY-MM-DD), not the email's received date"),
        vendor: z.string().describe("Vendor/business name as shown on the receipt"),
        amountInclGst: z.number().optional().describe("Total amount including GST, if shown on the receipt"),
        gst: z.number().optional().describe("GST amount, if shown/calculable from the receipt — leave unset if not stated, do not guess"),
        net: z.number().optional().describe("Net amount (excl. GST), if shown/calculable — leave unset if not stated, do not guess"),
        category: z.string().optional().describe("Expense category, if it can be reasonably inferred (e.g. 'Uniforms/Workwear') — leave unset if unclear"),
      },
    },
    async ({ messageId, attachmentId, receiptDate, vendor, amountInclGst, gst, net, category }) => {
      const result = await saveAndLogReceipt(messageId, attachmentId, receiptDate, { vendor, amountInclGst, gst, net, category });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "save_receipt_as_numbered_pdf",
    {
      title: "Save receipt as numbered PDF (FY naming)",
      description:
        "Saves a receipt attachment to SharePoint as a PDF, named using the Australian financial year convention: 'FY26 - 1.pdf', 'FY26 - 2.pdf', etc. PREFER save_and_log_receipt INSTEAD for the normal workflow — it does this same save AND the Excel logging together, guaranteeing the filename matches between the two. Only use this standalone version if you specifically need to save without logging. FY runs 1 Jul-30 Jun and is named after the year it ends in (a 15 Jun 2026 receipt is FY26; a 25 Jul 2026 receipt is FY27). Image attachments (JPEG/PNG) are automatically converted to PDF; PDF attachments are used as-is. The sequence number is picked automatically based on what's already in the folder for that FY — do not compute or guess the filename yourself. IMPORTANT: pass the date ON THE RECEIPT ITSELF (read it first via view_attachment_image or read_pdf_attachment), not the email's received date — those often differ. SAFETY: this mailbox holds receipts for MULTIPLE different clients, but this tool always saves into ONE specific client's folder (configured server-side). Only use this on a receipt you've confirmed actually belongs to that client — if the vendor/context doesn't clearly match, ask the user before saving rather than assuming.",
      inputSchema: {
        messageId: z.string().describe("The email's id"),
        attachmentId: z.string().describe("The attachment's id, from list_email_attachments"),
        receiptDate: z.string().describe("The date shown on the receipt itself, as an ISO date (YYYY-MM-DD)"),
      },
    },
    async ({ messageId, attachmentId, receiptDate }) => {
      const result = await saveReceiptAsNumberedPdf(messageId, attachmentId, receiptDate);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "get_excel_table_columns",
    {
      title: "Get Excel table columns",
      description:
        "Get the exact column names, in order, for the configured Excel table. ALWAYS call this before add_receipt_row (at least once per conversation) to know the correct column order — never guess column order from context or from what seems logical. Guessing has previously caused a real bug where values landed under the wrong headers.",
      inputSchema: {},
    },
    async () => {
      const columns = await getExcelTableColumns();
      return { content: [{ type: "text", text: JSON.stringify(columns, null, 2) }] };
    }
  );

  server.registerTool(
    "get_excel_table_rows",
    {
      title: "Get Excel table rows",
      description: "Read back all current rows in the configured Excel table — use this to verify a row actually landed correctly after add_receipt_row, or to check current contents before adding.",
      inputSchema: {},
    },
    async () => {
      const rows = await getExcelTableRows();
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    }
  );

  server.registerTool(
    "add_receipt_row",
    {
      title: "Add receipt row to Excel",
      description:
        "Append a row of extracted receipt details to the configured Excel table. PREFER save_and_log_receipt INSTEAD for the normal workflow — it saves the file AND logs the row together with a guaranteed-matching filename. Only use this standalone version for logging without saving a file. The values array MUST be in the exact order returned by get_excel_table_columns — call that tool first if you haven't already this conversation. Do not guess column order. SAFETY: this mailbox holds receipts for MULTIPLE different clients, but this tool always logs into ONE specific client's tracker (configured server-side). Only log a receipt you've confirmed actually belongs to that client.",
      inputSchema: {
        values: z.array(z.union([z.string(), z.number()])).describe("Row values, in the exact order returned by get_excel_table_columns"),
      },
    },
    async ({ values }) => {
      await addReceiptRow(values);
      return { content: [{ type: "text", text: "Row added." }] };
    }
  );

  return server;
}

const app = express();
app.use(express.json());

const transports: Record<string, StreamableHTTPServerTransport> = {};

app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport = sessionId ? transports[sessionId] : undefined;

  if (!transport && isInitializeRequest(req.body)) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports[id] = transport!;
      },
    });
    const server = buildServer();
    await server.connect(transport);
  }

  if (!transport) {
    res.status(400).json({ error: "No valid session. Send an initialize request first." });
    return;
  }

  await transport.handleRequest(req, res, req.body);
});

app.get("/health", (_req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`receipt-automation-mcp listening on port ${PORT}`);
});
