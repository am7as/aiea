# Extraction-quality test pipeline

A standalone experiment: does **figure-aware extraction** (Markdown + cropped figure
images + detailed figure descriptions) produce an extraction good enough that an AI with
**no access to the source** can design and solve a correct, well-calibrated exam question?

Test document: `reference/E8-digital2.pdf` — *SSY300 Applied Mechatronics, Exercise:
Digital Theory 2* (10 pages, flip-flops / timing diagrams / NAND realisation).

## Layout

```
reference/      E8-digital2.pdf + page-NN.png (200-DPI renders)  — ground truth
skills/         reusable skill files (extraction-faithfulness, question-figures,
                bloom, difficulty, question-generation)
prompts/        01..06 — one task brief per agent; the reusable deliverable
tools/          render_pages.py, crop.py (extraction side),
                render_figure.py (question side: timing/schemdraw/matplotlib),
                venv/ (PyMuPDF, matplotlib, schemdraw)
work/           all agent outputs
runs-archive/   prior full runs kept for comparison
```

## The 6 agents (run in dependency order)

| # | Agent | Prompt | Reads | Writes |
|---|-------|--------|-------|--------|
| 1 | Extraction | `prompts/01-extract.md` | page PNGs | `work/agent1-extraction/` |
| 2 | Extraction QA | `prompts/02-evaluate-extraction.md` | reference + agent 1 | `work/agent2-extraction-eval.md` |
| 3 | Question designer | `prompts/03-design-question.md` | agent 1 **only** | `work/agent3-question/` |
| 4 | Answer finder | `prompts/04-answer-question.md` | agent 3 question **only** | `work/agent4-answer.md` |
| 5 | Correctness judge | `prompts/05-evaluate-correctness.md` | agent 3 + agent 4 | `work/agent5-correctness-eval.md` |
| 6 | Difficulty assessor | `prompts/06-evaluate-difficulty.md` | agent 1 + 3 + 4 | `work/agent6-difficulty-eval.md` |

Order: **1 → (2 ‖ 3) → 4 → (5 ‖ 6)**.

Isolation matters: agents 3 and 4 must **not** see the reference (agent 4 not even the
extraction) — that is what makes the test honest. Each agent runs with a fresh context and
is given only its prompt file.

## Setup (already done)

```
python3 -m venv tools/venv && tools/venv/bin/pip install pymupdf
tools/venv/bin/python tools/render_pages.py 200    # -> reference/pages/page-NN.png
```

## Porting to the app

The `prompts/` and `skills/` files are written to be reused. In AIEA, agents 1/2 become
the `material-extraction` / `extraction-validation` workflows, 3 the question generator,
4-6 the answer/evaluation passes. The prompt files map onto `app/ai/router.py` tasks; the
skill files onto `backend/skills/`. `crop.py` is the new capability the extraction worker
needs — crop figures from the PDF rather than summarising them to prose.
