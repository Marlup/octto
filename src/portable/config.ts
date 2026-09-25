import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { ModelConfig } from "./model";

export interface RuntimeConfig {
  dataFile: string;
  model: ModelConfig;
  skipBrowser: boolean;
}

const APP_DIR = "octto-portable";

function defaultDataDir(env: NodeJS.ProcessEnv): string {
  if (process.platform === "win32") return join(env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), APP_DIR);
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", APP_DIR);
  return join(env.XDG_DATA_HOME || join(homedir(), ".local", "share"), APP_DIR);
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const provider = env.OCTTO_MODEL_PROVIDER || "openai";
  if (provider !== "openai" && provider !== "compatible")
    throw new Error("OCTTO_MODEL_PROVIDER must be openai or compatible");
  const model = env.OCTTO_MODEL?.trim();
  if (!model) throw new Error("OCTTO_MODEL is required");
  if (provider === "compatible" && !env.OCTTO_MODEL_BASE_URL)
    throw new Error("OCTTO_MODEL_BASE_URL is required for compatible providers");
  if (provider === "openai" && !env.OPENAI_API_KEY)
    throw new Error("OPENAI_API_KEY is required for the OpenAI provider");
  const dataDir = resolve(env.OCTTO_DATA_DIR || defaultDataDir(env));
  return {
    dataFile: join(dataDir, "sessions.sqlite"),
    skipBrowser: env.OCTTO_NO_BROWSER === "1",
    model: {
      provider,
      model,
      baseUrl: env.OCTTO_MODEL_BASE_URL,
      apiKey: provider === "openai" ? env.OPENAI_API_KEY : env.OCTTO_MODEL_API_KEY,
    },
  };
}
