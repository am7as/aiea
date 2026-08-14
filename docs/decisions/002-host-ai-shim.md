# 002 — Host AI shim for subscription providers + agent mode

**Status:** accepted
**Date:** 2026-05-16

## Context

AIEA must talk to AI. Two access models exist:

- **Token APIs** — pay-per-use HTTP endpoints with an API key (OpenAI, Gemini API, plus
  local OpenAI-compatible servers — LM Studio, Ollama). Reachable directly from the api
  container over HTTP.
- **Subscriptions** — a flat-rate plan used through a CLI you log into: Claude Pro/Max via
  the `claude` CLI, a Google account via the `gemini` CLI. There is **no API key** — the
  credentials live in the CLI's own login state on the host.

The api runs inside a Docker container. A container cannot exec a binary that lives on the
host, and it has none of the host's CLI login state. So the containerised api cannot, by
itself, use a subscription.

Two rejected alternatives:

1. **Bake the CLIs into the image.** Install Node + `claude` + `gemini` in the api/worker
   images. Costs ~150 MB, needs an awkward in-container OAuth login, and the container is
   Linux so it can't reach the host's macOS Keychain credentials.
2. **Route everything through token APIs.** Abandons the subscription entirely — the user
   pays per token for capacity they already have flat-rate.

## Decision

A **host-side shim** — `scripts/host-ai-shim.mjs`, a zero-dependency Node script (Node is
already present because the CLIs are npm packages). It runs on the **host**, where the
CLIs and their logins already are, and exposes them over HTTP on port **4023**. The
containers reach it at `host.docker.internal:4023`.

The shim has two roles:

- **Chat** — `/{claude,gemini}/v1/chat/completions`, OpenAI-compatible. A subscription
  provider in `chat` mode is just an `OpenAICompatProvider` pointed at this URL — no
  AIEA-side special-casing.
- **Agent** — `/agent`. Runs the full agent (`claude` or `gemini`) **headless with tools**
  (MCP, skills, file/shell access). Backs subscription `agent` mode.

Lifecycle: `pixi run up` / `down` start and stop the shim alongside the containers (via
`scripts/shim-ctl.sh`); `pixi run shim {start|stop|status}` controls it directly. The
providers panel shows a live status pill.

### Agent mode

A subscription provider with `config.mode == "agent"` resolves (via `app/ai/factory.py`)
to an `AgentProvider`, which calls the shim's `/agent` endpoint. The agent runs in a
**working directory** — default `~/.ai/<service>/<provider>`, auto-scaffolded with
`CLAUDE.md` + `.claude/` (or `GEMINI.md` + `.gemini/`). Its file and shell tools act
inside that directory.

**Permission tiers** bound what the agent may do:

| Tier | Claude (`--disallowedTools`) | Gemini (`--approval-mode`) |
|------|------------------------------|----------------------------|
| `read` | `Bash,Write,Edit,NotebookEdit` | `plan` |
| `edit` | `Bash` | `auto_edit` |
| `full` | — (everything) | `yolo` |

Headless runs use a non-prompting mode (`--dangerously-skip-permissions` for claude) so
the agent never hangs waiting for an approval prompt; the *toolset* is what's cut down.

## Consequences

- **The shim must be running** for subscription providers to work. It is not optional
  infrastructure for those providers — it is the bridge. `pixi run up` handles it; the
  status pill surfaces it.
- **It installs nothing** — it uses Node and the CLIs already on the host. This keeps the
  "no host installs except Docker" rule intact (it is a *script you run*, not a dependency).
- **The shim runs as the host user.** In `full` permission, the agent can run arbitrary
  shell. That is the intended "like a terminal" capability — scoped by the working
  directory the user chooses.
- The CLI must be authenticated on the host. Claude Code: OAuth login. Gemini CLI: OAuth
  *or* `GEMINI_API_KEY` — the auth method is the CLI's own `settings.json` concern, not
  AIEA's.
- Token providers do **not** touch the shim — they are plain HTTP and work whether or not
  the shim is up.
