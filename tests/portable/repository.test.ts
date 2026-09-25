import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSessionRepository } from "../../src/portable/repository";

test("a future durable session version fails explicitly instead of being misread", () => {
  const root = mkdtempSync(join(tmpdir(), "octto-repository-"));
  const file = join(root, "sessions.sqlite");
  const repository = createSessionRepository(file);
  repository.close();
  try {
    const database = new Database(file);
    database
      .query("INSERT INTO sessions (id, payload) VALUES (?, ?)")
      .run("ses_future", JSON.stringify({ id: "ses_future", schema_version: 2 }));
    database.close();
    const reopened = createSessionRepository(file);
    try {
      expect(() => reopened.get("ses_future")).toThrow("Unsupported session schema version");
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
