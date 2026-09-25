#!/usr/bin/env bun
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { createPortableApp } from "./app";
import { loadRuntimeConfig } from "./config";
import { HOSTS, type HostId, renderHostConfig } from "./host-config";
import { createPortableMcpServer } from "./mcp";
import { createModelGateway } from "./model";

const HOST_ARG_INDEX = 3;

function printConfig(): void {
  const host = process.argv[HOST_ARG_INDEX];
  if (!HOSTS.includes(host as HostId)) throw new Error(`Use --print-config with one of: ${HOSTS.join(", ")}`);
  const rendered = renderHostConfig(host as HostId, import.meta.path);
  console.log(rendered.content);
  console.error(`[octto] Add this server entry to ${rendered.path}`);
}

function serve(): void {
  const config = loadRuntimeConfig();
  mkdirSync(dirname(config.dataFile), { recursive: true });
  const app = createPortableApp({
    dataFile: config.dataFile,
    model: createModelGateway(config.model),
    skipBrowser: config.skipBrowser,
  });
  serveStdio(() => createPortableMcpServer(app), {
    onerror(error) {
      console.error(`[octto] MCP transport error: ${error.message}`);
    },
  });
  process.stdin.once("end", () => {
    void app.close();
  });
}

try {
  if (process.argv[2] === "--print-config") printConfig();
  else serve();
} catch (error) {
  console.error(`[octto] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
