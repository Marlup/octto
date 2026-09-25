import { expect, test } from "bun:test";
import { join } from "node:path";

import { loadRuntimeConfig } from "../../src/portable/config";

test("local model configuration requires a model and endpoint without a secret", () => {
  const config = loadRuntimeConfig({
    OCTTO_MODEL_PROVIDER: "compatible",
    OCTTO_MODEL: "local-model",
    OCTTO_MODEL_BASE_URL: "http://127.0.0.1:11434/v1",
    OCTTO_DATA_DIR: "C:\\octto-test-data",
  });
  expect(config.model.provider).toBe("compatible");
  expect(config.model.apiKey).toBeUndefined();
  expect(config.dataFile).toBe(join("C:\\octto-test-data", "sessions.sqlite"));
  expect(() => loadRuntimeConfig({ OCTTO_MODEL_PROVIDER: "compatible", OCTTO_MODEL: "local-model" })).toThrow();
});
