import type { ModelGateway, ModelRole } from "./app";
import { PROMPTS } from "./prompts";

export interface ModelConfig {
  provider: "openai" | "compatible";
  model: string;
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
}

const DEFAULT_MODEL_TIMEOUT_MS = 120_000;

function parseJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    throw new Error("Model returned invalid JSON");
  }
}

function responseText(data: unknown, provider: ModelConfig["provider"]): string {
  if (!data || typeof data !== "object") throw new Error("Model returned an invalid response");
  const value = data as Record<string, unknown>;
  if (provider === "compatible") {
    const choices = value.choices as Array<{ message?: { content?: unknown } }> | undefined;
    const content = choices?.[0]?.message?.content;
    if (typeof content === "string") return content;
  } else {
    if (typeof value.output_text === "string") return value.output_text;
    const output = value.output as Array<{ content?: Array<{ type?: string; text?: unknown }> }> | undefined;
    const text = output
      ?.flatMap((item) => item.content ?? [])
      .filter((part) => part.type === "output_text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("");
    if (text) return text;
  }
  throw new Error("Model response contained no text");
}

function requestBody(config: ModelConfig, role: ModelRole, input: unknown): object {
  if (config.provider === "openai") {
    return { model: config.model, instructions: PROMPTS[role], input: JSON.stringify(input), store: false };
  }
  return {
    model: config.model,
    messages: [
      { role: "system", content: PROMPTS[role] },
      { role: "user", content: JSON.stringify(input) },
    ],
    stream: false,
  };
}

export function createModelGateway(config: ModelConfig): ModelGateway {
  if (!config.model.trim()) throw new Error("OCTTO_MODEL is required");
  const base = config.baseUrl ?? (config.provider === "openai" ? "https://api.openai.com/v1" : undefined);
  if (!base) throw new Error("OCTTO_MODEL_BASE_URL is required for compatible providers");
  const url = new URL(base.endsWith("/") ? base : `${base}/`);
  const key = config.apiKey ?? (config.provider === "openai" ? process.env.OPENAI_API_KEY : undefined);
  if (config.provider === "openai" && !key) throw new Error("OPENAI_API_KEY is required for the OpenAI provider");

  return {
    async generate(role: ModelRole, input: unknown): Promise<unknown> {
      const endpoint = new URL(config.provider === "openai" ? "responses" : "chat/completions", url);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify(requestBody(config, role, input)),
        signal: AbortSignal.timeout(config.timeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Model request failed with HTTP ${response.status}`);
      const text = responseText((await response.json()) as unknown, config.provider);
      return role === "branches" || role === "probe" ? parseJson(text) : text;
    },
  };
}
