# AIEA — Setup

## Prerequisites

- **Docker** with Compose v2. Nothing else on host.
- (Optional) **LM Studio** running on host with local server enabled on port 1234.

## What folders AIEA can see

AIEA needs to read folders on your Mac. Out of the box it can read three subpaths of your home directory:

```
~/Downloads     # source materials often live here
~/aiea          # default home for AIEA-managed workspaces
~/Documents     # additional common location
```

These are configured via `AIEA_ALLOWED_ROOTS` (colon-separated) and matched by bind mounts in `infra/docker-compose.yml`. If you want AIEA to see a different folder (e.g. Dropbox), add it to BOTH the env var and the volumes block — see `docs/troubleshooting.md` entry #10 for *why never `$HOME` whole*.

## First-time bring-up

```bash
cp .env.example .env

docker compose -f infra/docker-compose.yml up -d --build

# Two-step migration: generate then apply (don't skip the first)
docker compose -f infra/docker-compose.yml exec api pixi run revision -m "initial"
docker compose -f infra/docker-compose.yml exec api pixi run migrate

# Sanity
curl -s http://localhost:4021/api/v1/health/deep
# → {"status":"ok","db":"ok"}
```

Open `http://localhost:4020`. No login. You're in.

Host-port allocation lives in `docs/ports.md` — AIEA owns the **4020–4039** block (frontend 4020, api 4021, caddy 4022, postgres 4025, redis 4026).

## First workflow — get from zero to "AIEA reading my course folder"

1. **Create a course.** Sidebar → Courses → New course. Fill in code (`SSY300`), title, language (`sv`/`en`/`fa`), short description.
   - If you have an existing course folder from previous work, use **Custom mode** and paste its path under "Materials". You can fill the other three later from the Workspace section.
   - If you want a fresh layout, use **Quick mode** with one parent folder (e.g. `~/aiea/SSY300`); AIEA creates `materials/`, `brain/`, `library/`, `workshop/` inside it.

2. **Open Workspace.** Sidebar → Workspace. You'll see the four folder rows + a content panel for each role.
   - Each row has 🖋️ (edit path inline) and 📂 (open folder picker). Both write through `PATCH /courses/{id}/paths`.
   - When you edit a path, there's a **"also scaffold canonical subfolders"** checkbox. Default on. Uncheck if you're pointing at an existing folder tree and don't want AIEA to add its own subfolders.
   - The 🪄 **"Set up / connect from one parent"** button at the top opens a modal with two actions:
     - **Connect existing** — just set the four paths, no on-disk changes.
     - **Create & scaffold** — idempotent: creates whichever of the four are missing + their canonical subfolders.

3. **Drop materials into the materials folder.** Use Finder or `cp`. AIEA's canonical structure is:
   ```
   <materials>/book/         main textbook + errata
   <materials>/lectures/     PPTX / PDF lecture decks
   <materials>/exercises/    exercise sheets
   <materials>/exams/        past exams (PDF + .tex + solutions)
   <materials>/exam-template/  LaTeX .sty / instructions.tex / template.md (NOT ingested — used at export time)
   <materials>/other/        formulas, dictionaries, hand-ins
   ```

4. **Rescan + ingest.** In Workshop's Materials panel, click **🟦 Rescan materials**. AIEA walks the folder, registers each file as a `Material` row in the database, and shows it as `pending`. Then either:
   - Click **Ingest** per-row to extract text from one file, or
   - Click **Scan + ingest all new** to batch-process everything

   Extracted text lands in `<workshop>/extracted/<material-id>/extracted.md` — Obsidian-friendly Markdown with page-aware sections.

5. **(Future)** Generate questions → refine via chat → assemble exam → export to LaTeX using your `exam-template/`. Phases 3–8 in `.claude/plans/00-initial.md`.

## Connecting AI providers (Phase 3, not shipped yet)

The AI gateway will support Claude CLI / Gemini CLI / LM Studio:

- **LM Studio**: run LM Studio on host, enable Local Server, load a model. The future `/ai/providers` panel flips to `healthy` when reachable at `host.docker.internal:1234`.
- **Claude CLI / Gemini CLI**: subprocess-based providers; auth in `creds/claude/`, `creds/gemini/`.

## Hot reload

- Backend: edit anything under `backend/app/` — uvicorn reloads.
- Frontend: edit anything under `frontend/src/` — Next.js fast-refreshes.
- Pixi: change `backend/pixi.toml` → rebuild the affected service: `docker compose -f infra/docker-compose.yml up -d --build api`.

## Refresh vs. Rescan (in the Workspace UI)

- **🔄 Refresh** = re-read the disk and update the UI. **No DB changes, no extraction.** Cheap.
- **🟦 Rescan materials** = walk `materials/` and register *new* files as `Material` rows (no extraction yet). Use after dropping new files in.
- Per-row **Ingest** = extract text from one registered material.

## Resetting

```bash
docker compose -f infra/docker-compose.yml down       # stop, keep data
docker compose -f infra/docker-compose.yml down -v    # nuke named volumes (pixi envs, node_modules)
# Postgres data lives at host path ./data/pg/ and survives down -v
```

To wipe Postgres too: `rm -rf data/pg/` (then re-run migrations after bring-up).

## Sharing the clean version

```bash
./scripts/sync-to-clean.sh         # syncs to ../aiea-clean/, commits
./scripts/sync-to-clean.sh --push origin  # also pushes to remote
```

## If something breaks

Read `docs/troubleshooting.md` — entries 1–10 cover known bring-up bugs. **Entry #10 is the one most likely to bite you again**: never bind-mount the whole `$HOME` on macOS Docker. If Docker Desktop crashes on boot with "service fs failed", that's the cause — follow the recovery steps there.

## Where to read next

- `docs/architecture.md` — the four-folder model, the worker-only deps rule, module layout
- `docs/guide/` — task-oriented walkthroughs (getting started, connecting folders, ingesting materials)
- `docs/diagrams/` — system architecture, folder model, request flow
- `.claude/plans/00-initial.md` — phase-by-phase build plan with what's done / what's next
