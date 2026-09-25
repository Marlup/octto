import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

import type { StoredSession } from "./contracts";

const MAX_SLUG_LENGTH = 40;
const DATE_LENGTH = 10;
const ID_SUFFIX_LENGTH = 8;

export function saveApprovedPlan(session: StoredSession): string {
  if (!session.draft || session.phase !== "approved") throw new Error("There is no approved plan to save");
  const root = realpathSync(session.input.workspace_root);
  const directory = join(root, "docs", "plans");
  mkdirSync(directory, { recursive: true });
  const realDirectory = realpathSync(directory);
  const pathFromRoot = relative(root, realDirectory);
  if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new Error("Plan directory resolves outside the selected workspace");
  }
  const slug =
    session.input.request
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, MAX_SLUG_LENGTH) || "plan";
  const date = new Date().toISOString().slice(0, DATE_LENGTH);
  const path = join(realDirectory, `${date}-${slug}-${session.id.slice(-ID_SUFFIX_LENGTH)}.md`);
  const content = `${session.draft.trimEnd()}\n`;
  try {
    writeFileSync(path, content, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== "EEXIST" ||
      !lstatSync(path).isFile() ||
      readFileSync(path, "utf8") !== content
    ) {
      throw error;
    }
  }
  return path;
}
