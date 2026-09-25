import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPortableApp } from "../../src/portable/app";

const roots: string[] = [];
const apps: Array<{ close: () => Promise<void> }> = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const app of apps.splice(0)) await app.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function until<T>(read: () => Promise<T> | T, predicate: (value: T) => boolean): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const value = await read();
    if (predicate(value)) return value;
    await Bun.sleep(10);
  }
  throw new Error("Timed out waiting for expected state");
}

async function connect(url: string): Promise<{ socket: WebSocket; messages: Array<Record<string, unknown>> }> {
  const socket = new WebSocket(url.replace(/^http:/, "ws:").replace("/?token=", "/ws?token="));
  sockets.push(socket);
  const messages: Array<Record<string, unknown>> = [];
  socket.onmessage = (event) => messages.push(JSON.parse(String(event.data)) as Record<string, unknown>);
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error("WebSocket connection failed"));
  });
  return { socket, messages };
}

test("starting a brainstorm opens a browser session with generated branches", async () => {
  const root = mkdtempSync(join(tmpdir(), "octto-portable-"));
  roots.push(root);
  const app = createPortableApp({
    dataFile: join(root, "sessions.sqlite"),
    skipBrowser: true,
    model: {
      async generate(role) {
        if (role !== "branches") throw new Error(`Unexpected role ${role}`);
        return {
          branches: [
            {
              id: "scope",
              scope: "Choose scope",
              initial_question: {
                type: "pick_one",
                config: { question: "What scope?", options: [{ id: "small", label: "Small" }] },
              },
            },
            {
              id: "tests",
              scope: "Choose tests",
              initial_question: { type: "ask_text", config: { question: "What tests matter?" } },
            },
          ],
        };
      },
    },
  });
  apps.push(app);

  const started = await app.start({ request: "Design a cache", workspace_root: root });
  expect(started.session_id).toMatch(/^ses_/);
  for (let i = 0; i < 100 && (await app.status(started.session_id)).phase !== "exploring"; i++) {
    await Bun.sleep(10);
  }
  const status = await app.status(started.session_id);
  expect(status.phase).toBe("exploring");
  expect(status.pending_questions).toBe(2);
  expect((await fetch(started.browser_url)).status).toBe(200);
});

test("browser answers advance independent branches to plan review", async () => {
  const root = mkdtempSync(join(tmpdir(), "octto-portable-"));
  roots.push(root);
  const app = createPortableApp({
    dataFile: join(root, "sessions.sqlite"),
    skipBrowser: true,
    model: {
      async generate(role, input) {
        if (role === "branches")
          return {
            branches: [
              {
                id: "scope",
                scope: "Scope",
                initial_question: {
                  type: "pick_one",
                  config: { question: "What scope?", options: [{ id: "small", label: "Small" }] },
                },
              },
              {
                id: "tests",
                scope: "Tests",
                initial_question: { type: "ask_text", config: { question: "What tests?" } },
              },
            ],
          };
        if (role === "probe")
          return { done: true, finding: `Finding for ${(input as { branch_id: string }).branch_id}` };
        if (role === "draft") return "# Cache plan\n\n1. Add cache.\n2. Test it.";
        throw new Error(`Unexpected role ${role}`);
      },
    },
  });
  apps.push(app);

  const started = await app.start({ request: "Design a cache", workspace_root: root });
  await until(
    () => app.status(started.session_id),
    (s) => s.phase === "exploring",
  );
  const { socket, messages } = await connect(started.browser_url);
  await until(
    () => messages,
    (list) => list.filter((item) => item.type === "question").length === 2,
  );
  const questions = messages.filter((item) => item.type === "question");
  for (const question of questions) {
    socket.send(
      JSON.stringify({
        type: "response",
        id: question.id,
        answer: question.questionType === "pick_one" ? { selected: "small" } : { text: "Integration tests" },
      }),
    );
  }

  const status = await until(
    () => app.status(started.session_id),
    (s) => s.phase === "review",
  );
  expect(status.pending_questions).toBe(1);
  await until(
    () => messages,
    (list) => list.some((item) => item.questionType === "show_plan"),
  );
});

test("a requested revision can be approved and retrieved by the host", async () => {
  const root = mkdtempSync(join(tmpdir(), "octto-portable-"));
  roots.push(root);
  const app = createPortableApp({
    dataFile: join(root, "sessions.sqlite"),
    skipBrowser: true,
    model: {
      async generate(role) {
        if (role === "branches")
          return {
            branches: [
              { id: "scope", scope: "Scope", initial_question: { type: "ask_text", config: { question: "Scope?" } } },
              { id: "tests", scope: "Tests", initial_question: { type: "ask_text", config: { question: "Tests?" } } },
            ],
          };
        if (role === "probe") return { done: true, finding: "Decided" };
        if (role === "draft") return "# Initial plan";
        if (role === "revise") return "# Revised plan\n\n- Add acceptance tests";
        throw new Error(`Unexpected role ${role}`);
      },
    },
  });
  apps.push(app);
  const started = await app.start({ request: "Design a cache", workspace_root: root });
  await until(
    () => app.status(started.session_id),
    (s) => s.phase === "exploring",
  );
  const { socket, messages } = await connect(started.browser_url);
  await until(
    () => messages,
    (items) => items.filter((item) => item.questionType === "ask_text").length === 2,
  );
  for (const q of messages.filter((item) => item.questionType === "ask_text")) {
    socket.send(JSON.stringify({ type: "response", id: q.id, answer: { text: "Yes" } }));
  }
  await until(
    () => messages,
    (items) => items.filter((item) => item.questionType === "show_plan").length === 1,
  );
  const first = messages.find((item) => item.questionType === "show_plan")!;
  socket.send(
    JSON.stringify({ type: "response", id: first.id, answer: { decision: "revise", feedback: "Add tests" } }),
  );
  await until(
    () => messages,
    (items) => items.filter((item) => item.questionType === "show_plan").length === 2,
  );
  const second = messages.filter((item) => item.questionType === "show_plan")[1];
  socket.send(JSON.stringify({ type: "response", id: second.id, answer: { decision: "approve" } }));
  await until(
    () => app.status(started.session_id),
    (s) => s.phase === "approved",
  );
  expect(await app.getPlan(started.session_id)).toContain("# Revised plan");
});

test("approval does not write a plan until the browser user chooses save", async () => {
  const root = mkdtempSync(join(tmpdir(), "octto-portable-"));
  roots.push(root);
  const app = createPortableApp({
    dataFile: join(root, "sessions.sqlite"),
    skipBrowser: true,
    model: {
      async generate(role) {
        if (role === "branches")
          return {
            branches: [
              { id: "a", scope: "A", initial_question: { type: "ask_text", config: { question: "A?" } } },
              { id: "b", scope: "B", initial_question: { type: "ask_text", config: { question: "B?" } } },
            ],
          };
        if (role === "probe") return { done: true, finding: "Done" };
        if (role === "draft") return "# Approved plan\n\n1. Implement.\n2. Test.";
        throw new Error(`Unexpected role ${role}`);
      },
    },
  });
  apps.push(app);
  const started = await app.start({ request: "Design a cache", workspace_root: root });
  await until(
    () => app.status(started.session_id),
    (s) => s.phase === "exploring",
  );
  const { socket, messages } = await connect(started.browser_url);
  await until(
    () => messages,
    (items) => items.filter((item) => item.questionType === "ask_text").length === 2,
  );
  for (const q of messages.filter((item) => item.questionType === "ask_text")) {
    socket.send(JSON.stringify({ type: "response", id: q.id, answer: { text: "Yes" } }));
  }
  await until(
    () => messages,
    (items) => items.some((item) => item.questionType === "show_plan"),
  );
  const review = messages.find((item) => item.questionType === "show_plan")!;
  socket.send(JSON.stringify({ type: "response", id: review.id, answer: { decision: "approve" } }));
  await until(
    () => app.status(started.session_id),
    (s) => s.phase === "approved",
  );
  expect(existsSync(join(root, "docs", "plans"))).toBe(false);
  await until(
    () => messages,
    (items) => items.some((item) => item.questionType === "pick_one"),
  );
  const save = messages.find((item) => item.questionType === "pick_one")!;
  socket.send(JSON.stringify({ type: "response", id: save.id, answer: { selected: "save" } }));
  const status = await until(
    () => app.status(started.session_id),
    (s) => Boolean(s.saved_path),
  );
  expect(status.saved_path!.startsWith(join(root, "docs", "plans"))).toBe(true);
  expect(readFileSync(status.saved_path!, "utf8")).toContain("# Approved plan");
});

test("a new host process reopens pending questions with the same public session ID", async () => {
  const root = mkdtempSync(join(tmpdir(), "octto-portable-"));
  roots.push(root);
  const dataFile = join(root, "sessions.sqlite");
  const model = {
    async generate(role: string) {
      if (role === "branches")
        return {
          branches: [
            { id: "a", scope: "A", initial_question: { type: "ask_text", config: { question: "A?" } } },
            { id: "b", scope: "B", initial_question: { type: "ask_text", config: { question: "B?" } } },
          ],
        };
      throw new Error(`Unexpected role ${role}`);
    },
  };
  const first = createPortableApp({ dataFile, skipBrowser: true, model });
  const started = await first.start({ request: "Design a cache", workspace_root: root });
  await until(
    () => first.status(started.session_id),
    (s) => s.phase === "exploring",
  );
  await first.close();

  const second = createPortableApp({ dataFile, skipBrowser: true, model });
  apps.push(second);
  const resumed = await second.status(started.session_id);
  expect(resumed.session_id).toBe(started.session_id);
  expect(resumed.pending_questions).toBe(2);
  expect(resumed.browser_url).not.toBe(started.browser_url);
  const { messages } = await connect(resumed.browser_url);
  await until(
    () => messages,
    (items) => items.filter((item) => item.questionType === "ask_text").length === 2,
  );
});

test("a failed model call can be retried without changing the public session ID", async () => {
  const root = mkdtempSync(join(tmpdir(), "octto-portable-"));
  roots.push(root);
  let attempts = 0;
  const app = createPortableApp({
    dataFile: join(root, "sessions.sqlite"),
    skipBrowser: true,
    model: {
      async generate(role) {
        if (role !== "branches") throw new Error(`Unexpected role ${role}`);
        attempts++;
        if (attempts === 1) throw new Error("Provider temporarily unavailable");
        return {
          branches: [
            { id: "a", scope: "A", initial_question: { type: "ask_text", config: { question: "A?" } } },
            { id: "b", scope: "B", initial_question: { type: "ask_text", config: { question: "B?" } } },
          ],
        };
      },
    },
  });
  apps.push(app);
  const started = await app.start({ request: "Design a cache", workspace_root: root });
  const failed = await until(
    () => app.status(started.session_id),
    (s) => s.phase === "error",
  );
  expect(failed.error).toContain("Provider temporarily unavailable");
  await app.retry(started.session_id);
  const resumed = await until(
    () => app.status(started.session_id),
    (s) => s.phase === "exploring",
  );
  expect(resumed.session_id).toBe(started.session_id);
  expect(resumed.pending_questions).toBe(2);
});

test("retry resumes a failed plan revision from durable feedback", async () => {
  const root = mkdtempSync(join(tmpdir(), "octto-portable-"));
  roots.push(root);
  let revisions = 0;
  const app = createPortableApp({
    dataFile: join(root, "sessions.sqlite"),
    skipBrowser: true,
    model: {
      async generate(role) {
        if (role === "branches")
          return {
            branches: [
              { id: "a", scope: "A", initial_question: { type: "ask_text", config: { question: "A?" } } },
              { id: "b", scope: "B", initial_question: { type: "ask_text", config: { question: "B?" } } },
            ],
          };
        if (role === "probe") return { done: true, finding: "Done" };
        if (role === "draft") return "# Initial plan";
        if (role === "revise") {
          revisions++;
          if (revisions === 1) throw new Error("Temporary revision failure");
          return "# Revised plan";
        }
        throw new Error(`Unexpected role ${role}`);
      },
    },
  });
  apps.push(app);
  const started = await app.start({ request: "Design a cache", workspace_root: root });
  await until(
    () => app.status(started.session_id),
    (s) => s.phase === "exploring",
  );
  const { socket, messages } = await connect(started.browser_url);
  await until(
    () => messages,
    (items) => items.filter((item) => item.questionType === "ask_text").length === 2,
  );
  for (const q of messages.filter((item) => item.questionType === "ask_text")) {
    socket.send(JSON.stringify({ type: "response", id: q.id, answer: { text: "Yes" } }));
  }
  await until(
    () => messages,
    (items) => items.some((item) => item.questionType === "show_plan"),
  );
  const review = messages.find((item) => item.questionType === "show_plan")!;
  socket.send(
    JSON.stringify({ type: "response", id: review.id, answer: { decision: "revise", feedback: "Add tests" } }),
  );
  await until(
    () => app.status(started.session_id),
    (s) => s.phase === "error",
  );
  await app.retry(started.session_id);
  await until(
    () => messages,
    (items) => items.filter((item) => item.questionType === "show_plan").length === 2,
  );
  const revised = messages.filter((item) => item.questionType === "show_plan")[1];
  socket.send(JSON.stringify({ type: "response", id: revised.id, answer: { decision: "approve" } }));
  await until(
    () => app.status(started.session_id),
    (s) => s.phase === "approved",
  );
  expect(await app.getPlan(started.session_id)).toBe("# Revised plan");
});

test("retry completes an explicitly requested save after a filesystem failure", async () => {
  const root = mkdtempSync(join(tmpdir(), "octto-portable-"));
  roots.push(root);
  const app = createPortableApp({
    dataFile: join(root, "sessions.sqlite"),
    skipBrowser: true,
    model: {
      async generate(role) {
        if (role === "branches")
          return {
            branches: [
              { id: "a", scope: "A", initial_question: { type: "ask_text", config: { question: "A?" } } },
              { id: "b", scope: "B", initial_question: { type: "ask_text", config: { question: "B?" } } },
            ],
          };
        if (role === "probe") return { done: true, finding: "Done" };
        if (role === "draft") return "# Approved plan";
        throw new Error(`Unexpected role ${role}`);
      },
    },
  });
  apps.push(app);
  const started = await app.start({ request: "Design a cache", workspace_root: root });
  await until(
    () => app.status(started.session_id),
    (s) => s.phase === "exploring",
  );
  const { socket, messages } = await connect(started.browser_url);
  await until(
    () => messages,
    (items) => items.filter((item) => item.questionType === "ask_text").length === 2,
  );
  for (const q of messages.filter((item) => item.questionType === "ask_text")) {
    socket.send(JSON.stringify({ type: "response", id: q.id, answer: { text: "Yes" } }));
  }
  await until(
    () => messages,
    (items) => items.some((item) => item.questionType === "show_plan"),
  );
  const review = messages.find((item) => item.questionType === "show_plan")!;
  socket.send(JSON.stringify({ type: "response", id: review.id, answer: { decision: "approve" } }));
  await until(
    () => messages,
    (items) => items.some((item) => item.questionType === "pick_one"),
  );
  writeFileSync(join(root, "docs"), "blocks directory creation");
  const save = messages.find((item) => item.questionType === "pick_one")!;
  socket.send(JSON.stringify({ type: "response", id: save.id, answer: { selected: "save" } }));
  await until(
    () => app.status(started.session_id),
    (s) => s.phase === "error",
  );
  unlinkSync(join(root, "docs"));
  await app.retry(started.session_id);
  const status = await until(
    () => app.status(started.session_id),
    (s) => Boolean(s.saved_path),
  );
  expect(readFileSync(status.saved_path!, "utf8")).toContain("# Approved plan");
});
