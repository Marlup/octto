import { expect, test } from "bun:test";

import { renderHostConfig } from "../../src/portable/host-config";

test("Codex config forwards model environment variables without embedding secrets", () => {
  const rendered = renderHostConfig("codex", "C:\\Tools\\octto\\dist\\cli.js");
  expect(rendered.path).toBe(".codex/config.toml");
  expect(rendered.content).toContain("[mcp_servers.octto]");
  expect(rendered.content).toContain("env_vars");
  expect(rendered.content).toContain("OPENAI_API_KEY");
  expect(rendered.content).not.toContain("api-key-value");
});

test("non-Codex hosts receive config-only adapters for the same executable", () => {
  const cliPath = "/opt/octto/dist/cli.js";
  for (const host of ["claude", "antigravity", "copilot", "zoo"] as const) {
    const config = JSON.parse(renderHostConfig(host, cliPath).content) as { mcpServers: { octto: { args: string[] } } };
    expect(config.mcpServers.octto.args).toEqual([cliPath]);
  }
  const kilo = JSON.parse(renderHostConfig("kilo", cliPath).content) as { mcp: { octto: { command: string[] } } };
  expect(kilo.mcp.octto.command).toEqual(["bun", cliPath]);
});
