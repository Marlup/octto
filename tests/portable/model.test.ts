import { expect, test } from "bun:test";

import { createModelGateway } from "../../src/portable/model";

test("an OpenAI-compatible endpoint receives the configured model and returns branch JSON", async () => {
  let seen: { path: string; body: Record<string, unknown>; authorization: string | null } | undefined;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      seen = {
        path: new URL(request.url).pathname,
        body: (await request.json()) as Record<string, unknown>,
        authorization: request.headers.get("authorization"),
      };
      return Response.json({ choices: [{ message: { content: '{"branches":[]}' } }] });
    },
  });
  try {
    const gateway = createModelGateway({
      provider: "compatible",
      model: "local-model",
      baseUrl: `http://127.0.0.1:${server.port}/v1`,
    });
    const result = await gateway.generate("branches", { request: "Design a cache" });
    expect(result).toEqual({ branches: [] });
    expect(seen?.path).toBe("/v1/chat/completions");
    expect(seen?.body.model).toBe("local-model");
    expect(seen?.authorization).toBeNull();
  } finally {
    await server.stop(true);
  }
});

test("the OpenAI provider uses Responses and extracts output text", async () => {
  let seen: { path: string; body: Record<string, unknown>; authorization: string | null } | undefined;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      seen = {
        path: new URL(request.url).pathname,
        body: (await request.json()) as Record<string, unknown>,
        authorization: request.headers.get("authorization"),
      };
      return Response.json({ output: [{ content: [{ type: "output_text", text: "# Plan" }] }] });
    },
  });
  try {
    const gateway = createModelGateway({
      provider: "openai",
      model: "configured-model",
      apiKey: "test-only",
      baseUrl: `http://127.0.0.1:${server.port}/v1`,
    });
    expect(await gateway.generate("draft", { request: "Design a cache" })).toBe("# Plan");
    expect(seen?.path).toBe("/v1/responses");
    expect(seen?.body.store).toBe(false);
    expect(seen?.authorization).toBe("Bearer test-only");
  } finally {
    await server.stop(true);
  }
});
