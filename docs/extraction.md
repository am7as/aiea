# Extraction subsystem

How AIEA turns course materials into clean text that the syllabus builder and
question generator consume. Built in Phase 4.

## The model — versioned extraction

A `Material` can be extracted **two ways**, and both are kept:

- **Python** — deterministic parsers (`pdfplumber`, `python-pptx`, `python-docx`,
  stdlib `html.parser`, frontmatter for `.md`/`.tex`). Fast, free, but blind to
  formulas, figures and slide visuals.
- **AI** — render each page to an image and a vision model transcribes it
  (text files go straight to the model as text). Slow, costs tokens, but reads
  figures/formulas.

Each is an `ExtractionVersion` row (`app/db/models/course.py`):
`material_id, method (python|ai), status, extraction_method, pages, word_count,
vault_path, error, job_id, eval_score, eval_notes, is_final`. Unique on
`(material_id, method)`. The `Material` columns (`extraction_status`,
`extracted_text`, …) mirror the **final** version.

### Disk layout — `<workshop>/extracted/`

```
extracted/
  py/<material_id>/extracted.md          Python extraction
  ai/<material_id>/extracted.md          AI extraction
  ai/<material_id>/pages/page-001.png …  rendered page images (AI step 1)
  comparison/<material_id>/comparison.md   py-vs-ai report
  comparison/<material_id>/evaluation.md   faithfulness-vs-source report
  final/<material_id>/extracted.md       the chosen final — downstream reads this
```

`final/` and `comparison/` are written **only** by a deliberate action — never
auto-promoted. `app/vault/writer.py` owns the paths (`version_dir`, `final_dir`,
`comparison_dir`); `app/vault/extraction.py` owns version bookkeeping
(`upsert_version`, `finalize_version`, `list_versions`).

## Operations

| Op | What | Job | Route |
|---|---|---|---|
| Extract (Python) | parsers → `py/` | `ingest_material` | — |
| Extract (AI) | render → vision/text → `ai/` | `ai_extract_material` | `material-extraction` |
| **Compare** | `py.md` ↔ `ai.md` → verdict | `compare_extraction` | `extraction-validation` |
| **Evaluate** | each version ↔ the **source** → faithfulness score | `evaluate_extraction` | `extraction-validation` |
| Set final | promote a version to `final/`, sync `Material` | (API) | — |

Compare and Evaluate are distinct: Compare pits the two extractions against
each other; Evaluate renders the *source* and scores how faithfully each
extraction captured it (fills `eval_score`/`eval_notes`).

## API — `app/api/materials.py`

- `GET /materials/extraction-summary?course_id=` — overview counts.
- `GET /materials/{id}/versions` — versions + reports + on-disk paths.
- `POST /materials/ingest-batch` / `extract-ai-batch` — extract selected;
  `?overwrite=` false skips already-done.
- `POST /materials/compare-batch` / `evaluate-batch` — `?overwrite=` too.
- `POST /materials/set-final-batch?method=python|ai`.
- `POST /materials/extract-stop` — ARQ-abort queued/running jobs for a selection.
- `POST /materials/verify-extractions` — reconcile DB status with disk
  (file exists → done; gone → error; stuck running → error).
- `POST /materials/check-extracted` / `prune-missing`.

The extract endpoints create the `ExtractionVersion` row (`status=pending`) and
store the ARQ `job_id` **at enqueue time** — so a still-queued job is visible
and stoppable.

## UI — the 4-column table

`/courses/[id]/extraction` → `ExtractionTable.tsx`. Columns: **1 Files**
(select) · **2 Extraction** · **3 Compare & Evaluate** · **4 Final**. Operation
buttons live in the column headers and act on the column-1 selection. Overview
bar on top. Expand a row → Python / AI text + both reports side by side, with a
`tree`-style "Files on disk" listing. `overwrite` checkbox per section.

## Extractor quality (Python)

Fixes applied (`app/extract/pdf.py`, `pptx.py`, `html.py`, `vault/scanner.py`):

- pdf word-joining → `extract_text(x_tolerance=1)`.
- `(cid:NNN)` and private-use-area glyph artifacts stripped.
- displaced spacing accents recombined (Swedish å/ä/ö: `Till¨ampad`→`Tillämpad`).
- pptx speaker notes attached as a quoted block, not a floating `## Notes`.
- html skips `nav/header/footer/aside` (LMS chrome).
- scanner skips `*_files/` browser-save folders; `exam-template/` is a real collection.

**Not Python-fixable** — math/formula structure, slide-deck figures: use AI
extraction.

## AI extraction notes

- `app/workflows/extract_ai.py`. Binary (pdf/pptx/docx) → render (`render.py`,
  LibreOffice for Office formats, per-invocation profile dir) → one vision call
  per page. Text files → chunked text calls.
- **Self-heals on context overflow**: if the provider returns a context-size
  error, the page image is downscaled and retried (`1.0→0.6→0.4→0.28`).
- Honours the route's `temperature` / `max_tokens` / `context_length`. With
  `context_length` set, text chunks are sized to fit and vision starts at a
  smaller scale.
- A weak model (e.g. `gemma-4-e4b`) just echoes input — route a real vision
  model at `material-extraction`.

## ⚠️ Vision routing rule (hard requirement)

`material-extraction` and `extraction-validation` **must** route to a
**vision-capable token / lmstudio / ollama provider** — never an agent provider.

`AgentProvider` has no image support: it only sends text to the shim `/agent`
and silently drops `ChatMessage.images`. A vision task on an agent provider →
the model sees no page → returns a refusal ("No page content was provided") for
extraction, or scores everything 0 for evaluation. The code now **rejects** an
agent provider for vision with a clear error (`AgentProvider.complete` raises on
images; the jobs pre-check). Also note: the provider must be a *vision* model —
e.g. Ollama `llama3.2:latest` is text-only and is just as blind.
