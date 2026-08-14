# 02 — Connecting your folders

How to point AIEA at folders that already exist, change paths later, and use paths outside the default home subfolders.

## The four roles, recap

| Role | What's inside | Who writes |
|---|---|---|
| **materials/** | Your course material (book, lectures, exercises, exams, exam-template, other) | You |
| **brain/** | AI behavior tuning (skills, agents, hooks, prompts, memory) | You (rarely) |
| **library/** | Final clean outputs (question-bank/, exams/) | AIEA on promote |
| **workshop/** | Drafts + chats + extracted text | AIEA + you |

You can put these anywhere AIEA is allowed to read — see [Default allowed roots](#default-allowed-roots) below.

## Three modes for setting them up

### Mode A — Create fresh from one parent (Quick)

**Use when:** starting a new course, no existing layout.

In **Workspace** (or the course-create form), click **🪄 Set up / connect from one parent**.

1. Type or **Browse** to a parent folder (e.g. `/Users/yourname/aiea/CS101`).
2. After ~300ms a preview appears showing what's inside the parent.
3. Click **Create & scaffold**. AIEA creates the four subfolders + all their canonical inner subfolders + `.aiea/course.json` stamps.

### Mode B — Connect to existing parent

**Use when:** you already have `<parent>/materials`, `<parent>/brain`, `<parent>/library`, `<parent>/workshop` from previous work and *don't* want AIEA to add anything.

Same dialog as Mode A:

1. Browse to your existing parent.
2. Preview shows ✓ for each subfolder that exists.
3. Click **Connect existing** (the gray button). AIEA just sets the four paths — no `mkdir`, no `README.md`, no `.aiea/` stamps unless they already exist.

If only some of the four subfolders exist, AIEA still connects to whatever's there. The dashboard will mark missing folders amber and offer per-role **Scaffold subfolders** buttons to create them when you're ready.

### Mode C — Mix and match (Custom)

**Use when:** the four roles live in completely different places. Most realistic combo:

- `materials/` → `/Users/yourname/Downloads/SSY300-applied-mechatronics` (synced with TAs)
- `brain/` → `/Users/yourname/iCloud Drive/aiea-brain/ssy300` (follows you across machines)
- `library/` → `/Users/yourname/Dropbox/teaching/ssy300/2026` (delivers to students)
- `workshop/` → `/Users/yourname/aiea/SSY300-workshop` (local-only, can be huge)

In the course detail page or Workspace, each of the four rows has 🖋️ (edit path inline) and 📂 (Browse). Edit each independently.

## The scaffold checkbox

When you edit a path inline (per-role), there's a checkbox under the field:

> ☑ also scaffold canonical subfolders inside this path

- **Checked** (default) — AIEA re-creates the canonical subfolders inside the new path (idempotent, won't overwrite anything).
- **Unchecked** — pure connect. AIEA just stores the path; nothing on disk is touched.

Uncheck this when you're pointing at an existing tree with its own subfolder names and you don't want AIEA to add `book/`, `lectures/`, etc. alongside.

## Per-role scaffold-on-demand

Each role panel on the Workspace page has a **🪄 Scaffold subfolders** button (top right). Click it any time to re-create that role's canonical subfolders inside whatever path it points to. Useful when:

- You connected without scaffolding and now want the structure.
- You accidentally deleted some subfolders.
- You moved files and want AIEA to re-stamp `.aiea/course.json`.

Always idempotent. Files inside are never touched.

## Default allowed roots

By default AIEA can only see these three subfolders of your home directory:

```
~/Downloads
~/aiea
~/Documents
```

This is set in `infra/docker-compose.yml` (volumes) AND `AIEA_ALLOWED_ROOTS` env (folder-picker sandbox). They must match.

### Adding another allowed root

Suppose you want AIEA to read `~/Dropbox/teaching`:

1. Edit `infra/docker-compose.yml`. Under both `api` and `worker` services' `volumes:`, add:
   ```yaml
   - ${AIEA_HOST_HOME:-/Users/yourname}/Dropbox:${AIEA_HOST_HOME:-/Users/yourname}/Dropbox
   ```
2. In the `environment:` block, extend the env:
   ```yaml
   - AIEA_ALLOWED_ROOTS=/Users/yourname/Downloads:/Users/yourname/aiea:/Users/yourname/Documents:/Users/yourname/Dropbox
   ```
3. Restart the affected services:
   ```bash
   docker compose -f infra/docker-compose.yml up -d api worker
   ```
4. Reload the dashboard. The folder picker now has a `Dropbox` chip at the top.

**Do NOT bind-mount `$HOME` whole.** It crashes Docker Desktop's file-watcher on macOS. See `docs/troubleshooting.md` entry #10.

## Recovering from "missing"

If a folder row on the dashboard shows red **missing**, the path is set but the folder doesn't exist on disk (you deleted it, moved it, unmounted a drive). Either:

- Edit the row to a valid path, or
- Click **Create now** to mkdir it where the row currently points, or
- Click 🪄 **Scaffold subfolders** on the role panel — it'll mkdir the root + canonical subfolders.

## What changes when I re-target a path?

- The DB column updates with the new path.
- AIEA *re-reads* the new location. Anything already in the DB (Material rows from the old path) stays — but the next scan will register files from the new location and the old rows will look stale.

If you're swapping the materials folder wholesale, consider deleting the old `Material` rows first (DELETE /materials/{id}) so the dashboard doesn't show ghost entries.

## What stays put when I re-target?

- All files on disk in the old location.
- All extracted-text Markdown in the old workshop's `extracted/`.
- All promoted Markdown in the old library.

AIEA never deletes files outside its workshop's `extracted/` subfolder, and even those it only writes — it never auto-deletes.
