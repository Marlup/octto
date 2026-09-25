# Octto Portable (Codex-first prototype)

This fork separates Octto's browser brainstorming from its original OpenCode agent plugin. A local MCP server owns the session, browser interaction, model calls, review, and optional plan save. A coding host only starts the session, checks status, and retrieves the user-approved plan. The host does not receive the browser's internal session ID or become the source of truth for the workflow.

This is source-build software, not a published package. Codex is the first integration target; templates for Claude Code, Antigravity, Copilot, Kilo, and ZooCode are experimental and have not been exercised in those hosts. No live model-provider or host end-to-end run is claimed yet.

## Run from source (PowerShell)

Install [Bun](https://bun.com/docs/installation), then run from this repository:

```powershell
bun install
bun run build
$env:OCTTO_MODEL_PROVIDER = "openai"
$env:OCTTO_MODEL = "<your-model-id>"
$env:OPENAI_API_KEY = "<your-key>"
bun dist/cli.js --print-config codex
```

Add the printed entry to your [Codex MCP configuration](https://developers.openai.com/learn/docs-mcp) and restart Codex. Keep the key in the environment or your normal secret manager, never in this repository. The generated entry uses `env_vars` to forward the variables above to the local server. For an OpenAI-compatible endpoint, set `OCTTO_MODEL_PROVIDER=compatible`, `OCTTO_MODEL_BASE_URL`, `OCTTO_MODEL`, and optionally `OCTTO_MODEL_API_KEY`. Compatibility means chat-completions wire format, not guaranteed model quality or JSON reliability.

Ask Codex to call `octto_start` with `request` and an absolute `workspace_root`. Open the returned loopback URL, answer questions, review the plan, and explicitly choose whether to save it. Codex can poll `octto_status`, call `octto_retry` after a recoverable failure, and call `octto_get_plan` only after approval. `octto_cancel` closes the browser session without deleting its durable record. Saving writes one Markdown file under `docs/plans/` in the selected workspace; approval alone does not write a file or authorize implementation.

The service uses its own model API credentials. It does not borrow the Codex, Claude, or other host's subscription, login, model, tool access, or context window. Sessions survive a server restart, but the browser URL changes and pending questions are re-opened when the host checks status. The current prototype does not restore the full visual answer history. Generated branch/probe questions use a six-type subset of the original fourteen UI inputs. See [architecture and limitations](docs/portable-architecture.md).

The original OpenCode plugin source and tests remain in this repository for attribution and reference, but the portable package build targets only `src/portable/cli.ts`. The original plugin instructions below describe upstream behavior, not this fork's portable entry point.

## Original OpenCode plugin (upstream documentation)

# octto

An interactive browser UI for AI brainstorming. Stop typing in terminals. Start clicking in browsers.



https://github.com/user-attachments/assets/9ba8868d-16f3-4451-9b73-6b7e1fc54655



When you describe your idea, octto opens an interactive UI:

- Click options instead of typing
- See all questions at once
- Answer in any order
- Watch follow-ups appear instantly
- Review the final plan visually

**10 minutes of terminal typing → 2 minutes of clicking.**

## Quick Start

Add to `~/.config/opencode/opencode.json`:

```json
{ "plugin": ["octto"] }
```

Select the **octto** agent:

```
I want to add a caching layer to the API
```

A browser window opens. Click your answers. Done.

## The Interactive UI

### Rich Question Types

No more typing everything. Pick from 14 visual input types:

| Type | What You See |
|------|--------------|
| `pick_one` | Radio buttons |
| `pick_many` | Checkboxes |
| `confirm` | Yes/No buttons |
| `slider` | Draggable range |
| `rank` | Drag to reorder |
| `rate` | Star rating |
| `thumbs` | Thumbs up/down |
| `show_options` | Cards with pros/cons |
| `show_diff` | Side-by-side code diff |
| `ask_code` | Syntax-highlighted editor |
| `ask_text` | Text input (when needed) |
| `ask_image` | Image upload |
| `ask_file` | File upload |
| `emoji_react` | Emoji picker |

### Live Updates

- Questions appear as you answer previous ones
- Progress indicator shows remaining questions
- Completed answers visible for context
- Final plan rendered as reviewable sections

### Parallel Branches

Your request is split into 2-4 exploration branches. All initial questions appear at once:

```
         ┌─ Branch 1: [question card]
Request ─┼─ Branch 2: [question card]
         └─ Branch 3: [question card]
                ↓
        Answer any, in any order
```

Each branch goes as deep as needed. Some finish in 2 questions, others take 4.

## How It Works Behind the Scenes

### 3 Agents

| Agent | Job |
|-------|-----|
| **bootstrapper** | Splits your request into branches |
| **probe** | Decides if a branch needs more questions |
| **octto** | Orchestrates the session |

### The Flow

1. Bootstrapper creates 2-4 branches from your request
2. Each branch gets an initial question → all shown in browser
3. You answer (click, not type)
4. Probe agent evaluates: more questions or done?
5. Repeat until all branches complete
6. Final plan shown for approval
7. Design saved to `docs/plans/`

## Configuration

Optional `~/.config/opencode/octto.json`:

```json
{
  "model": "anthropic/claude-sonnet-4",
  "port": 3000,
  "agents": {
    "probe": { "model": "openai/gpt-4o" }
  }
}
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | string | - | Override the model for **all** agents at once |
| `port` | number | `0` (random) | Fixed port for the browser UI server |
| `agents` | object | - | Per-agent overrides (model, temperature, etc.) |
| `fragments` | object | - | Custom instructions injected into agent prompts |

> **Precedence**: per-agent `agents.<name>.model` > top-level `model` > built-in default

### Fragments

Inject custom instructions into agent prompts. Useful for customizing agent behavior per-project or globally.

**Global config** (`~/.config/opencode/octto.json`):

```json
{
  "fragments": {
    "octto": ["Always suggest 3 implementation approaches"],
    "probe": ["Include emoji in every question"],
    "bootstrapper": ["Focus on technical feasibility"]
  }
}
```

**Project config** (`.octto/fragments.json` in your project root):

```json
{
  "octto": ["This project uses React - focus on component patterns"],
  "probe": ["Ask about testing strategy for each feature"]
}
```

Fragments are merged: global fragments load first, project fragments append. Each fragment becomes a bullet point in a `<user-instructions>` block prepended to the agent's system prompt.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `OCTTO_PORT` | Override port (takes precedence over config file) |

For Docker workflows, set a fixed port:

```bash
OCTTO_PORT=3000 opencode
```

## Development

```bash
bun install
bun run build
bun test
```

## License

MIT
