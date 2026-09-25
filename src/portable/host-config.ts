export const HOSTS = ["codex", "claude", "antigravity", "copilot", "kilo", "zoo"] as const;
export type HostId = (typeof HOSTS)[number];

export interface HostConfig {
  path: string;
  content: string;
}

const CONFIG_PATHS: Record<HostId, string> = {
  codex: ".codex/config.toml",
  claude: ".mcp.json",
  antigravity: ".agents/mcp_config.json",
  copilot: ".mcp.json",
  kilo: ".kilo/kilo.jsonc",
  zoo: ".roo/mcp.json",
};

const FORWARDED_ENV = [
  "OCTTO_MODEL_PROVIDER",
  "OCTTO_MODEL",
  "OCTTO_MODEL_BASE_URL",
  "OCTTO_MODEL_API_KEY",
  "OPENAI_API_KEY",
  "OCTTO_DATA_DIR",
  "OCTTO_NO_BROWSER",
];

export function renderHostConfig(host: HostId, cliPath: string): HostConfig {
  if (!HOSTS.includes(host)) throw new Error(`Unknown host: ${host}`);
  if (!cliPath.trim()) throw new Error("CLI path is required");
  const path = CONFIG_PATHS[host];
  if (host === "codex") {
    return {
      path,
      content: [
        "[mcp_servers.octto]",
        'command = "bun"',
        `args = ${JSON.stringify([cliPath])}`,
        `env_vars = ${JSON.stringify(FORWARDED_ENV)}`,
      ].join("\n"),
    };
  }
  const command = host === "kilo" ? { type: "local", command: ["bun", cliPath] } : { command: "bun", args: [cliPath] };
  const body = host === "kilo" ? { mcp: { octto: command } } : { mcpServers: { octto: command } };
  return { path, content: JSON.stringify(body, null, 2) };
}
