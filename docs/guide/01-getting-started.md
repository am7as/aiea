# 01 — Getting started

The shortest path from a fresh checkout to "AIEA is reading my course materials and showing them on the dashboard".

**Time:** ~10 minutes, mostly waiting for Docker to build images the first time.

## Prerequisites

- Docker Desktop running on macOS
- A course folder somewhere on your Mac (or be willing to let AIEA create one under `~/aiea/`)

## 1. Bring up the stack

```bash
cd ~/aiea

cp .env.example infra/.env   # only the first time
docker compose -f infra/docker-compose.yml up -d --build
```

Wait for `Container aiea-api Started`. The first build takes about 5 to 15 minutes; later runs are seconds.

Check it's alive:

```bash
curl -s http://localhost:4021/api/v1/health/deep
# → {"status":"ok","db":"ok"}
```

## 2. Apply the initial migration (first time only)

```bash
docker compose -f infra/docker-compose.yml exec api pixi run revision -m "initial"
docker compose -f infra/docker-compose.yml exec api pixi run migrate
```

(If migration files already exist in `backend/alembic/versions/`, just run `migrate` and skip `revision`.)

## 3. Open the app

```
http://localhost:4020
```

You'll land on the dashboard. Since you have zero courses, you'll see a "Set up your first course" empty state.

## 4. Create your first course

Click **+ New course**.

Fill in:

- **Code** — short identifier (e.g. `SSY300`, `CS101`)
- **Title** — full name (e.g. `Applied Mechatronics`)
- **Language code** — `en`, `sv`, `fa`, etc. (used later for AI prompts)
- **Topics** — comma-separated tags (optional)
- **Description** — Markdown notes about the course (optional)

Then pick a folder-layout mode:

### Quick mode (recommended for first try)

- Enter one parent folder. AIEA will create `<parent>/materials`, `<parent>/brain`, `<parent>/library`, `<parent>/workshop` inside it, plus all their canonical subfolders.
- Default suggestion: `/Users/yourname/aiea/<CODE>` (e.g. `/Users/yourname/aiea/SSY300`).
- Click the **Browse** button to pick a parent folder visually. AIEA's folder picker is sandboxed to whatever you set in `AIEA_ALLOWED_ROOTS` — see [02 - Connecting your folders](02-connecting-folders.md) to add more.

### Custom mode

- Enter four explicit paths. Use this when you want the four folders in different places (e.g. materials in Dropbox, brain in iCloud).

Click **Create course**. AIEA creates the folder layout and redirects you to the course detail page.

## 5. Check the dashboard

Sidebar → **Dashboard**. You'll see:

- **Folder health card** — four small tiles, one per role, showing the path and file count. Tiles are colored ok / amber / red based on whether each path is set and exists.
- **KPI grid** — Courses, Materials, Questions, Exams.
- **Next steps checklist** — what to do next. The first item ("Connect the four folders") should be checked off.

If something's amber: click "Manage →" to jump to Workspace.

## 6. Drop your first material

Open Finder. Navigate to your course's materials folder (e.g. `~/aiea/SSY300/materials/lectures/`). Drop a PDF in there. (You can drag from anywhere.)

## 7. Tell AIEA to look

Sidebar → **Workspace** (or click **Manage →** on the dashboard).

In the **Materials** content panel, click **🟦 Rescan materials** (top right). AIEA walks the folder, finds the new file, and registers it as a `Material` with status `pending`.

The file now appears in the **lectures** card with a `pending` pill.

## 8. Extract its text

Click **Ingest** next to the file. The worker reads it, parses the text (PDF → page-aware Markdown), and writes `extracted.md` into `<workshop>/extracted/<material-id>/`.

A few seconds later the pill flips to green `done`, and the file shows `pages` and `word_count`.

Open the extracted Markdown to see what AIEA produced:

```bash
open ~/aiea/SSY300/workshop/extracted/*/extracted.md
```

It opens cleanly in Obsidian, VS Code, or any Markdown previewer.

## You're set up

From here:

- [02 - Connecting your folders](02-connecting-folders.md) — re-target paths, attach existing trees, use Dropbox/iCloud
- [03 - Ingesting materials](03-ingesting-materials.md) — batch ingest, what gets filtered out, how to add a new file type
- [04 - Working day-to-day](04-daily-workflow.md) — the rhythm of dashboard → workspace → drop files → scan
