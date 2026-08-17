# AIEA — User Guide

Task-oriented walkthroughs for course examiners using AIEA. Start at [01](01-getting-started.md) if it's your first time.

**Prefer to watch?** [Ten short screen recordings](../videos.md) cover orientation, connecting a
model, task routing and building an exam — about eleven minutes in total.

| | Guide | When to read |
|---|---|---|
| 01 | [Getting started](01-getting-started.md) | First time. From `docker compose up` to a connected workspace. |
| 02 | [Connecting your folders](02-connecting-folders.md) | You have an existing course folder, or want to point at Dropbox/iCloud, or need to re-target paths. |
| 03 | [Ingesting materials](03-ingesting-materials.md) | You have files in your materials folder and want AIEA to index + extract them. |
| 04 | [Working day-to-day](04-daily-workflow.md) | The cadence: dashboard summary → workspace edits → materials drop → scan → ingest. |
| 05 | [Generate / classify / refine / promote](05-generate-refine-promote.md) | The actual exam-question loop. |
| 06 | [Setting up the AI engine](06-ai-engine.md) | Connect AI models — providers, the host shim, agent mode, task routing, chat, memory. |
| 07 | [Building exams](07-building-exams.md) | Manual + auto exam builder, render `.tex`, compile `.pdf`, analyse coverage. |

## End-to-end summary

1. **Bring up AIEA** (`pixi run up`) and connect your course folders (Workspace).
2. **Drop materials** under `materials/{book,lectures,exercises,exams,other}/`. Scan and Ingest from the Materials panel.
3. **Build the Course Map** from materials → AI proposes chapters + ELOs. Click **Discover categories** for per-chapter topic lists. Edit anything in the Edit view.
4. **Harvest** reference questions from `materials/exams/` (Question Bank → Harvest).
5. **Classify** unassigned questions so each lands under its real chapter + canonical category.
6. **Generate** new AI questions per chapter / category (Question Generation panel). Choose `with_diagrams` for schemdraw / matplotlib figures.
7. **Refine** each question: Answer → Evaluate → Feedback → Reference match → Translate (SV).
8. **Build an exam** (Exam Builder → Auto or Manual). Render the `.tex`, Compile the `.pdf`. Preview inline in Exam Bank.
9. **Analyze** the assembled exam against materials for coverage gaps.

## What's running

All of the following is shipped:

- Courses CRUD; four-folder model + bootstrap; folder picker + connect-existing
- Materials scan + extract (PDF / DOCX / PPTX / MD)
- Workshop-stored markdown outputs (`extracted.md`, page-aware)
- AI engine — providers, routing, memory, chat, agent mode, host shim
- Course Map — chapters, ELOs, categories per chapter, discover-categories, coverage charts, Bloom × chapter, difficulty profile
- Question bank — harvest, classify, generate, evaluate, feedback, reference-match, translate
- Exam builder — auto blueprint or manual picker; render to `.tex`; compile to `.pdf` (tectonic)
- Exam bank — inline PDF preview, analytics, per-exam Analyze
- AI Tasks panel (live queue + history)
- Monitor — token + provider usage

## Where else to look

- [Setup](../setup.md) — bring-up commands, ports, hot reload
- [Architecture](../architecture.md) — the four-folder model, module layout, the "worker-only deps" rule
- [AI engine](../ai-engine.md) — providers, host shim, agent mode, routing, memory (reference)
- [Diagrams](../diagrams/) — system architecture, folder model, request flow
- [Troubleshooting](../troubleshooting.md) — known bring-up bugs and their fixes
- [Ports](../ports.md) — host port-block convention (AIEA owns 4020–4039)
