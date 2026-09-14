// Polyfill the Web Crypto API global if the runtime doesn't provide it.
// The MCP SDK expects globalThis.crypto to exist (it's a standard browser/
// modern-Node global), but not every hosting platform's default Node
// version exposes it automatically. Setting this explicitly means the
// server doesn't depend on which exact Node version Railway happens to run.
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) {
  (globalThis as any).crypto = webcrypto;
}

import express from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./config.js";
import { rawTools } from "./tools/raw-tools.js";
import { compositeTools } from "./tools/composite-tools.js";
import { resourceTools } from "./tools/resource-tools.js";

function buildServer(): McpServer {
  const server = new McpServer({
    name: "kukoon-ghl-mcp",
    version: "1.0.0",
  });

  // Register every tool with explicit annotations declaring it read-only.
  // Without these, MCP clients (ChatGPT in particular) default to treating
  // an unannotated tool as a potential write/destructive action and label
  // it accordingly in the UI — misleading here, since every tool in this
  // project only ever performs a GET against the GHL API.
  for (const tool of [...rawTools, ...compositeTools, ...resourceTools]) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema.shape,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true, // it does call an external API (GHL)
        },
      },
      async (input: any) => {
        try {
          const result = await tool.handler(input);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err: any) {
          return {
            content: [{ type: "text" as const, text: `Error: ${err.message}` }],
            isError: true,
          };
        }
      }
    );
  }

  return server;
}

const app = express();

// CORS: required because ChatGPT's and Claude's connector-creation UIs make
// a connectivity check directly from the browser (chatgpt.com / claude.ai)
// to this server's own domain. Without these headers, that cross-origin
// request is silently blocked by the browser before it even reaches this
// server's logic — curl/server-to-server calls aren't affected by CORS,
// which is why earlier direct tests worked while browser-based setup failed.
app.use(
  cors({
    origin: true, // reflect the request's Origin header back — this is a
    // public, read-only, no-auth MCP endpoint, so there's no per-origin
    // secret to protect; the token itself is never exposed to any client.
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Accept", "Mcp-Session-Id", "MCP-Protocol-Version"],
    exposedHeaders: ["Mcp-Session-Id"],
  })
);
app.use(express.json());

// Health check — useful for Railway and for a quick manual "is it up" check.
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "kukoon-ghl-mcp" });
});

// Streamable HTTP MCP endpoint, run fully stateless: a fresh server and
// transport are built for every request, with session-ID tracking disabled
// (sessionIdGenerator: undefined). This matches the "new instance per
// request" pattern — trying to also track sessions here causes clients to
// get a 400 on the very first handshake, since there's no shared state
// across requests for a session ID to reference.
app.post("/mcp", async (req, res) => {
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err: any) {
    console.error("MCP request error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// The Streamable HTTP spec allows GET (server-initiated stream) and DELETE
// (session termination) on the same route. This server doesn't use sessions
// or server push, so both simply return 405 rather than a bare 404 — some
// clients probe these during connection setup and a 405 with the right
// Allow header is a cleaner signal than a generic "not found."
app.get("/mcp", (_req, res) => {
  res.status(405).set("Allow", "POST").json({
    error: "This server runs statelessly; GET (SSE stream) is not supported. Use POST.",
  });
});
app.delete("/mcp", (_req, res) => {
  res.status(405).set("Allow", "POST").json({
    error: "This server runs statelessly; there is no session to terminate.",
  });
});

app.listen(config.port, () => {
  console.log(`kukoon-ghl-mcp listening on port ${config.port}`);
  console.log(`MCP endpoint: POST /mcp`);
});
