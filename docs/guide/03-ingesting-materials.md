# 03 — Ingesting materials

How AIEA turns the files you drop in `materials/` into searchable, page-aware Markdown that the AI can ground questions in.

## The two-step model

1. **Scan** — AIEA looks at `materials/{book,lectures,exercises,exams,other}` and registers each file it finds as a `Material` row in the database. Status starts at `pending`. **No text extraction yet.**
2. **Ingest** — AIEA reads one file, parses it via the appropriate extractor, writes `extracted.md` to `workshop/extracted/<material-id>/`, and updates the DB row with page count + word count + status `done`.

Why two steps: scanning is cheap (just listing files); ingestion is the heavy part (parsing a 50-page PDF). Splitting them lets you batch-register first and decide what to extract.

## Where files go

```
<materials>/
├── book/                  ← put your textbook PDF + errata here
├── lectures/              ← put lecture slides (PPTX preferred, PDF works) here
├── exercises/             ← exercise sheets, problem sets
├── exams/                 ← past exams (PDF + .tex source if you have it)
├── exam-template/         ← LaTeX .sty + instructions.tex (NOT ingested — only used at export)
└── other/                 ← formulas, dictionaries, hand-ins, anything else
```

The subfolder names matter: AIEA's scanner only walks these six. Files dropped in the materials root or in non-canonical subfolders are ignored.

## Supported file types

| Extension | Extractor | What you get |
|---|---|---|
| `.pdf` | pdfplumber | Page-aware text per page; one `## Page N` heading per page |
| `.docx` | python-docx | Headings detected (`# H1`, `## H2`, ...) from styles |
| `.pptx` | python-pptx | One "page" per slide; title heading + body bullets + speaker notes |
| `.md`, `.markdown` | python-frontmatter | Pass-through; YAML frontmatter preserved |
| `.tex` | (uses md extractor for now) | Raw LaTeX as Markdown — specialized .tex extractor is a later phase |

Anything else (xlsx, png, sty) is registered? No — the scanner only registers extensions in this list. Other files sit on disk untouched.

## What the scanner skips

Always:

- `~$*` — Office lock files
- `.DS_Store`, `Thumbs.db`, `desktop.ini`
- Any name starting with `.` (dotfiles)
- `*.tmp`, `*.swp`, `*.part`
- `README.md` (these are AIEA's hints, not material)
- Unknown extensions

The grade spreadsheets you might have in `exams/<date> grade/` are auto-skipped because `.xlsx` isn't in the supported list. Same for `.sty`, `.csv`.

## Doing it

### Step 1: drop files

Use Finder, `cp`, drag-drop — whatever. AIEA doesn't care, it just reads the filesystem.

### Step 2: rescan

Open **Workspace** in the sidebar. In the Materials panel, click **🟦 Rescan materials** (top right).

What happens:

- API endpoint `POST /materials/scan?course_id=<id>` walks `materials/*` recursively (it descends into subfolders within `lectures/`, etc. — useful when slides are organized into `lectures/v2026/`).
- For each unregistered ingestible file, INSERT a `Material` row with `extraction_status="pending"`.
- For files that match an existing row (by `course_id + subpath`), no-op.

UI updates: new rows appear with a gray `pending` pill.

### Step 3: ingest one file

Click **Ingest** next to a row.

What happens:

- API `POST /materials/{id}/ingest` enqueues `ingest_material(material_id)` to the worker.
- Worker:
  1. SELECTs Material + parent Course.
  2. Sets status to `running` (you'll see a blue pill).
  3. Reads the file from `<materials>/<subpath>`.
  4. Calls the appropriate extractor (lazy-imported via `app.extract.registry`).
  5. Writes `workshop/extracted/<material-id>/extracted.md` + `meta.json`.
  6. Updates DB: pages, word_count, extracted_text, status=done.

Took 0.13s for a 1-page PDF, 0.06s for a Markdown file, ~3s for a 40-MB PPTX (heavy parse). Status flips to green `done` automatically on UI refresh.

### Step 3 alt: batch ingest

In the Materials panel header, click **🟦 Scan + ingest all new** (this is `auto_ingest=true` on the scan endpoint). Registers everything, then enqueues an `ingest_material` job per new row.

The worker has `max_jobs=2`, so up to 2 files extract concurrently. Status pills tick through pending → running → done as each finishes.

## Inspecting the output

```bash
ls ~/aiea/SSY300/workshop/extracted/
# <material-id>/extracted.md  ← the parsed text
# <material-id>/meta.json      ← extraction metadata
```

The `extracted.md` is Obsidian-friendly:

```markdown
---
material_id: c10130f5-e3ab-4fd8-9711-f4e30042a799
course_id: 35902835-212f-45d8-b531-881c0fc52203
collection: book
subpath: book/book_errata_4th_ed.pdf
original_filename: book_errata_4th_ed.pdf
extraction_method: pdfplumber
pages: 1
word_count: 405
extracted_at: 2026-05-13T16:27:46+00:00
---

## Page 1

p.21: in Figure 2.12, the flux line and field direction is wrong for how the coil is shown in 3D.
...
```

Open it in Obsidian. The frontmatter is YAML, the body is GFM Markdown, the page markers are real headings that Obsidian renders in the outline.

## Re-ingesting after a file changes

If you edit a PDF in place (replace it with a new version), AIEA won't auto-detect the change. To re-extract:

1. Click **Re-ingest** on the row (it appears once status is `done`).
2. Or via API: `POST /materials/{id}/ingest`.

Either way the worker re-extracts and overwrites `extracted.md`.

## What about files in `exam-template/`?

The scanner intentionally skips `exam-template/`. Templates are read at **export time**, not extracted as study material. If you accidentally drop a study PDF in there, move it to `book/` or `other/` and click Rescan.

## What about non-supported files like XLSX?

They sit on disk untouched. AIEA never touches your XLSX grade sheets in `exams/<date> grade/`. If you want them included, you'd need to add an XLSX extractor (see [diagrams/04 — ingestion flow](../diagrams/04-ingestion-flow.md#what-youd-add-to-support-a-new-file-type) for the four-step recipe).

## Errors

If extraction fails, the row's status flips to red `error` and the `extraction_error` field on the Material has the exception. Common causes:

- The PDF is scanned (no text layer). AIEA returns `pages=N, word_count≈0` — that's not an error per se, but you'll know it needs OCR. OCR (`pytesseract` + `pdf2image`) is staged but not auto-triggered yet.
- The file moved/deleted between scan and ingest. Re-scan to remove the stale row.
- The original is locked open in Word/PowerPoint (`~$*` lockfile present). Close the app and re-ingest.

You can always read the worker logs:

```bash
docker compose -f infra/docker-compose.yml logs worker --tail 80
```
