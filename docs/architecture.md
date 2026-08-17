# AIEA — Architecture

Single-user web tool for course examiners. Same Pixi-in-Docker + FastAPI + Next.js shape as the sibling project AASAP, with three differences: no auth layer, file-ingestion replaces web-scraping, and the domain is courses → materials → questions → exams instead of jobs → applications.

## Service map

```
┌─── HOST (single user) ─────────────────────────────────────────────┐
│  Docker Compose                                                      │
│  frontend (Next.js) ──► api (FastAPI) ──► postgres / redis          │
│                          │  │                                        │
│                          │  └► ai/      providers · routing · memory │
│                          │              (AI engine — Phase 3)        │
│                          └► worker (ARQ + APScheduler)               │
│                                ├► extract/  (PDF / DOCX / PPTX)      │
│                                ├► generate/ · evaluate/ · review/    │
│                                └► export/   (PDF / LaTeX / MD)       │
│                                                                       │
│  host AI shim  :4023   (scripts/host-ai-shim.mjs — runs on the HOST) │
│      └► claude / gemini CLI   ← subscription providers + agent mode  │
│                                                                       │
│  Bind-mounts                                                          │
│    ./backend  → /workspace   (hot reload uvicorn --reload)           │
│    ./frontend → /workspace   (next dev hot reload)                   │
│    ./vault    → /vault       (Obsidian Markdown + aiea-memory/)      │
│    ./creds    → /creds       (Claude / Gemini CLI auth)              │
│    ./models   → /models      (local GGUF/MLX)                         │
│    ./docs     → /aiea-docs   (in-app docs viewer, read-only)         │
└────────────────────────────────────────────────────────────────────────┘
```

The **host AI shim** is not a container — it's a Node script run on the host so the
containers can reach the host's logged-in `claude` / `gemini` CLIs over HTTP. See
[decisions/002-host-ai-shim.md](decisions/002-host-ai-shim.md) and [ai-engine.md](ai-engine.md).

## Datastore

Postgres 16. **No `users` table** — AIEA is single-user. Core models:

- `courses` — one row per course. Holds `materials_path`, `brain_path`, `library_path`, `workshop_path` (four absolute host paths defining this course's workspace), plus `code`, `title`, `description`, `topics`, `language`.
- `materials` — registered files. `collection: book|lectures|exercises|exams|other` (derived from the canonical materials subfolder). `subpath` (relative to `materials_path`, e.g. `lectures/L01.pptx`). Extraction state lives here.
- `questions` — current state of one question. Status flow: `draft → generated → evaluating → ready → in_exam → archived`.
- `question_iterations` — versioned snapshots from the interactive review chain.
- `exams` + `exam_questions` — assembled exams with point values and ordering.
- `providers` — user-configured AI connections. `type: subscription|token|lmstudio|ollama`, `config` (JSON, per-type), `status`, `models`, `connected`.
- `task_routes` + `task_route_models` — each AI task → its params + assigned models (one primary, optional secondaries pointing at `providers`).
- `ai_conversations` + `ai_messages` + `provider_sessions` — chat persistence + mid-task model swap (scaffolded; the console/chat panels currently log to file-based memory instead).

## Folder layout — four roots per course

AIEA replaces a single global `vault/` with **four user-chosen folders per course**, each with a clear role:

```
<materials>/                       reference course material — you populate, AIEA reads
├── .aiea/course.json
├── book/         lectures/       exercises/      exams/
├── exam-template/                                 other/

<brain>/                           AI behavior + memory — you tune, AIEA reads on every prompt
├── .aiea/course.json
├── skills/       agents/         hooks/          prompts/        memory/

<library>/                         final clean outputs — AIEA writes on promote
├── .aiea/course.json
├── question-bank/<qid>.md                        ← promoted questions
└── exams/<exam-id>/{exam.md, exam.tex, exam.pdf, answer-key.md}

<workshop>/                        interactive AI ↔ user space
├── .aiea/course.json
├── extracted/<material-id>/{extracted.md, meta.json}
├── questions/<qid>/{current.md, iter-NNN.md, chat.md, evaluation.md}
├── exams/<eid>/{exam-draft.md, chat.md, checklist.md}
├── chats/        checklists/     logs/{cost.jsonl, runs.jsonl}
```

**Why four:**
- **materials** and **brain** are *inputs* — references AIEA reads but doesn't author. The split keeps the user's reference shelf separate from their AI tuning so each can be backed up / shared / version-controlled differently.
- **library** and **workshop** are *outputs* separated by commitment level. Workshop is process (messy, iterated, contains chats and drafts). Library is product (curated, dated, shippable). Promotion from workshop → library is an explicit user action.

**Host paths, not bind-mounted vault.** Each course's four roots live anywhere on the host filesystem the user picks (e.g. `~/Downloads/SSY300-course/` for materials, `~/iCloud/aiea-brain/ssy300/` for brain, etc.). The api and worker containers reach them via narrow bind mounts driven by `AIEA_ALLOWED_ROOTS` (colon-separated). There is no default: the stack refuses to start until you set it in `infra/.env`. **Never bind-mount the whole `$HOME`** — see `docs/troubleshooting.md`.

**Canonical subfolder bootstrap.** When a course is created (or paths re-targeted), AIEA calls `app/vault/bootstrap.py::bootstrap_course_folders` which `mkdir -p`s the four roots and their canonical subfolder layout, then stamps `.aiea/course.json` (with the matching `course_id`) inside each. Idempotent — safe to point at folders with existing content. The dashboard also exposes a per-role "Scaffold subfolders" button and a "Set up from one parent" action that creates all four under a single parent.

**Folder picker.** The dashboard and course-create form use a server-side folder browser (`GET /api/v1/fs/list`) sandboxed to `AIEA_ALLOWED_ROOTS` — the user clicks to drill down, picks any folder, AIEA creates subfolders on save. Paste still works for power users.

## Module layout — backend

```
backend/app/
├── main.py            FastAPI app + lifespan + router registration
├── config.py          pydantic-settings
├── deps.py            get_db
├── db/
│   ├── base.py        SQLAlchemy async engine + Base
│   └── models/*.py    course, material, question, exam, ai, task_route
├── api/
│   └── *.py           routers per domain
├── ai/                AI engine — see ai-engine.md
│   ├── events.py      ChatMessage / GenParams
│   ├── factory.py     build_provider() — a live provider from a Provider row
│   ├── router.py      AI_TASKS + resolve(db, task) → provider+model+params
│   └── providers/{base,openai_compat,agent}.py
├── memory/            tagged-markdown memory
│   ├── tags.py        extract #hierarchical/tags
│   ├── store.py       session-log writer + taxonomy
│   ├── index.py       build tags.json + TAGS.md
│   └── retrieval.py
├── extract/           PDF / DOCX / PPTX parsers — WORKER-ONLY
│   ├── registry.py    lazy import per kind (DO NOT import classes here)
│   ├── pdf.py
│   ├── docx.py
│   ├── pptx.py
│   └── md.py
├── generate/          question generation from material
├── evaluate/          AI scoring (correctness, difficulty, bloom, time)
├── review/            interactive chat refinement chain
├── export/            PDF / LaTeX / Markdown exam exporters
├── workers/main.py    ARQ entry + APScheduler
├── workflows/         long-running tasks (ingest, generate, evaluate)
└── vault/             reader / writer / watcher
```

## Module layout — frontend

```
frontend/src/
├── app/
│   ├── (dashboard)/
│   │   ├── layout.tsx (no auth gate, unlike AASAP)
│   │   ├── dashboard/page.tsx           KPIs: courses, materials, questions, exams
│   │   ├── courses/page.tsx + [id]/page.tsx
│   │   ├── materials/page.tsx           list + upload + ingest status
│   │   ├── questions/page.tsx + [id]/page.tsx (review pane)
│   │   ├── exams/page.tsx + [id]/page.tsx (builder + export)
│   │   ├── ai/{providers,routing,memory,canvas,chat}/page.tsx — AI engine
│   │   ├── monitoring/page.tsx
│   │   └── settings/page.tsx
│   ├── layout.tsx (no auth)
│   └── globals.css
├── components/{Shell,Sidebar,TopBar,KpiCard,FolderPicker,MarkdownRenderer,Mermaid}.tsx
└── lib/{api.ts, cn.ts}
```

## Service-deps rule (READ THIS)

The api container's pixi env (`pixi install -e default`) does NOT have heavy parsers. The worker env (`pixi install -e worker`) does. Modules under `app/extract/*` must NEVER be imported at module-load by anything the api loads. Use `importlib.import_module()` in `app/extract/registry.py` and enqueue ARQ jobs from any api route that needs ingestion.

This is the same rule that bit AASAP. The decision record is at `docs/decisions/001-worker-vs-api-deps.md`.
