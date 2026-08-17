# AIEA — AI engine

How AIEA talks to AI: providers, the host shim, agent mode, task routing, and memory.
Built in Phase 3. For *using* it, see the [user guide](guide/06-ai-engine.md). For the
shim rationale, see [decisions/002-host-ai-shim.md](decisions/002-host-ai-shim.md).

## Shape

```
/ai/providers   →  the AI connections AIEA can use
/ai/routing     →  which provider+model handles each AI task
/ai/memory      →  tagged-markdown log of every AI exchange
/ai/chat        →  dual-pane Orchestrator + Worker test chat
/ai/canvas      →  node-graph workflow view
```

Backend: `app/ai/` (engine), `app/memory/` (memory), `app/api/ai.py` + `app/api/memory.py`
(routers). The host shim is `scripts/host-ai-shim.mjs`.

## Providers

A **provider** is one configured AI connection (`providers` table). Four types:

| Type | Transport | Backed by |
|------|-----------|-----------|
| `token` | OpenAI-compatible HTTP + API key | `OpenAICompatProvider` |
| `lmstudio` | OpenAI-compatible HTTP, local | `OpenAICompatProvider` |
| `ollama` | OpenAI-compatible HTTP, local | `OpenAICompatProvider` |
| `subscription` | a logged-in CLI, via the host shim | `OpenAICompatProvider` (chat) / `AgentProvider` (agent) |

`app/ai/factory.py::build_provider(name, type, config)` turns a stored row into a live
provider object. Every provider implements `AbstractProvider`: `healthcheck()`,
`list_models()`, `complete()`.

**Test** (`POST /ai/providers/{id}/test`) runs `healthcheck()` and stores status + model
list. For **token** providers it then *probes each model with a live call* — `/models`
catalogs over-report (deprecated, embedding, image, TTS models), so the only reliable
signal is a real request. Status lights: green healthy · amber warning · red error · grey
untested.

Gemini specifics in `OpenAICompatProvider`: `_norm_model` strips Gemini's `models/` id
prefix (its `/chat/completions` wants the bare name); model discovery uses Gemini's
*native* models endpoint (it reports capabilities) plus an `_is_chat_model` name filter.

## Host shim

`scripts/host-ai-shim.mjs` — a zero-dependency Node script that runs on the **host** (not
a container) and exposes the host's logged-in `claude` / `gemini` CLIs over HTTP on port
**4023**. Subscription providers depend on it; token / LM Studio / Ollama do not.

Endpoints:
- `GET /health` — liveness + available models (drives the providers-panel status pill)
- `GET|POST /{claude,gemini}/v1/{models,chat/completions}` — OpenAI-compatible; subscription `chat` mode
- `POST /agent` — runs the full agent (see below)

Lifecycle: `pixi run up` / `down` start/stop it via `scripts/shim-ctl.sh`; or
`pixi run shim {start|stop|status|restart}`. It is on AIEA's port block — `4023`,
see [ports.md](ports.md).

## Agent mode

A subscription provider with `config.mode == "agent"` resolves to an `AgentProvider`,
which calls the shim's `/agent`. The CLI (`claude` or `gemini`) runs **headless with
tools** — MCP servers, skills, file and shell access — i.e. the real agent, not a text
completion.

- **Working directory** — `config.working_dir`, default `~/.ai/<service>/<provider>`.
  The agent's file/shell tools act inside it. AIEA-managed `.ai/` homes are auto-scaffolded
  with `CLAUDE.md` + `.claude/` or `GEMINI.md` + `.gemini/`.
- **Permission tier** — `config.permission`: `read` (explore only) · `edit` (read + write
  files, no shell) · `full` (everything incl. shell). Mapped to `--disallowedTools`
  (claude) and `--approval-mode` (gemini).

## Task routing

`/ai/routing` maps each AI task to a provider + model. `app/ai/router.py`:

- `AI_TASKS` — the 28 tasks AIEA routes, in groups: **Material** (extraction,
  classification, extraction-validation, analysis), **Generation** (question / distractor
  / answer), **Evaluation** (answer-validation, question-evaluation, rubric), **Interaction**
  (review-chat, general-chat), **Exam** (assembly, instructions), **Meta** (orchestration).
  Plus a `default` fallback.
- `TaskRoute` (params + context mode) + `TaskRouteModel` (one primary model, optional
  secondaries for cross-checking). Rows are lazy-seeded on first read.
- `resolve(db, task)` → the primary provider+model+params, falling back to `default`.

## Memory

`app/memory/` — every AI exchange is recorded as **tagged markdown**, both human- and
AI-readable. Storage (`<vault>/aiea-memory/`):

```
taxonomy.md          canonical #tag namespaces
chats/<session>.md   session logs — one ## header per exchange, a #tag line per header
index/tags.json      generated: tag → [{session, header}]
index/TAGS.md        human-readable mirror
```

Tags are hierarchical (`#task/console-chat`, `#model/claude/claude-haiku-4-5`,
`#date/2026/05/16`). `app/memory/index.py::reindex()` rebuilds the index after each write.
`/ai/memory` browses tags + sessions; `app/api/memory.py` serves it.

The console (providers panel) and the chat panel auto-log exchanges. Chat-panel sessions
each write their own `chat-<sessionId>.md`. The root is global for now; it becomes
per-course `<brain>/memory/` once generation runs against courses.

## Chat panel & canvas

- `/ai/chat` — two panes, **Orchestrator** + **Worker**, each model-switchable. An AI
  reply can be relayed to the other pane (AI-to-AI). Multi-turn (`/chat` accepts
  `history`); each pane has a session — *Clear* hides the window but keeps context, *New
  session* wipes it. State persists in `localStorage`.
- `/ai/canvas` — a React Flow workflow diagram with node-inspector panels.

## Key endpoints

```
GET    /ai/providers                  list
POST   /ai/providers                  create
PATCH  /ai/providers/{id}             update
POST   /ai/providers/{id}/test        healthcheck (+ model probe for token)
POST   /ai/providers/{id}/connect     mark usable
POST   /ai/providers/{id}/chat        chat (takes model, message, history, session)
GET    /ai/shim/health                shim status
GET    /ai/task-routes                list (lazy-seeds)
PUT    /ai/task-routes/{task}          set provider+model+params
POST   /ai/task-routes/{task}/test     probe the route
GET    /memory/{overview,tags,sessions,sessions/{name},search,taxonomy}
POST   /memory/reindex
```
