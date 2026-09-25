import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";

import { createPortableApp } from "../../src/portable/app";
import { createPortableMcpServer } from "../../src/portable/mcp";

test("an MCP host can start a browser brainstorm through the portable contract", async () => {
  const root = mkdtempSync(join(tmpdir(), "octto-mcp-"));
  const app = createPortableApp({
    dataFile: join(root, "sessions.sqlite"),
    skipBrowser: true,
    model: {
      async generate(role) {
        if (role === "branches")
          return {
            branches: [
              { id: "scope", scope: "Scope", initial_question: { type: "ask_text", config: { question: "Scope?" } } },
              { id: "tests", scope: "Tests", initial_question: { type: "ask_text", config: { question: "Tests?" } } },
            ],
          };
        throw new Error(`Unexpected role ${role}`);
      },
    },
  });
  const server = createPortableMcpServer(app);
  const client = new Client({ name: "octto-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain("octto_start");
    expect(names).toContain("octto_retry");
    const result = await client.callTool({
      name: "octto_start",
      arguments: { request: "Design a cache", workspace_root: root },
    });
    expect(result.isError).not.toBe(true);
    const response = JSON.parse((result.content as Array<{ text: string }>)[0].text) as {
      session_id: string;
      browser_url: string;
    };
    expect(response.session_id).toMatch(/^ses_/);
    expect((await fetch(response.browser_url)).status).toBe(200);
    const cancelled = await client.callTool({ name: "octto_cancel", arguments: { session_id: response.session_id } });
    expect(cancelled.isError).not.toBe(true);
    const statusResult = await client.callTool({
      name: "octto_status",
      arguments: { session_id: response.session_id },
    });
    const status = JSON.parse((statusResult.content as Array<{ text: string }>)[0].text) as { phase: string };
    expect(status.phase).toBe("cancelled");
  } finally {
    await client.close();
    await server.close();
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
