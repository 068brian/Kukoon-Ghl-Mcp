// Lists files in the configured SharePoint site/drive, using the app's own
// client-credential auth (the same one that already works for mail).
// Run with: node scripts/list-site-files.mjs
import { ConfidentialClientApplication } from "@azure/msal-node";
import "dotenv/config";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

const tenantId = process.env.AZURE_TENANT_ID;
const clientId = process.env.AZURE_CLIENT_ID;
const clientSecret = process.env.AZURE_CLIENT_SECRET;
const siteId = process.env.SHAREPOINT_SITE_ID;

if (!tenantId || !clientId || !clientSecret || !siteId) {
  console.error("Missing one of AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, SHAREPOINT_SITE_ID in .env");
  process.exit(1);
}

const msalClient = new ConfidentialClientApplication({
  auth: {
    clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    clientSecret,
  },
});

try {
  console.log("Acquiring token...");
  const tokenResult = await msalClient.acquireTokenByClientCredential({
    scopes: ["https://graph.microsoft.com/.default"],
  });
  console.log("Token OK.\n");

  console.log(`Listing files in site: ${siteId}\n`);
  const res = await fetch(`${GRAPH_BASE}/sites/${siteId}/drive/root/children`, {
    headers: { Authorization: `Bearer ${tokenResult.accessToken}` },
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`FAILED: ${res.status} ${res.statusText}`);
    console.error(body);
    console.error("\nIf this is a 403/404, the Sites.Selected grant may not have gone through correctly, or the site ID is wrong.");
    process.exit(1);
  }

  const data = await res.json();
  console.log(`Found ${data.value.length} item(s):\n`);
  for (const item of data.value) {
    console.log(`- "${item.name}"`);
    console.log(`  id: ${item.id}`);
    console.log("");
  }
} catch (err) {
  console.error("FAILED:", err.message || err);
  process.exit(1);
}
