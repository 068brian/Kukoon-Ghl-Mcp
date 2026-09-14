// Quick standalone test: confirms auth works and the shared mailbox can be
// read, without needing SharePoint/Excel wired up yet. Run with:
//   node scripts/test-mailbox.mjs
//
// This does NOT touch dist/ or src/ — it's a plain script so you can run it
// the moment .env is filled in, before doing a full build.
import { ConfidentialClientApplication } from "@azure/msal-node";
import "dotenv/config";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

const tenantId = process.env.AZURE_TENANT_ID;
const clientId = process.env.AZURE_CLIENT_ID;
const clientSecret = process.env.AZURE_CLIENT_SECRET;
const mailbox = process.env.SHARED_MAILBOX;

if (!tenantId || !clientId || !clientSecret || !mailbox) {
  console.error("Missing one of AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, SHARED_MAILBOX in .env");
  process.exit(1);
}

const msalClient = new ConfidentialClientApplication({
  auth: {
    clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    clientSecret,
  },
});

console.log(`Testing mailbox: ${mailbox}`);

try {
  console.log("1. Acquiring Graph API token...");
  const tokenResult = await msalClient.acquireTokenByClientCredential({
    scopes: ["https://graph.microsoft.com/.default"],
  });
  console.log("   Token acquired OK.\n");

  console.log("2. Listing 5 most recent emails in the mailbox...");
  const res = await fetch(
    `${GRAPH_BASE}/users/${encodeURIComponent(mailbox)}/messages?$top=5&$orderby=receivedDateTime desc&$select=id,subject,from,receivedDateTime,hasAttachments`,
    { headers: { Authorization: `Bearer ${tokenResult.accessToken}` } }
  );

  if (!res.ok) {
    const body = await res.text();
    console.error(`   FAILED: ${res.status} ${res.statusText}`);
    console.error(`   ${body}`);
    console.error("\n   If this is a 403, double check Mail.Read was granted admin consent.");
    process.exit(1);
  }

  const data = await res.json();
  console.log(`   Found ${data.value.length} email(s):\n`);
  for (const m of data.value) {
    console.log(`   - [${m.receivedDateTime}] "${m.subject}" from ${m.from?.emailAddress?.address} (attachments: ${m.hasAttachments})`);
  }
  console.log("\nMailbox read access is working.");
} catch (err) {
  console.error("FAILED:", err.message || err);
  process.exit(1);
}
