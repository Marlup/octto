import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { StoredSession } from "../../src/portable/contracts";
import { saveApprovedPlan } from "../../src/portable/writer";

test("saving the same approved session is idempotent", () => {
  const root = mkdtempSync(join(tmpdir(), "octto-writer-"));
  try {
    const session: StoredSession = {
      id: "ses_12345678",
      schema_version: 1,
      input: { request: "Design a cache", workspace_root: root },
      phase: "approved",
      branches: [],
      draft: "# Cache plan",
    };
    const first = saveApprovedPlan(session);
    expect(saveApprovedPlan(session)).toBe(first);
    expect(readFileSync(first, "utf8")).toBe("# Cache plan\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
