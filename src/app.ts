import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod/v4";

const MCP_API_TOKEN = process.env.MCP_API_TOKEN;
const NTFY_TOPIC = process.env.NTFY_TOPIC;

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "my-mcp-server", version: "1.0.0" },
    { capabilities: { logging: {} } },
  );

  server.registerTool(
    "hello",
    {
      description: "Say hello to someone",
      inputSchema: { name: z.string() },
    },
    async ({ name }) => ({
      content: [{ type: "text", text: `Hello, ${name}!` }],
    }),
  );

  server.registerTool(
    "send_brief",
    {
      description: "Send a brief message to T's phone via ntfy",
      inputSchema: {
        message: z.string().describe("The content of the brief to send"),
        title: z.string().optional().describe("Optional title for the notification"),
      },
    },
    async ({ message, title }) => {
      if (!NTFY_TOPIC) {
        return {
          content: [{ type: "text", text: "Error: NTFY_TOPIC env var is not set." }],
        };
      }
      const response = await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
        method: "POST",
        body: message,
        headers: {
          "Title": title ?? "Claude Brief",
          "Priority": "default",
        },
      });
      if (!response.ok) {
        return {
          content: [{ type: "text", text: `Failed to send brief: ${response.status}` }],
        };
      }
      return {
        content: [{ type: "text", text: "Brief sent to phone." }],
      };
    },
  );

  return server;
}

const RENDER_EXTERNAL_HOSTNAME = process.env.RENDER_EXTERNAL_HOSTNAME;
export const app = createMcpExpressApp({
  host: "0.0.0.0",
  allowedHosts: RENDER_EXTERNAL_HOSTNAME ? [RENDER_EXTERNAL_HOSTNAME] : undefined,
});

app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path === "/health" || !MCP_API_TOKEN) {
    next();
    return;
  }
  const auth = req.headers.authorization ?? "";
  const expected = `Bearer ${MCP_API_TOKEN}`;
  if (
    auth.length === expected.length &&
    timingSafeEqual(Buffer.from(auth), Buffer.from(expected))
  ) {
    next();
    return;
  }
  res.status(401).json({
    jsonrpc: "2.0",
    error: { code: -32001, message: "Unauthorized" },
    id: null,
  });
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.post("/mcp", async (req: Request, res: Response) => {
  const server = createServer();
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => {
      transport.close();
      server.close();
    });
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

app.get("/mcp", (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
});

app.delete("/mcp", (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
});
