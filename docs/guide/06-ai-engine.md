# 06 — Setting up the AI engine

AIEA needs at least one AI model connected before it can generate or evaluate anything.
This guide walks through connecting models, the host shim, agent mode, and routing.
All of it lives under **AI Engine** in the sidebar.

## 1. Connect a provider

Open **AI Engine → Providers → Add provider**. Pick a type:

| Type | Use it for | You'll need |
|------|-----------|-------------|
| **Token** | A paid API — OpenAI, Gemini, Groq, OpenRouter… | the service's base URL + an API key |
| **LM Studio** | Local models served by LM Studio | LM Studio running (default port 1234) |
| **Ollama** | Local models served by Ollama | Ollama running (default port 11434) |
| **Subscription** | A CLI you already pay for — Claude Pro/Max, a Google account | the host shim (below) + a logged-in CLI |

For **Token**, the **Quick fill** chips pre-set known services (OpenAI, Gemini, Groq, …) —
all still editable. Fill the fields, hit **Test connection**, then **Save**.

After saving, **Test** the provider from its row. A green light means it's healthy; the
status text shows the model count. **Connect** it to make it usable by routing and chat.
The **Console** at the bottom of the panel lets you chat with any tested model right away.

> Token providers: Test does a real call to *every* model and keeps only the ones that
> actually work — model catalogs list many models (image, embedding, deprecated) that
> can't chat.

## 2. The host shim — for Subscription providers

A subscription (Claude Pro/Max, Gemini) is used through a CLI on your computer. AIEA runs
in Docker and can't reach those directly, so a small **shim** bridges them.

- It starts automatically with `pixi run up`.
- Start/stop it yourself: `pixi run shim start` / `stop` / `status`.
- The **Host AI shim** pill on the Providers page shows whether it's running.

Your CLI must be logged in on the host first — run `claude` (or `gemini`) once in a
terminal and sign in. Then add a **Subscription** provider, pick the service, Test, Connect.

## 3. Agent mode

A subscription provider has two **modes**:

- **Chat** — the model as a plain text engine. Fast, no tools.
- **Agent** — the *full* Claude Code / Gemini CLI agent: it can read files, run commands,
  use MCP servers and skills — exactly like the CLI in your terminal.

For Agent mode:

- **Working directory** — where the agent operates. Defaults to `~/.ai/<service>/<name>`,
  which AIEA creates and seeds with the agent's own `CLAUDE.md` / `GEMINI.md`. Point it at
  a course folder if you want the agent to work on real material.
- **Permission** — how much rope the agent gets:
  - **Read-only** — read and search only.
  - **Edit files** — read + write files in the working directory, no shell.
  - **Full access** — everything, including shell commands.

## 4. Route tasks to models

**AI Engine → Task Routing.** AIEA has ~16 AI tasks (question generation, evaluation,
material extraction, …). Each runs through a **route** — a provider + model + settings.

- The **Default route** is the fallback for any task you don't route explicitly.
- Expand a task to set its primary model, optional cross-check models, temperature, and
  context mode.
- **Test route** sends a tiny probe to confirm the route works.

Set the Default route first — that alone makes everything functional.

## 5. The chat panel

**AI Engine → Chat** is a two-pane workbench: an **Orchestrator** and a **Worker**, each
on any model you pick. An AI reply can be **relayed** to the other pane — useful for
having one model check or extend another. Each pane keeps a session:

- **Clear** empties the window but keeps the conversation context.
- **New session** starts fresh — a new memory file, no prior context.

The conversation survives navigating away and back.

## 6. Memory

**AI Engine → Memory.** Every AI exchange is logged as tagged Markdown under
`vault/aiea-memory/chats/`. Each session is its own file; the panel lets you browse by
**tag** or open a session. This is how AIEA — and you — can look back at what was asked
and answered.

---

Once a Default route is set and a provider is connected, the AI engine is ready. Question
generation and evaluation (the actual exam loop) build on top of it — see
[05 — Generate / refine / promote](05-generate-refine-promote.md).
