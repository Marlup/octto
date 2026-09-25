import { z } from "zod";

import type { QuestionType } from "@/session";

export type ModelRole = "branches" | "probe" | "draft" | "revise";
export interface ModelGateway {
  generate(role: ModelRole, input: unknown): Promise<unknown>;
}
export interface StartInput {
  request: string;
  workspace_root: string;
  context?: { constraints?: string[]; excerpts?: Array<{ source: string; text: string }> };
}
export interface PlannedQuestion {
  id: string;
  type: QuestionType;
  config: { question: string; [key: string]: unknown };
  answer?: unknown;
}
export interface Branch {
  id: string;
  scope: string;
  questions: PlannedQuestion[];
  finding?: string;
}
export type Phase = "bootstrapping" | "exploring" | "review" | "approved" | "error" | "cancelled";
export const SESSION_SCHEMA_VERSION = 1;
export interface StoredSession {
  id: string;
  schema_version: typeof SESSION_SCHEMA_VERSION;
  input: StartInput;
  phase: Phase;
  branches: Branch[];
  draft?: string;
  review_question_id?: string;
  revision_feedback?: string;
  save_question_id?: string;
  save_requested?: boolean;
  save_choice?: "save" | "skip";
  error?: string;
  resume_phase?: Exclude<Phase, "error" | "cancelled">;
  saved_path?: string;
}

const MAX_BRANCHES = 4;
const MAX_REQUEST_LENGTH = 20_000;
const MAX_EXCERPTS = 30;
const MAX_EXCERPT_LENGTH = 10_000;
const MAX_CONSTRAINTS = 30;
const MAX_CONSTRAINT_LENGTH = 500;
const questionTypes = ["pick_one", "pick_many", "confirm", "ask_text", "rank", "show_diff"] as const;
const optionSchema = z.object({ id: z.string().min(1), label: z.string().min(1) }).passthrough();
const questionSchema = z
  .object({
    type: z.enum(questionTypes),
    config: z.object({ question: z.string().min(1), context: z.string().optional() }).passthrough(),
  })
  .superRefine(({ type, config }, ctx) => {
    if (["pick_one", "pick_many", "rank"].includes(type)) {
      const parsed = z.array(optionSchema).min(1).safeParse(config.options);
      if (!parsed.success) ctx.addIssue({ code: "custom", message: `${type} requires nonempty options` });
    }
    if (type === "show_diff" && (typeof config.before !== "string" || typeof config.after !== "string")) {
      ctx.addIssue({ code: "custom", message: "show_diff requires before and after" });
    }
  });
const branchSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  scope: z.string().min(1),
  initial_question: questionSchema,
});

export const startInputSchema = z.object({
  request: z.string().min(1).max(MAX_REQUEST_LENGTH),
  workspace_root: z.string().min(1),
  context: z
    .object({
      constraints: z.array(z.string().max(MAX_CONSTRAINT_LENGTH)).max(MAX_CONSTRAINTS).optional(),
      excerpts: z
        .array(z.object({ source: z.string().min(1), text: z.string().max(MAX_EXCERPT_LENGTH) }))
        .max(MAX_EXCERPTS)
        .optional(),
    })
    .optional(),
});

export function parseStartInput(value: unknown): StartInput {
  return startInputSchema.parse(value);
}

export function parseQuestion(value: unknown): PlannedQuestion {
  const question = questionSchema.parse(value);
  return { id: "", type: question.type, config: question.config };
}

export function parseBranches(value: unknown): Branch[] {
  const parsed = z.object({ branches: z.array(branchSchema).min(2).max(MAX_BRANCHES) }).parse(value);
  const ids = parsed.branches.map((branch) => branch.id);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate branch ID");
  return parsed.branches.map((branch) => ({
    id: branch.id,
    scope: branch.scope,
    questions: [parseQuestion(branch.initial_question)],
  }));
}

export function parseProbe(
  value: unknown,
): { done: true; finding: string } | { done: false; question: PlannedQuestion } {
  const parsed = z
    .union([
      z.object({ done: z.literal(true), finding: z.string().min(1) }),
      z.object({ done: z.literal(false), question: questionSchema }),
    ])
    .parse(value);
  return parsed.done ? parsed : { done: false, question: parseQuestion(parsed.question) };
}

export function parseDraft(value: unknown): string {
  return z.string().min(1).parse(value);
}

export function browserQuestion(
  question: PlannedQuestion,
  scope: string,
): { type: QuestionType; config: PlannedQuestion["config"] } {
  const context = typeof question.config.context === "string" ? question.config.context : "";
  return { type: question.type, config: { ...question.config, context: `[${scope}] ${context}`.trim() } };
}

export function saveQuestion(): { type: QuestionType; config: PlannedQuestion["config"] } {
  return {
    type: "pick_one",
    config: {
      question: "Save this approved plan in the selected workspace?",
      options: [
        { id: "save", label: "Save to docs/plans" },
        { id: "skip", label: "Do not save" },
      ],
    },
  };
}

export function reviewQuestion(draft: string): { type: QuestionType; config: PlannedQuestion["config"] } {
  return { type: "show_plan", config: { question: "Review implementation plan", markdown: draft } };
}

export function pendingCount(session: StoredSession): number {
  if (session.phase === "review") return session.revision_feedback ? 0 : 1;
  if (session.phase === "approved")
    return session.save_question_id && !session.save_choice && !session.save_requested ? 1 : 0;
  if (session.phase !== "exploring") return 0;
  return session.branches.flatMap((branch) => branch.questions).filter((question) => question.answer === undefined)
    .length;
}
