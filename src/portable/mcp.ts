import { type CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { PortableApp } from "./app";
import { startInputSchema } from "./contracts";

const sessionInput = z.object({ session_id: z.string().min(1) });

function textResult(value: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text: value }], ...(isError ? { isError: true } : {}) };
}

function failure(error: unknown): CallToolResult {
  return textResult(error instanceof Error ? error.message : String(error), true);
}

function registerStart(server: McpServer, app: PortableApp): void {
  server.registerTool(
    "octto_start",
    {
      description: "Start a browser brainstorm and return one durable session ID and its local browser URL.",
      inputSchema: startInputSchema,
    },
    async (input) => {
      try {
        return textResult(JSON.stringify(await app.start(input)));
      } catch (error) {
        return failure(error);
      }
    },
  );
}

function registerStatus(server: McpServer, app: PortableApp): void {
  server.registerTool(
    "octto_status",
    {
      description: "Get current phase, pending question count, browser URL, and any recoverable error for a session.",
      inputSchema: sessionInput,
    },
    async (input) => {
      try {
        return textResult(JSON.stringify(await app.status(input.session_id)));
      } catch (error) {
        return failure(error);
      }
    },
  );
}

function registerGetPlan(server: McpServer, app: PortableApp): void {
  server.registerTool(
    "octto_get_plan",
    {
      description: "Return the approved implementation plan as Markdown. Fails before browser approval.",
      inputSchema: sessionInput,
    },
    async (input) => {
      try {
        return textResult(await app.getPlan(input.session_id));
      } catch (error) {
        return failure(error);
      }
    },
  );
}

function registerCancel(server: McpServer, app: PortableApp): void {
  server.registerTool(
    "octto_cancel",
    {
      description: "Cancel an Octto brainstorm and close its browser session without deleting its durable record.",
      inputSchema: sessionInput,
    },
    async (input) => {
      try {
        return textResult(JSON.stringify(await app.cancel(input.session_id)));
      } catch (error) {
        return failure(error);
      }
    },
  );
}

function registerRetry(server: McpServer, app: PortableApp): void {
  server.registerTool(
    "octto_retry",
    {
      description: "Retry a failed brainstorm phase using its existing durable session ID.",
      inputSchema: sessionInput,
    },
    async (input) => {
      try {
        return textResult(JSON.stringify(await app.retry(input.session_id)));
      } catch (error) {
        return failure(error);
      }
    },
  );
}

export function createPortableMcpServer(app: PortableApp): McpServer {
  const server = new McpServer(
    { name: "octto-portable", version: "0.1.0" },
    {
      instructions:
        "Call octto_start with a goal and workspace root. The user answers and reviews in the browser. Poll octto_status without blocking; call octto_get_plan only after approval. Do not save or implement a plan without explicit user direction.",
    },
  );
  registerStart(server, app);
  registerStatus(server, app);
  registerGetPlan(server, app);
  registerCancel(server, app);
  registerRetry(server, app);
  return server;
}
