import { ConfidentialClientApplication } from "@azure/msal-node";

// App-only (client credentials) auth — required because this connector reads
// a SHARED mailbox with no interactive user signed in. This mirrors the
// pattern used for the other client connectors (ms365-mcp, srperks-xero-mcp)
// but is a SEPARATE Azure AD app registration, so it can't touch anything
// those connectors already have access to.

// .trim() guards against a trailing newline/space sneaking in via whatever
// set the environment variable (copy-paste, a platform's variable editor,
// etc.) — MSAL's validation is strict and a stray whitespace character is
// enough to make it treat the credential as missing.
const tenantId = (process.env.AZURE_TENANT_ID || "").trim();
const clientId = (process.env.AZURE_CLIENT_ID || "").trim();
const clientSecret = (process.env.AZURE_CLIENT_SECRET || "").trim();

// Log presence/length only — never the actual secret value — so this is
// safe to leave in and safe to paste into chat/logs for debugging.
console.log("[auth] AZURE_TENANT_ID present:", !!tenantId, "length:", tenantId.length);
console.log("[auth] AZURE_CLIENT_ID present:", !!clientId, "length:", clientId.length);
console.log("[auth] AZURE_CLIENT_SECRET present:", !!clientSecret, "length:", clientSecret.length);

if (!tenantId || !clientId || !clientSecret) {
  throw new Error(
    "Missing required Azure AD env var(s). Check AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET are all set in the deployment environment (see log lines above for which one is empty)."
  );
}

const msalClient = new ConfidentialClientApplication({
  auth: {
    clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    clientSecret,
  },
});

let cachedToken: { value: string; expiresAt: number } | null = null;

/**
 * Returns a valid Graph API access token, refreshing it if it's expired
 * or about to expire (60s buffer).
 */
export async function getGraphToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) {
    return cachedToken.value;
  }

  const result = await msalClient.acquireTokenByClientCredential({
    scopes: ["https://graph.microsoft.com/.default"],
  });

  if (!result?.accessToken) {
    throw new Error("Failed to acquire Graph API token — check AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET and that admin consent was granted.");
  }

  cachedToken = {
    value: result.accessToken,
    expiresAt: result.expiresOn ? result.expiresOn.getTime() : now + 55 * 60_000,
  };

  return cachedToken.value;
}
