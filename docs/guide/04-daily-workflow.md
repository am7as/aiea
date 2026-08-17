# 04 — Working day-to-day

The rhythm you'll fall into after the initial setup.

## The five places you'll spend time

| Where | What you do there |
|---|---|
| **Dashboard** | Glance at folder health + counts. Almost never edit. |
| **Workspace** | When folder state needs attention. Re-target paths, scaffold, scan, ingest. |
| **Materials** | Cross-course view of all registered materials. |
| **AI engine** | Configure providers, routing, skills and memory. |
| **Questions** | Harvest, classify, generate and refine. |

## Today's rhythm

A typical day:

**Morning:**

1. Open `http://localhost:4020`. Land on Dashboard.
2. Read the **Folder health card** — all four roles should be ok-green. If something's amber, click **Manage →** to deal with it.
3. Read the **Next-steps checklist**:
   - ☐ Connect the four folders → done after first setup
   - ☐ Drop materials in & ingest → click through to the course detail
   - ☐ Generate questions → soon
   - ☐ Assemble an exam → soon

**During work:**

- **You added new course material** (e.g. lecture 12 PPTX): drop it in Finder under `materials/lectures/`, switch to AIEA, Workspace → Rescan materials → Ingest the new row.
- **You want to see what AIEA extracted**: open `workshop/extracted/<material-id>/extracted.md` in Obsidian.
- **You moved a folder** (renamed materials/, moved workshop to a new disk): Workspace → edit the row → save. If the new folder already has the canonical layout, leave the scaffold checkbox off. Refresh and the file counts update.
- **You want a fresh start**: delete the existing course (Courses → course → Delete). The DB row is gone; the folders on disk are NOT touched. Create a new course pointing at the same or different folders.

**Coming back after a break:**

- Open the Dashboard. The active course is whichever was last visited (via `?course=<id>` in URL) or the most recently created. Switch with the title dropdown.

## Refresh vs. Rescan, one more time

You'll use these constantly. The mental model:

| Action | When | Cost | DB write? |
|---|---|---|---|
| 🔄 **Refresh** | "Show me what's on disk right now." | cheap (~50–100 ms) | no |
| 🟦 **Rescan materials** | "I dropped new files; register them." | cheap (~100 ms even with hundreds of files) | yes, INSERTs |
| Per-row **Ingest** | "Extract text from this file." | medium (50ms-3s depending on file) | yes, updates Material |
| **Scan + ingest all new** | "Register and extract everything new." | varies by batch | yes |

## Where the buttons live

```
Dashboard:        no action buttons — view only
Workspace:        Refresh + Rescan materials + Scaffold subfolders (per role)
                  Set up / connect from one parent (top)
                  Per-row 🖋️ edit + 📂 Browse
Course detail:    Same Materials Scan panel (deeper) + Delete course
```

## Editing folder paths safely

When you edit a folder path (Workspace, per-row inline edit):

1. The new path is saved to the DB.
2. By default, AIEA bootstraps canonical subfolders inside the new path (idempotent — adds missing, never overwrites).
3. The Materials/Brain/Library/Workshop content panels re-read the new location.

If you don't want step 2 (you're pointing at an existing tree with its own structure), **uncheck the "also scaffold" checkbox** before saving.

## The Markdown habit

AIEA's outputs are all Markdown by design — open them in Obsidian, VS Code, or `bat extracted.md` in terminal. Get in the habit of:

- Reading `workshop/extracted/<material-id>/extracted.md` after each ingest, especially the first time you use a new file type. You'll catch parser quirks early.
- Reading `workshop/questions/<qid>/current.md` to verify AI output once Phase 4 ships.
- Keeping `brain/memory/course-notes.md` open in Obsidian as you teach the course — both you and AIEA append to it.

## Backup priorities

In recovery order, most important first:

1. **brain/** (`skills/`, `agents/`, `hooks/`, `memory/`) — the smallest folder, the most distilled value. Put it under Git or iCloud Drive.
2. **library/** — your shippable finals. Dropbox / shared drive.
3. **materials/** — usually already backed up elsewhere (university OneDrive, Dropbox). Medium priority.
4. **workshop/** — regenerable from materials + brain. Skip unless you care about chat history.

## When something feels off

- Dashboard amber? → Workspace.
- Workspace looks empty when it shouldn't? → 🔄 Refresh.
- Files on disk but not in the dashboard? → 🟦 Rescan materials.
- Material stuck on "pending" → click **Ingest** (and read worker logs if it errors).
- Material on "error" → expand the row, read the `extraction_error` field.
- Docker Desktop crashing → `docs/troubleshooting.md` entry #10.
- Anything else → `docs/troubleshooting.md` 1–9.

## Speed records

For the SSY300 test course (60 registered materials across 4 collections):

| Action | Time |
|---|---|
| Scan (60 files) | ~250 ms |
| Ingest single 1-page PDF | ~130 ms |
| Ingest single 8-page PDF | ~150 ms |
| Ingest 40 MB PPTX | ~3 s |
| Dashboard cold load | ~400 ms |

Your numbers will vary by file complexity, but the order of magnitude is the right baseline.
