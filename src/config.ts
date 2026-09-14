/**
 * Central config. The token is read once here from process.env and never
 * logged, returned to a tool result, or passed through to the model.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Set it in Railway's ` +
        `environment variables (or a local .env for dev) — never in source code.`
    );
  }
  return value;
}

export const config = {
  ghlPrivateToken: requireEnv("GHL_PRIVATE_TOKEN"),
  ghlLocationId: requireEnv("GHL_LOCATION_ID"),
  ghlApiVersion: "2021-07-28",
  ghlBaseUrl: "https://services.leadconnectorhq.com",
  port: Number(process.env.PORT ?? 3000),
};
