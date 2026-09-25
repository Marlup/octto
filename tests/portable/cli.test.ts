import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

test("the Bun entry point speaks MCP over stdio without a host SDK", async () => {
  const root = mkdtempSync(join(tmpdir(), "octto-stdio-"));
  const client = new Client({ name: "octto-stdio-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(import.meta.dir, "../../src/portable/cli.ts")],
    env: {
      ...process.env,
      OCTTO_MODEL_PROVIDER: "compatible",
      OCTTO_MODEL: "fixture-model",
      OCTTO_MODEL_BASE_URL: "http://127.0.0.1:9/v1",
      OCTTO_DATA_DIR: root,
      OCTTO_NO_BROWSER: "1",
    },
  });
  try {
    await client.connect(transport);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain("octto_start");
    expect(names).toContain("octto_status");
    expect(names).toContain("octto_get_plan");
    expect(names).toContain("octto_cancel");
  } finally {
    await client.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("the entry point prints a Codex config without starting the MCP service", async () => {
  const child = Bun.spawn(
    [process.execPath, join(import.meta.dir, "../../src/portable/cli.ts"), "--print-config", "codex"],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const output = await new Response(child.stdout).text();
  expect(await child.exited).toBe(0);
  expect(output).toContain("[mcp_servers.octto]");
  expect(output).toContain("env_vars");
});
