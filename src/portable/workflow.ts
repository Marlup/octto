import { realpathSync } from "node:fs";

import { createSessionStore, type SessionStore } from "@/session";
import type { GetNextAnswerOutput, InitialQuestion } from "@/session/types";

import {
  type Branch,
  browserQuestion,
  type ModelGateway,
  parseBranches,
  parseDraft,
  parseProbe,
  parseStartInput,
  pendingCount,
  reviewQuestion,
  SESSION_SCHEMA_VERSION,
  type StartInput,
  type StoredSession,
  saveQuestion,
} from "./contracts";
import { createSessionRepository, type SessionRepository } from "./repository";
import { saveApprovedPlan } from "./writer";

const ANSWER_WAIT_MS = 1000;
const IDLE_WAIT_MS = 100;

export interface SessionStatus {
  session_id: string;
  phase: StoredSession["phase"];
  pending_questions: number;
  browser_url: string;
  error?: string;
  saved_path?: string;
}

export interface PortableApp {
  start(input: StartInput): Promise<{ session_id: string; browser_url: string }>;
  status(sessionId: string): Promise<SessionStatus>;
  getPlan(sessionId: string): Promise<string>;
  cancel(sessionId: string): Promise<{ cancelled: boolean }>;
  retry(sessionId: string): Promise<{ retrying: boolean }>;
  close(): Promise<void>;
}

interface LiveBrowser {
  browserId: string;
  url: string;
}
interface Runtime {
  repository: SessionRepository;
  browser: SessionStore;
  model: ModelGateway;
  live: Map<string, LiveBrowser>;
  attaching: Map<string, Promise<void>>;
  closed: boolean;
}

function requireSession(runtime: Runtime, id: string): StoredSession {
  const session = runtime.repository.get(id);
  if (!session) throw new Error(`Session not found: ${id}`);
  return session;
}

function fail(runtime: Runtime, session: StoredSession, error: unknown): void {
  if (session.phase === "cancelled" || runtime.closed) return;
  if (session.phase !== "error") session.resume_phase = session.phase;
  session.phase = "error";
  session.error = error instanceof Error ? error.message : String(error);
  runtime.repository.put(session);
}

async function bootstrap(runtime: Runtime, session: StoredSession, browserId: string): Promise<void> {
  try {
    const branches = parseBranches(await runtime.model.generate("branches", session.input));
    if (session.phase !== "bootstrapping") return;
    for (const branch of branches) {
      const question = branch.questions[0];
      question.id = runtime.browser.pushQuestion(
        browserId,
        question.type,
        browserQuestion(question, branch.scope).config,
      ).question_id;
    }
    session.branches = branches;
    session.phase = "exploring";
    runtime.repository.put(session);
    void run(runtime, session, browserId, false);
  } catch (error) {
    fail(runtime, session, error);
  }
}

function isActive(runtime: Runtime, session: StoredSession): boolean {
  return (
    !runtime.closed &&
    (session.phase === "exploring" ||
      session.phase === "review" ||
      (session.phase === "approved" && !session.save_choice))
  );
}

async function run(runtime: Runtime, session: StoredSession, browserId: string, recovering: boolean): Promise<void> {
  try {
    if (recovering) await recoverWork(runtime, session, browserId);
    await answerLoop(runtime, session, browserId);
  } catch (error) {
    fail(runtime, session, error);
  }
}

async function answerLoop(runtime: Runtime, session: StoredSession, browserId: string): Promise<void> {
  while (isActive(runtime, session)) {
    const next = await runtime.browser.getNextAnswer({ session_id: browserId, block: true, timeout: ANSWER_WAIT_MS });
    if (next.completed && next.question_id) await consume(runtime, session, browserId, next);
    else if (next.status === "none_pending") await Bun.sleep(IDLE_WAIT_MS);
  }
}

async function consume(
  runtime: Runtime,
  session: StoredSession,
  browserId: string,
  next: GetNextAnswerOutput,
): Promise<void> {
  if (session.phase === "review") return handleReview(runtime, session, browserId, next);
  if (session.phase === "approved") return handleSave(runtime, session, next);
  if (session.phase === "exploring") return handleBranchAnswer(runtime, session, browserId, next);
}

async function handleBranchAnswer(
  runtime: Runtime,
  session: StoredSession,
  browserId: string,
  next: GetNextAnswerOutput,
): Promise<void> {
  const branch = session.branches.find((item) => item.questions.some((question) => question.id === next.question_id));
  const question = branch?.questions.find((item) => item.id === next.question_id);
  if (!branch || !question || question.answer !== undefined) return;
  question.answer = next.response;
  runtime.repository.put(session);
  await probeBranch(runtime, session, browserId, branch);
  await draftIfReady(runtime, session, browserId);
}

async function probeBranch(runtime: Runtime, session: StoredSession, browserId: string, branch: Branch): Promise<void> {
  const result = parseProbe(await runtime.model.generate("probe", { ...session, branch_id: branch.id }));
  if (result.done) branch.finding = result.finding;
  else {
    const question = result.question;
    question.id = runtime.browser.pushQuestion(
      browserId,
      question.type,
      browserQuestion(question, branch.scope).config,
    ).question_id;
    branch.questions.push(question);
  }
  runtime.repository.put(session);
}

async function draftIfReady(runtime: Runtime, session: StoredSession, browserId: string): Promise<void> {
  if (session.phase !== "exploring" || !session.branches.every((branch) => branch.finding)) return;
  session.draft = parseDraft(await runtime.model.generate("draft", session));
  session.phase = "review";
  session.review_question_id = runtime.browser.pushQuestion(
    browserId,
    "show_plan",
    reviewQuestion(session.draft).config,
  ).question_id;
  runtime.repository.put(session);
}

async function handleReview(
  runtime: Runtime,
  session: StoredSession,
  browserId: string,
  next: GetNextAnswerOutput,
): Promise<void> {
  if (next.question_id !== session.review_question_id) return;
  const answer = next.response as { decision?: string; feedback?: string } | undefined;
  if (answer?.decision === "approve") {
    session.phase = "approved";
    session.save_question_id = runtime.browser.pushQuestion(browserId, "pick_one", saveQuestion().config).question_id;
    runtime.repository.put(session);
    return;
  }
  if (answer?.decision !== "revise" || !answer.feedback?.trim()) throw new Error("Revision feedback is required");
  session.revision_feedback = answer.feedback.trim();
  session.review_question_id = undefined;
  runtime.repository.put(session);
  await reviseDraft(runtime, session, browserId);
}

async function reviseDraft(runtime: Runtime, session: StoredSession, browserId: string): Promise<void> {
  session.draft = parseDraft(await runtime.model.generate("revise", { session, feedback: session.revision_feedback }));
  session.revision_feedback = undefined;
  session.review_question_id = runtime.browser.pushQuestion(
    browserId,
    "show_plan",
    reviewQuestion(session.draft).config,
  ).question_id;
  runtime.repository.put(session);
}

function handleSave(runtime: Runtime, session: StoredSession, next: GetNextAnswerOutput): void {
  if (next.question_id !== session.save_question_id || session.save_choice) return;
  const answer = next.response as { selected?: string } | undefined;
  if (answer?.selected !== "save" && answer?.selected !== "skip") throw new Error("Invalid save choice");
  if (answer.selected === "skip") {
    session.save_choice = "skip";
    runtime.repository.put(session);
    return;
  }
  session.save_requested = true;
  runtime.repository.put(session);
  completeSave(runtime, session);
}

function completeSave(runtime: Runtime, session: StoredSession): void {
  session.saved_path = saveApprovedPlan(session);
  session.save_choice = "save";
  runtime.repository.put(session);
}

async function recoverWork(runtime: Runtime, session: StoredSession, browserId: string): Promise<void> {
  if (session.phase === "approved" && session.save_requested && !session.save_choice) {
    completeSave(runtime, session);
    return;
  }
  if (session.phase === "review" && session.revision_feedback) {
    await reviseDraft(runtime, session, browserId);
    return;
  }
  if (session.phase !== "exploring") return;
  for (const branch of session.branches) {
    if (branch.finding || !branch.questions.length) continue;
    if (branch.questions.every((question) => question.answer !== undefined))
      await probeBranch(runtime, session, browserId, branch);
  }
  await draftIfReady(runtime, session, browserId);
}

function pendingQuestions(session: StoredSession): Array<{ branch: Branch; question: Branch["questions"][number] }> {
  return session.branches.flatMap((branch) =>
    branch.questions.filter((question) => question.answer === undefined).map((question) => ({ branch, question })),
  );
}

function initialQuestions(session: StoredSession): InitialQuestion[] {
  if (session.phase === "exploring")
    return pendingQuestions(session).map(({ branch, question }) => browserQuestion(question, branch.scope));
  if (session.phase === "review" && session.draft && !session.revision_feedback) return [reviewQuestion(session.draft)];
  if (session.phase === "approved" && session.save_question_id && !session.save_choice && !session.save_requested)
    return [saveQuestion()];
  return [];
}

function mapReopenedIds(runtime: Runtime, session: StoredSession, ids: string[]): void {
  if (session.phase === "exploring")
    pendingQuestions(session).forEach(({ question }, index) => {
      question.id = ids[index];
    });
  if (session.phase === "review") session.review_question_id = ids[0];
  if (session.phase === "approved" && ids.length > 0) session.save_question_id = ids[0];
  runtime.repository.put(session);
}

async function attach(runtime: Runtime, session: StoredSession): Promise<void> {
  if (runtime.live.has(session.id)) return;
  const started = await runtime.browser.startSession({
    title: "Octto brainstorm",
    questions: initialQuestions(session),
  });
  runtime.live.set(session.id, { browserId: started.session_id, url: started.url });
  mapReopenedIds(runtime, session, started.question_ids ?? []);
  if (session.phase === "bootstrapping") void bootstrap(runtime, session, started.session_id);
  if (session.phase === "exploring" || session.phase === "review" || session.phase === "approved") {
    void run(runtime, session, started.session_id, true);
  }
}

async function ensureAttached(runtime: Runtime, session: StoredSession): Promise<void> {
  if (runtime.live.has(session.id)) return;
  let promise = runtime.attaching.get(session.id);
  if (!promise) {
    promise = attach(runtime, session).finally(() => runtime.attaching.delete(session.id));
    runtime.attaching.set(session.id, promise);
  }
  await promise;
}

async function start(runtime: Runtime, rawInput: StartInput): Promise<{ session_id: string; browser_url: string }> {
  const input = parseStartInput(rawInput);
  const session: StoredSession = {
    id: `ses_${crypto.randomUUID().replaceAll("-", "")}`,
    schema_version: SESSION_SCHEMA_VERSION,
    input: { ...input, workspace_root: realpathSync(input.workspace_root) },
    phase: "bootstrapping",
    branches: [],
  };
  runtime.repository.put(session);
  const started = await runtime.browser.startSession({ title: "Octto brainstorm" });
  runtime.live.set(session.id, { browserId: started.session_id, url: started.url });
  void bootstrap(runtime, session, started.session_id);
  return { session_id: session.id, browser_url: started.url };
}

async function status(runtime: Runtime, sessionId: string): Promise<SessionStatus> {
  const session = requireSession(runtime, sessionId);
  if (session.phase !== "cancelled" && session.phase !== "error") await ensureAttached(runtime, session);
  return {
    session_id: sessionId,
    phase: session.phase,
    pending_questions: pendingCount(session),
    browser_url: runtime.live.get(sessionId)?.url ?? "",
    error: session.error,
    saved_path: session.saved_path,
  };
}

async function getPlan(runtime: Runtime, sessionId: string): Promise<string> {
  const session = requireSession(runtime, sessionId);
  if (session.phase !== "approved" || !session.draft) throw new Error("Plan is not approved");
  return session.draft;
}

async function cancel(runtime: Runtime, sessionId: string): Promise<{ cancelled: boolean }> {
  const session = requireSession(runtime, sessionId);
  if (session.phase === "cancelled") return { cancelled: true };
  session.phase = "cancelled";
  runtime.repository.put(session);
  const attached = runtime.live.get(sessionId);
  if (attached) await runtime.browser.endSession(attached.browserId);
  runtime.live.delete(sessionId);
  return { cancelled: true };
}

async function retry(runtime: Runtime, sessionId: string): Promise<{ retrying: boolean }> {
  const session = requireSession(runtime, sessionId);
  if (session.phase !== "error") throw new Error("Session is not in an error state");
  session.phase = session.resume_phase ?? "bootstrapping";
  session.error = undefined;
  runtime.repository.put(session);
  const attached = runtime.live.get(sessionId);
  if (!attached) await ensureAttached(runtime, session);
  else if (session.phase === "bootstrapping") void bootstrap(runtime, session, attached.browserId);
  else void run(runtime, session, attached.browserId, true);
  return { retrying: true };
}

async function close(runtime: Runtime): Promise<void> {
  runtime.closed = true;
  await runtime.browser.cleanup();
  runtime.repository.close();
}

export function createPortableApp(options: {
  dataFile: string;
  model: ModelGateway;
  skipBrowser?: boolean;
}): PortableApp {
  const runtime: Runtime = {
    repository: createSessionRepository(options.dataFile),
    browser: createSessionStore({ skipBrowser: options.skipBrowser }),
    model: options.model,
    live: new Map(),
    attaching: new Map(),
    closed: false,
  };
  return {
    start: (input) => start(runtime, input),
    status: (id) => status(runtime, id),
    getPlan: (id) => getPlan(runtime, id),
    cancel: (id) => cancel(runtime, id),
    retry: (id) => retry(runtime, id),
    close: () => close(runtime),
  };
}
