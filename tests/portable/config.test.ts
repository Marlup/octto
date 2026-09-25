import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadRuntimeConfig } from "../../src/portable/config";

test("local model configuration requires a model and endpoint without a secret", () => {
  const dataDir = join(tmpdir(), "octto-test-data");
  const config = loadRuntimeConfig({
    OCTTO_MODEL_PROVIDER: "compatible",
    OCTTO_MODEL: "local-model",
    OCTTO_MODEL_BASE_URL: "http://127.0.0.1:11434/v1",
    OCTTO_DATA_DIR: dataDir,
  });
  expect(config.model.provider).toBe("compatible");
  expect(config.model.apiKey).toBeUndefined();
  expect(config.dataFile).toBe(join(dataDir, "sessions.sqlite"));
  expect(() => loadRuntimeConfig({ OCTTO_MODEL_PROVIDER: "compatible", OCTTO_MODEL: "local-model" })).toThrow();
});
