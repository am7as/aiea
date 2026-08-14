# 07 — Building exams

Once your Question Bank has classified, answered, and (optionally) evaluated
questions, the Exam Builder assembles them into a deliverable exam.

## Two modes

**Auto** — define a blueprint of slots (chapter / category × difficulty × points)
and AIEA picks the matching questions from the bank automatically. Best when
you want N variants with the same shape.

**Manual** — name the exam, then pick each question by hand with a position,
points, and category. Best when you already know exactly which questions
you want.

## Auto workflow

1. Exam Builder → **Auto**.
2. Title + total minutes + number of variants.
3. Define the slots (one row per "spot" in the exam). Each row specifies:
   - Category (filtered by chapter)
   - Difficulty (1–5 or any)
   - Points
4. **Build N variants** — for each variant AIEA assembles an `Exam` row
   filled from the bank, ensuring no question is reused inside a variant.

## Manual workflow

1. Exam Builder → **Manual**.
2. Title + total minutes → **Create exam** (step 1 of 2).
3. The picker appears. **+ slot** adds an empty row. Pick a question, set
   points and position. Repeat.
4. **Save** persists the question set.
5. **Render .tex** then **Compile .pdf** (or use the Exam Bank's buttons —
   they're the same actions).

## Render → Compile

These are two ARQ jobs:

- `render_exam` — builds `<workshop>/exams/<origin>/<exam_id>/exam.tex` using
  `app/export/latex.py` (`md_to_latex` + `build_exam_tex` with the
  `\documentclass{exam}` class). Copies each question's `figures/` folder into
  `<exam_dir>/figures/<question_id>/`. If the question has a Swedish
  translation cached, a `\small` grey-tinted SV block is rendered under the
  EN body.
- `compile_exam_pdf` — runs `tectonic exam.tex` inside the worker container.
  Produces `exam.pdf`.

In Exam Bank you see status updates as the polling completes (every 3 s,
up to 90 s). On success, the inline PDF preview appears in the expanded
section.

## Exam Bank

The Exam Bank lists all exams — reference (imported from
`materials/exams/`) and generated. Each exam expands inline:

- Question list with position, kind, difficulty, points
- Inline **PDF preview** when `pdf_path` is set
- **Render** / **Compile** buttons rerun the pipeline
- **Analyze** — runs the synchronous `exam-analysis` AI task to score
  coverage, difficulty curve, gaps and suggested swaps against the
  syllabus + materials
- **Delete** removes the exam (and its `ExamQuestion` rows; the source
  questions stay in the bank)

The **Analytics** view aggregates the bank:

- Reference vs Generated donut
- Questions per exam bar
- Difficulty profile per exam (stacked D1..D5)
- Category mix heatmap (exam × category)

## Storage layout

```
workshop/exams/<origin>/<exam_id>/
  exam.tex            ← from render
  exam.pdf            ← from compile
  figures/
    <question_id>/    ← copies of each question's figures
      fig1.png
      ...
```

`<origin>` is `reference` or `generated`.

## Importing reference exams

`POST /api/v1/exams/import-reference?course_id=…` (button in Exam Bank →
**Import reference exams**) scans materials/exams/ and creates an Exam row
per past exam, linking the harvested questions for that source file.
Idempotent — re-running after a re-harvest re-links the ExamQuestion rows
on existing reference exams.
