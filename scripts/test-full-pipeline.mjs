// Full end-to-end test against the TEST site/table: finds a real email with
// an attachment, uploads the attachment to SharePoint, and adds a row to the
// Excel table. Safe to run repeatedly — it only touches the throwaway test
// site, never Souvik's real folder/file (those aren't configured yet).
//
// Run with: node scripts/test-full-pipeline.mjs
import { ConfidentialClientApplication } from "@azure/msal-node";
import "dotenv/config";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

const { AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, SHARED_MAILBOX, SHAREPOINT_SITE_ID, SHAREPOINT_FOLDER_PATH, EXCEL_ITEM_ID, EXCEL_TABLE_NAME } = process.env;

const msalClient = new ConfidentialClientApplication({
  auth: {
    clientId: AZURE_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${AZURE_TENANT_ID}`,
    clientSecret: AZURE_CLIENT_SECRET,
  },
});

let token;
async function graphFetch(path, options = {}) {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} on ${path}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

try {
  console.log("1. Acquiring token...");
  const result = await msalClient.acquireTokenByClientCredential({ scopes: ["https://graph.microsoft.com/.default"] });
  token = result.accessToken;
  console.log("   OK\n");

  console.log("2. Finding an email with an attachment...");
  const messages = await graphFetch(
    `/users/${encodeURIComponent(SHARED_MAILBOX)}/messages?$top=10&$orderby=receivedDateTime desc&$select=id,subject,hasAttachments`
  );
  const target = messages.value.find((m) => m.hasAttachments);
  if (!target) throw new Error("No recent email with attachments found to test with.");
  console.log(`   Using: "${target.subject}"\n`);

  console.log("3. Listing its attachments...");
  const attachments = await graphFetch(`/users/${encodeURIComponent(SHARED_MAILBOX)}/messages/${target.id}/attachments`);
  const attachment = attachments.value[0];
  console.log(`   Found: "${attachment.name}" (${attachment.contentType})\n`);

  console.log("4. Fetching attachment content...");
  const full = await graphFetch(`/users/${encodeURIComponent(SHARED_MAILBOX)}/messages/${target.id}/attachments/${attachment.id}`);
  console.log(`   Got ${full.contentBytes.length} base64 chars\n`);

  console.log("5. Uploading to test SharePoint site...");
  const testFileName = `pipeline-test-${Date.now()}-${full.name}`;
  const path = `${SHAREPOINT_FOLDER_PATH || ""}/${testFileName}`;
  const buffer = Buffer.from(full.contentBytes, "base64");
  const uploadRes = await fetch(`${GRAPH_BASE}/sites/${SHAREPOINT_SITE_ID}/drive/root:${path}:/content`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": full.contentType || "application/octet-stream" },
    body: buffer,
  });
  if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
  const uploaded = await uploadRes.json();
  console.log(`   Uploaded: ${uploaded.webUrl}\n`);

  console.log("6. Adding a row to the test Excel table...");
  await graphFetch(`/sites/${SHAREPOINT_SITE_ID}/drive/items/${EXCEL_ITEM_ID}/workbook/tables/${EXCEL_TABLE_NAME}/rows/add`, {
    method: "POST",
    body: JSON.stringify({
      values: [[
        new Date().toISOString().slice(0, 10),
        "Pipeline Test Vendor",
        target.subject.slice(0, 30),
        123.45,
        testFileName,
      ]],
    }),
  });
  console.log("   Row added.\n");

  console.log("ALL STEPS SUCCEEDED. The full pipeline works end-to-end against the test site.");
} catch (err) {
  console.error("FAILED:", err.message || err);
  process.exit(1);
}
