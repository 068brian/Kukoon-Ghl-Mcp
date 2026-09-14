// Tests PDF text extraction directly against a real attachment in the
// mailbox, without going through Claude at all. Fast way to confirm the fix
// actually works before asking Souvik to retry.
//
// Run with: node scripts/test-pdf-extraction.mjs
import { ConfidentialClientApplication } from "@azure/msal-node";
import "dotenv/config";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const { AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, SHARED_MAILBOX } = process.env;

const msalClient = new ConfidentialClientApplication({
  auth: {
    clientId: AZURE_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${AZURE_TENANT_ID}`,
    clientSecret: AZURE_CLIENT_SECRET,
  },
});

try {
  console.log("1. Acquiring token...");
  const result = await msalClient.acquireTokenByClientCredential({ scopes: ["https://graph.microsoft.com/.default"] });
  const token = result.accessToken;
  console.log("   OK\n");

  console.log("2. Finding a PharmaCare email with a PDF attachment...");
  const res = await fetch(
    `${GRAPH_BASE}/users/${encodeURIComponent(SHARED_MAILBOX)}/messages?$top=25&$orderby=receivedDateTime desc&$select=id,subject,hasAttachments`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const messages = await res.json();
  const target = messages.value.find((m) => m.hasAttachments && m.subject.includes("PharmaCare"));
  if (!target) throw new Error("No PharmaCare email found in the most recent 25 messages.");
  console.log(`   Using: "${target.subject}"\n`);

  console.log("3. Getting its attachment...");
  const attRes = await fetch(
    `${GRAPH_BASE}/users/${encodeURIComponent(SHARED_MAILBOX)}/messages/${target.id}/attachments`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const attachments = await attRes.json();
  const attachment = attachments.value[0];
  console.log(`   Found: "${attachment.name}"\n`);

  console.log("4. Fetching full attachment content...");
  const fullRes = await fetch(
    `${GRAPH_BASE}/users/${encodeURIComponent(SHARED_MAILBOX)}/messages/${target.id}/attachments/${attachment.id}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const full = await fullRes.json();
  console.log(`   Got ${full.contentBytes.length} base64 chars\n`);

  console.log("5. Extracting PDF text...");
  const { PDFParse } = await import("pdf-parse");
  const buffer = Buffer.from(full.contentBytes, "base64");
  const parser = new PDFParse({ data: buffer });
  const parsed = await parser.getText();

  console.log("--- EXTRACTED TEXT ---");
  console.log(parsed.text);
  console.log("--- END ---\n");

  if (parsed.text && parsed.text.trim().length > 0) {
    console.log("SUCCESS: PDF text extraction is working.");
  } else {
    console.log("WARNING: extraction returned empty text — this PDF may be scanned/image-only.");
  }
} catch (err) {
  console.error("FAILED:", err.message || err);
  process.exit(1);
}
