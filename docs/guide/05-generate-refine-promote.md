# 05 — Generate, classify, refine, promote

The core exam-question loop. Assumes you've already built a course map
(guide 03) and have at least one provider configured (guide 06).

## Pipeline overview

```
materials/      → extract  → workshop/extracted/<material>/extracted.md
syllabus.md     → chapters + ELOs (Course Map → Build / Edit)
                → categories per chapter (Course Map → Discover categories)
materials/exams → harvest  → workshop/questions/harvested/<chapter>/<category>/<id>/
materials/book  → generate → workshop/questions/generated/<chapter>/<category>/<id>/

For each question:
  Answer (generate the worked solution)
  Evaluate (independent solve + correctness/clarity/difficulty/Bloom + scope alignment)
  Feedback (one-paragraph critique)
  Reference match (compare AI question vs harvested siblings on same topic)
  Translate (Swedish — only used at exam render time)
```

## 1 — Harvest reference questions

Question Bank → **Harvest** opens a dialog listing all extracted materials
in `materials/exams/` and `materials/exercises/`. Pick the ones to harvest;
each becomes a Question row with `origin=harvested`, the prompt copied
verbatim from the past exam, and a folder under
`workshop/questions/harvested/...`.

## 2 — Classify unassigned questions

After harvest, most questions have `chapter_id = null`. The amber banner at
the top of the Question Bank counts them. Click **Classify all unassigned** —
the worker runs `classify_question_job` per question, feeding the canonical
category list from the syllabus and asking the model to pick the best fit.

The Classify task also fills missing `bloom`, `difficulty` and refines the
free-text `category` into one of the chapter's canonical labels when it can.

When chapter_id / category changes, the question's vault folder is **moved**
(figures preserved) into the new path.

## 3 — Generate new questions

Question Generation panel:

1. Pick a chapter from the dropdown (top of each row).
2. Type or pick a category from that chapter's canonical list (datalist
   suggestions appear when present).
3. Set count, difficulty (1–5 or mixed), `with_diagrams` (text only or with
   schemdraw / matplotlib figures).
4. Repeat for as many rows as you want.
5. Click **Generate all**. Each row enqueues a `generate_questions` job.

Watch progress in **AI → Tasks**. When done, the new questions appear in the
Question Bank under their chapter / category.

## 4 — Refine each question

From a question's detail page or from bulk-actions on the bank:

- **Answer** — runs the answer-finder. Fills `answer_md` + `worked_solution_md`.
- **Evaluate** — independent solve + correctness/clarity scores, difficulty,
  Bloom, and **scope alignment** against the syllabus.
- **Feedback** — short critique with one concrete improvement.
- **Reference match** — for AI-generated only. Picks the closest harvested
  question on the same topic and scores the deviation (0 = drop-in for a real
  exam, 10 = out of scope).
- **Translate** — produces a Swedish copy, cached on the question. Used only
  when exporting bilingual exams; the PDF puts EN above SV under each
  question.
- **Edit** — modify any field by hand. The vault file is rewritten.

Status pills on each row show which passes have run (A · E · F · R).

## 5 — Promote

There is no explicit promote step. A question with `status="ready"`
(evaluator sets this when `needs_human_review=false`) is ready to land in an
exam. Use the Exam Builder (guide 07) to assemble.
