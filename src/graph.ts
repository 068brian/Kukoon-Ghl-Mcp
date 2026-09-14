import { getGraphToken } from "./auth";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// --- Config (dummy defaults so the connector runs before Souvik confirms
// the real SharePoint folder / Excel file — replace via env vars later) ---
const SHARED_MAILBOX = process.env.SHARED_MAILBOX || "receipts@REPLACE_ME.onmicrosoft.com";
const SHAREPOINT_SITE_ID = process.env.SHAREPOINT_SITE_ID || "DUMMY_SITE_ID";
const SHAREPOINT_FOLDER_PATH = process.env.SHAREPOINT_FOLDER_PATH || "/Clients/DUMMY_CLIENT/Receipts";
// If set, addresses the folder by its permanent Graph item ID instead of by
// path — this survives the folder being moved or renamed within the site.
// Path-based addressing (above) breaks silently on a move: Graph doesn't
// error, it just creates a fresh empty folder at the old path and starts
// saving there instead of following the real, moved folder. Prefer setting
// this once it's known; SHAREPOINT_FOLDER_PATH stays as a fallback for
// environments (like the throwaway test site) where it isn't set.
const SHAREPOINT_FOLDER_ITEM_ID = process.env.SHAREPOINT_FOLDER_ITEM_ID || "";
const EXCEL_ITEM_ID = process.env.EXCEL_ITEM_ID || "DUMMY_EXCEL_ITEM_ID";
const EXCEL_TABLE_NAME = process.env.EXCEL_TABLE_NAME || "DummyReceiptsTable";

async function graphFetch(path: string, options: RequestInit = {}) {
  const token = await getGraphToken();
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Graph API ${res.status} ${res.statusText} on ${path}: ${body}`);
  }
  // Some Graph calls (e.g. file upload) return the created resource as JSON;
  // 204s return no body.
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/**
 * Encodes a SharePoint drive path for use in Graph's `:/{path}:` addressing
 * syntax — each segment needs URL-encoding (spaces, etc.) but the forward
 * slashes between segments must stay literal. This was a real bug: the
 * real folder path has spaces in it ("Business/SR Perks/Client Data/...")
 * and raw spaces in a URL can cause the request to fail or hit the wrong
 * resource — the throwaway test site's path was empty, so this never
 * surfaced until pointed at the real folder.
 */
function encodeGraphPath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/**
 * Builds the Graph URL segment for uploading a file into the configured
 * folder. Prefers SHAREPOINT_FOLDER_ITEM_ID (survives the folder being
 * moved/renamed) over SHAREPOINT_FOLDER_PATH (breaks silently on a move).
 */
function folderUploadUrl(fileName: string): string {
  const encodedFileName = encodeURIComponent(fileName);
  if (SHAREPOINT_FOLDER_ITEM_ID) {
    return `${GRAPH_BASE}/sites/${SHAREPOINT_SITE_ID}/drive/items/${SHAREPOINT_FOLDER_ITEM_ID}:/${encodedFileName}:/content`;
  }
  const path = encodeGraphPath(`${SHAREPOINT_FOLDER_PATH}/${fileName}`);
  return `${GRAPH_BASE}/sites/${SHAREPOINT_SITE_ID}/drive/root:${path}:/content`;
}

/**
 * Builds the Graph URL for listing the configured folder's children (used
 * to work out the next free FY sequence number). Same item-ID-preferred
 * logic as folderUploadUrl.
 */
function folderChildrenUrl(): string {
  if (SHAREPOINT_FOLDER_ITEM_ID) {
    return `/sites/${SHAREPOINT_SITE_ID}/drive/items/${SHAREPOINT_FOLDER_ITEM_ID}/children?$select=name`;
  }
  const path = encodeGraphPath(SHAREPOINT_FOLDER_PATH || "");
  return `/sites/${SHAREPOINT_SITE_ID}/drive/root:${path}:/children?$select=name`;
}

export interface EmailSummary {
  id: string;
  subject: string;
  from: string;
  receivedDateTime: string;
  hasAttachments: boolean;
}

/** List recent emails in the shared mailbox, optionally filtered by a search term. */
export async function listReceiptEmails(search?: string, top = 25): Promise<EmailSummary[]> {
  const params = new URLSearchParams();
  params.set("$top", String(top));
  params.set("$select", "id,subject,from,receivedDateTime,hasAttachments");
  if (search) {
    // Graph API rejects $orderby combined with $search (400
    // SearchWithOrderBy) — $search already returns results ranked by
    // relevance, so we simply omit $orderby in that case.
    params.set("$search", `"${search}"`);
  } else {
    params.set("$orderby", "receivedDateTime desc");
  }

  const data = await graphFetch(
    `/users/${encodeURIComponent(SHARED_MAILBOX)}/messages?${params.toString()}`
  );

  return (data.value || []).map((m: any) => ({
    id: m.id,
    subject: m.subject,
    from: m.from?.emailAddress?.address || "",
    receivedDateTime: m.receivedDateTime,
    hasAttachments: m.hasAttachments,
  }));
}

export interface AttachmentSummary {
  id: string;
  name: string;
  contentType: string;
  size: number;
}

export async function listAttachments(messageId: string): Promise<AttachmentSummary[]> {
  const data = await graphFetch(
    `/users/${encodeURIComponent(SHARED_MAILBOX)}/messages/${messageId}/attachments?$select=id,name,contentType,size`
  );
  return data.value || [];
}

/** Returns base64 file content for a single attachment. */
export async function getAttachmentContent(messageId: string, attachmentId: string): Promise<{ name: string; contentType: string; contentBytes: string }> {
  const data = await graphFetch(
    `/users/${encodeURIComponent(SHARED_MAILBOX)}/messages/${messageId}/attachments/${attachmentId}`
  );
  return {
    name: data.name,
    contentType: data.contentType,
    contentBytes: data.contentBytes, // base64
  };
}

/**
 * Uploads a file (<4MB, fine for receipt screenshots) to the configured
 * SharePoint folder. Uses simple upload (PUT .../content) — switch to an
 * upload session for anything larger.
 */
export async function uploadReceiptToSharePoint(fileName: string, contentBytes: string, contentType: string): Promise<{ webUrl: string; id: string }> {
  const buffer = Buffer.from(contentBytes, "base64");

  const token = await getGraphToken();
  const res = await fetch(
    folderUploadUrl(fileName),
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": contentType || "application/octet-stream",
      },
      body: buffer,
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`SharePoint upload failed: ${res.status} ${res.statusText}: ${body}`);
  }
  const data = await res.json();
  return { webUrl: data.webUrl, id: data.id };
}

/**
 * Fetches an email attachment and uploads it straight to SharePoint,
 * entirely server-side. This is the function the MCP tool for saving
 * receipts should use — it deliberately never returns the raw file bytes
 * to the caller, because routing a binary payload through a model's own
 * context (fetch it as one tool call, retype/relay it as input to a next
 * tool call) is unreliable for anything beyond a few KB and outright
 * breaks for typical PDF/image sizes.
 */
export async function saveEmailAttachmentToSharePoint(
  messageId: string,
  attachmentId: string,
  fileNameOverride?: string
): Promise<{ webUrl: string; id: string; originalName: string; contentType: string }> {
  const attachment = await getAttachmentContent(messageId, attachmentId);
  const fileName = fileNameOverride || attachment.name;
  const uploaded = await uploadReceiptToSharePoint(fileName, attachment.contentBytes, attachment.contentType);
  return { ...uploaded, originalName: attachment.name, contentType: attachment.contentType };
}

/**
 * Computes the Australian financial year label for a given date, per the
 * convention Souvik confirmed: FY runs 1 Jul–30 Jun, and is named after the
 * year it ENDS in. So 15 Jun 2026 -> "FY26" (ends within FY 2025-26), and
 * 25 Jul 2026 -> "FY27" (starts FY 2026-27, ends June 2027).
 */
export function computeAustralianFYLabel(dateIso: string): string {
  const d = new Date(dateIso);
  if (isNaN(d.getTime())) {
    throw new Error(`computeAustralianFYLabel: "${dateIso}" is not a parseable date`);
  }
  const year = d.getFullYear();
  const month = d.getMonth() + 1; // 1-12
  const fyEndYear = month <= 6 ? year : year + 1;
  const shortYear = String(fyEndYear).slice(-2);
  return `FY${shortYear}`;
}

/**
 * Looks at what's already in the SharePoint folder to find the next unused
 * sequence number for a given FY label (e.g. for "FY26", if "FY26 - 1.pdf"
 * and "FY26 - 2.pdf" already exist, returns 3). Returns 1 if none exist yet.
 * This is checked against the actual folder contents rather than the Excel
 * log, since the folder is the source of truth for what filenames are taken.
 */
export async function getNextSequenceForFY(fyLabel: string): Promise<number> {
  const data = await graphFetch(folderChildrenUrl()).catch((err: any) => {
    // A brand-new/empty folder can 404 on :/children in some cases — treat
    // that as "no existing files" rather than a hard failure.
    if (String(err.message || "").includes("404")) return { value: [] };
    throw err;
  });

  const pattern = new RegExp(`^${fyLabel} - (\\d+)`, "i");
  let max = 0;
  for (const item of data.value || []) {
    const match = pattern.exec(item.name || "");
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > max) max = n;
    }
  }
  return max + 1;
}

/**
 * Converts an image buffer (JPEG or PNG) into a single-page PDF, so scanned
 * receipt screenshots can be saved with the same .pdf naming convention as
 * PDF invoices. Uses pdf-lib, which needs to know the image format to pick
 * the right embed method.
 */
async function convertImageBufferToPdf(buffer: Buffer, contentType: string): Promise<Buffer> {
  const { PDFDocument } = require("pdf-lib");
  const pdfDoc = await PDFDocument.create();
  const isPng = contentType.includes("png");
  const image = isPng ? await pdfDoc.embedPng(buffer) : await pdfDoc.embedJpg(buffer);
  const page = pdfDoc.addPage([image.width, image.height]);
  page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

/**
 * The full "save as numbered PDF" flow Souvik asked for: fetch the
 * attachment, convert it to PDF if it's an image (PDFs pass through
 * unchanged), work out the Australian FY from the given receipt date,
 * find the next free sequence number for that FY by checking the real
 * folder contents, and upload under a name like "FY26 - 3.pdf".
 *
 * receiptDateIso should be the date ON THE RECEIPT (read via
 * view_attachment_image or read_pdf_attachment first) — NOT the email's
 * received date, which is often different from the purchase date.
 */
export async function saveReceiptAsNumberedPdf(
  messageId: string,
  attachmentId: string,
  receiptDateIso: string
): Promise<{ webUrl: string; id: string; fileName: string; originalName: string }> {
  const attachment = await getAttachmentContent(messageId, attachmentId);
  const buffer = Buffer.from(attachment.contentBytes, "base64");

  const isPdf = attachment.contentType === "application/pdf" || attachment.name.toLowerCase().endsWith(".pdf");
  const isImage = attachment.contentType.startsWith("image/");
  if (!isPdf && !isImage) {
    throw new Error(`Attachment "${attachment.name}" is ${attachment.contentType} — only PDF and image (JPEG/PNG) attachments can be converted/saved by this tool.`);
  }

  const pdfBuffer = isPdf ? buffer : await convertImageBufferToPdf(buffer, attachment.contentType);
  const pdfBase64 = pdfBuffer.toString("base64");

  const fyLabel = computeAustralianFYLabel(receiptDateIso);
  const sequence = await getNextSequenceForFY(fyLabel);
  const fileName = `${fyLabel} - ${sequence}.pdf`;

  const uploaded = await uploadReceiptToSharePoint(fileName, pdfBase64, "application/pdf");
  return { ...uploaded, fileName, originalName: attachment.name };
}

/**
 * Finds the index of the first header matching a keyword, or -1.
 */
function findColumnIndex(headers: string[], keyword: string): number {
  return headers.findIndex((h) => h.toLowerCase().includes(keyword));
}

/**
 * Converts an ISO date string to an Excel serial date number (days since
 * 1899-12-30, Excel's epoch quirks included), so it can be compared against
 * a date cell Excel already stored as a serial number rather than text.
 */
function isoDateToExcelSerial(dateIso: string): number {
  const d = new Date(dateIso);
  const epoch = Date.UTC(1899, 11, 30);
  return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - epoch) / 86400000);
}

/**
 * Checks whether an existing table row's date cell (which may be a numeric
 * Excel serial or a date-like string, depending on how it was entered)
 * matches the given ISO date.
 */
function rowDateMatches(cellValue: any, dateIso: string): boolean {
  if (cellValue == null) return false;
  if (typeof cellValue === "number") {
    return cellValue === isoDateToExcelSerial(dateIso);
  }
  const parsed = new Date(String(cellValue));
  const target = new Date(dateIso);
  return (
    !isNaN(parsed.getTime()) &&
    parsed.getFullYear() === target.getFullYear() &&
    parsed.getMonth() === target.getMonth() &&
    parsed.getDate() === target.getDate()
  );
}

/**
 * Looks through the existing Excel rows for one that already matches this
 * vendor + date (and amount, if given) — used to stop the same receipt
 * being saved/logged twice. Matching on vendor+date alone is enough to
 * flag a likely duplicate; amount is an extra check when available.
 */
async function findExistingDuplicateRow(
  columns: string[],
  vendor: string,
  dateIso: string,
  amountInclGst?: number
): Promise<any[] | null> {
  const rows = await getExcelTableRows();
  const vendorIdx = findColumnIndex(columns, "vendor");
  const dateIdx = findColumnIndex(columns, "date");
  const amountIdx = findColumnIndex(columns, "amount");

  for (const row of rows) {
    const vendorMatches = vendorIdx >= 0 && String(row[vendorIdx] || "").trim().toLowerCase() === vendor.trim().toLowerCase();
    const dateMatches = dateIdx >= 0 && rowDateMatches(row[dateIdx], dateIso);
    if (!vendorMatches || !dateMatches) continue;

    if (amountInclGst != null && amountIdx >= 0) {
      const rowAmount = Number(row[amountIdx]);
      if (!isNaN(rowAmount) && Math.abs(rowAmount - amountInclGst) > 0.01) continue; // amount given but doesn't match — not this one
    }
    return row; // vendor + date (+ amount if checked) all match
  }
  return null;
}

/**
 * Matches the real Excel headers to known semantic fields by keyword, so
 * the combined save+log tool can build a correctly-ordered row without
 * hardcoding exact header text (which could change). Returns null for any
 * header that doesn't match a known field — those cells are left blank
 * rather than filled with a guess.
 */
function matchColumnToField(header: string, fields: {
  fileName: string;
  dateIso: string;
  vendor: string;
  amountInclGst?: number;
  gst?: number;
  net?: number;
  category?: string;
}): string | number {
  const h = header.toLowerCase();
  if (h.includes("file")) return fields.fileName;
  if (h.includes("date")) return fields.dateIso;
  if (h.includes("vendor")) return fields.vendor;
  if (h.includes("amount")) return fields.amountInclGst ?? "";
  if (h.includes("net")) return fields.net ?? "";
  if (h.includes("gst")) return fields.gst ?? "";
  if (h.includes("categ")) return fields.category ?? "";
  return "";
}

/**
 * Saves a receipt AND logs it to Excel in one call, using the SAME filename
 * variable for both — this exists specifically because splitting save and
 * log into two separate tool calls let a real bug happen: the model saved
 * a file as "FY26 - 2.pdf" but then typed the ORIGINAL attachment name
 * ("8957.jpeg") into the Excel row's File Name column, because nothing
 * forced those two values to match. Here, there is only one fileName
 * variable, computed once, used in both places — mismatch is structurally
 * impossible, not just discouraged by instructions.
 *
 * ALSO checks for an existing matching row (same vendor + date, and amount
 * if given) BEFORE saving or logging anything — this is automatic and does
 * not depend on the caller remembering to check first. A real duplicate
 * (same receipt saved twice under FY27 - 1 and FY27 - 2) happened when this
 * check didn't exist yet.
 */
export async function saveAndLogReceipt(
  messageId: string,
  attachmentId: string,
  receiptDateIso: string,
  fields: { vendor: string; amountInclGst?: number; gst?: number; net?: number; category?: string }
): Promise<{ skipped: boolean; reason?: string; existingRow?: any[]; fileName?: string; webUrl?: string; row?: (string | number)[]; columns: string[] }> {
  const columns = await getExcelTableColumns();

  // Check BEFORE doing any writes — a duplicate here means neither the
  // SharePoint upload nor the Excel row-add should happen at all.
  const existing = await findExistingDuplicateRow(columns, fields.vendor, receiptDateIso, fields.amountInclGst);
  if (existing) {
    return {
      skipped: true,
      reason: `A row already exists for vendor "${fields.vendor}" on ${receiptDateIso} — treated as a duplicate, so nothing was saved or logged. If this is genuinely a different receipt (e.g. two separate purchases from the same vendor on the same day), say so explicitly and it can be logged deliberately.`,
      existingRow: existing,
      columns,
    };
  }

  const saved = await saveReceiptAsNumberedPdf(messageId, attachmentId, receiptDateIso);

  // Souvik's own existing rows log the name WITHOUT the extension (e.g.
  // "FY27 - 1", not "FY27 - 1.pdf") — this strips it for the Excel cell
  // only, derived from the one real fileName so it still can't diverge
  // from what's actually on disk (which does need its .pdf extension).
  const displayFileName = saved.fileName.replace(/\.pdf$/i, "");

  const row = columns.map((header) =>
    matchColumnToField(header, {
      fileName: displayFileName,
      dateIso: receiptDateIso,
      vendor: fields.vendor,
      amountInclGst: fields.amountInclGst,
      gst: fields.gst,
      net: fields.net,
      category: fields.category,
    })
  );

  await addReceiptRow(row);
  return { skipped: false, fileName: saved.fileName, webUrl: saved.webUrl, row, columns };
}

/**
 * Extracts plain text from a PDF attachment (e.g. a PDF receipt/invoice), so
 * vendor/date/amount details can be read the same way image receipts are
 * read visually. Uses pdf-parse, which works well for normal text-based
 * PDFs; a scanned/image-only PDF would still come back with little or no
 * text and would need OCR instead — a known gap, not silently wrong data.
 */
export async function extractPdfText(messageId: string, attachmentId: string): Promise<{ name: string; text: string }> {
  // pdf-parse v2 uses a class-based API (PDFParse.getText()), not the old
  // v1 function-call style — required inline rather than as a top-level
  // import so this heavy dependency only loads when actually needed.
  const { PDFParse } = require("pdf-parse");
  const attachment = await getAttachmentContent(messageId, attachmentId);
  const buffer = Buffer.from(attachment.contentBytes, "base64");
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  return { name: attachment.name, text: result.text };
}

/**
 * Reads the configured Excel table's actual header row, so callers never
 * have to guess column order. This exists because guessing produced a real
 * bug: a test row landed with amount under the wrong header entirely.
 */
export async function getExcelTableColumns(): Promise<string[]> {
  const data = await graphFetch(
    `/sites/${SHAREPOINT_SITE_ID}/drive/items/${EXCEL_ITEM_ID}/workbook/tables/${EXCEL_TABLE_NAME}/headerRowRange`
  );
  const row = (data.values && data.values[0]) || [];
  return row.map((v: any) => String(v));
}

/** Reads back all current rows in the configured Excel table, for verification. */
export async function getExcelTableRows(): Promise<any[][]> {
  const data = await graphFetch(
    `/sites/${SHAREPOINT_SITE_ID}/drive/items/${EXCEL_ITEM_ID}/workbook/tables/${EXCEL_TABLE_NAME}/rows`
  );
  return (data.value || []).map((r: any) => r.values[0]);
}

/**
 * Appends a row to the configured Excel table. `values` must match the
 * table's column order exactly — confirm the real column order with Souvik
 * before wiring this up to production data.
 */
export async function addReceiptRow(values: (string | number)[]): Promise<void> {
  await graphFetch(
    `/sites/${SHAREPOINT_SITE_ID}/drive/items/${EXCEL_ITEM_ID}/workbook/tables/${EXCEL_TABLE_NAME}/rows/add`,
    {
      method: "POST",
      body: JSON.stringify({ values: [values] }),
    }
  );
}
