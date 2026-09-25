# Portable Octto architecture

## Boundary and contracts

The MCP host is an initiator and consumer, not the orchestrator. `octto_start` accepts a goal, an absolute workspace root, and optional bounded constraints or cited excerpts. It returns one public session ID and a tokenized loopback browser URL. `octto_status` is non-blocking; `octto_get_plan` returns Markdown only after browser approval; `octto_retry` resumes an errored phase; `octto_cancel` ends interaction without deleting the record. The host must not infer approval from a generated draft or write/implement anything merely because a draft exists.

The local service owns the model gateway, durable state, browser session, review, and explicit save. It never invokes host-specific agent APIs. The browser's internal ID remains private to the service. A model gateway has one operation, `generate(role, input)`, with four roles: branches, probe, draft, revise. Prompts and Zod parsers constrain outputs. Model and endpoint selection are environment configuration, not hardcoded host or model names.

| Concern | Module | Contract |
| --- | --- | --- |
| MCP transport | `src/portable/mcp.ts`, `cli.ts` | Stdio tools, no long-running tool call |
| Orchestration | `workflow.ts` | One public ID and explicit phases |
| Validation | `contracts.ts` | Bounded inputs and parsed model outputs |
| Model transport | `model.ts` | OpenAI Responses or compatible chat completions |
| Browser | Existing `src/session/` | Loopback token URL and typed questions |
| Persistence | `repository.ts` | SQLite record per public session |
| Plan write | `writer.ts` | Explicit save, workspace containment, exclusive/idempotent file |
| Host templates | `host-config.ts` | Configuration text only; no host behavior inside core |

## Lifecycle

`bootstrapping → exploring → review → approved` is the normal path. Exploring has two to four independent branches; each answer is persisted before the next probe. A branch can ask another question or record a finding. Once every branch has a finding, the service drafts Markdown and asks the browser user to approve or request a revision. Approval exposes the draft to `octto_get_plan`, then asks a separate save/skip question. Saving is opt-in and writes under the selected workspace's `docs/plans/`.

An error stores its preceding phase. Retry reuses the same public ID and saved answers. Revision feedback and save intent are persisted before their external calls, allowing those phases to resume too. On server restart, status reattaches a fresh browser and reopens pending questions; the old URL is invalid. Cancellation is terminal. The service currently uses polling from the host; it does not push a host notification.

## What is preserved and what is lost

This is a narrower first release, not feature parity. Relative to the original OpenCode plugin, the portable core preserves parallel question branches, follow-up probes, browser review, revision, and plan creation. It loses implicit use of the host's model/configuration, OpenCode agent/subagent integration, automatic repository context, and eight of fourteen visual question types for generated branch/probe questions. It also does not restore completed browser cards after a service restart. No host-specific delegation or autonomous implementation is provided; the host decides what to do with an approved plan under its own user instructions.

The table is a design estimate on a five-point scale, not empirical host testing. Recovery means how much of the original capability this version retains or restores (1 = very little, 5 = near parity); ease means implementation ease (5 = easiest).

| Capability | Recovery now | Ease of further recovery | Next mitigation |
| --- | ---: | ---: | --- |
| Parallel interactive branches and follow-ups | 4 | 4 | Broader tests for mixed question types |
| Review, revision, explicit plan save | 4 | 4 | Durable browser history and approval audit |
| Host-native model/subagent reuse | 1 | 2 | Optional host adapter only after stable core |
| Automatic repository context | 2 | 3 | Explicit context collector with citations and size bounds |
| Fourteen visual input types | 2 | 3 | Expand output schemas and tests by type |
| Restart visual continuity | 2 | 3 | Rehydrate answered cards from saved state |
| Any-host installation and ergonomics | 2 | 2 | Test and package each host separately |

## Host rollout

Start with Codex only. Its local stdio MCP config can exercise the complete public contract without adding a host-specific implementation. After a verified Codex run with a real model and browser, test Claude Code, then Antigravity and Copilot. Kilo and ZooCode follow. Keep each adapter to configuration, installation checks, and genuine host quirks; do not fork the workflow per host. The six generated configuration templates are hypotheses until tested in each host and operating system.

The test boundary is the MCP client and browser socket, with a fake model only at the external provider boundary. Provider wire-format tests use local HTTP fixtures. A production-ready claim additionally requires a live model run, host installation run, cross-platform package test, and security review. Passing unit/integration tests alone does not establish those claims.
