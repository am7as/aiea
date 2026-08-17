# Watch it work

Eighteen screen recordings, about twenty-three minutes in total. Each one is scripted against
a live AIEA instance, so everything on screen is the real application.

**Click any title to play it in your browser.** GitHub plays these files directly.

Watch them in order the first time. The series follows the order you actually use the tool:
get oriented, set up a course, read the files, connect a model, then do the work.

## Getting oriented

| # | Clip | Length | What it covers |
|---|---|---|---|
| 01 | [▶ Orientation — dashboard and sidebar](videos/01-orientation-dashboard-and-sidebar.mp4) | 0:58 | What the dashboard tells you, and how opening a course changes the sidebar |
| 02 | [▶ Where your files live](videos/02-where-your-files-live.mp4) | 0:59 | The four folders, who writes to each, and the Markdown behind every question |

## Setting up a course

| # | Clip | Length | What it covers |
|---|---|---|---|
| 03 | [▶ Creating a course](videos/03-creating-a-course.mp4) | 1:43 | Every field on the form, and the two ways to point at your folders |
| 04 | [▶ The course page](videos/04-the-course-page.mp4) | 1:06 | The counts, and what Rescan, Scan and ingest, Extract pending and Re-ingest each do |
| 05 | [▶ The Extraction panel](videos/05-the-extraction-panel.mp4) | 2:19 | Files, extraction, compare and evaluate, and the Final choice everything downstream reads |

## Connecting a model

Nothing generates until a provider is configured. Start with a local one; it is free and
needs no key.

| # | Clip | Length | What it covers |
|---|---|---|---|
| 06 | [▶ Connect a local model (Ollama)](videos/06-connect-a-local-model-ollama.mp4) | 1:11 | The whole form, a live Test connection, setting a default model |
| 07 | [▶ Connect LM Studio (vision)](videos/07-connect-lm-studio-vision.mp4) | 1:18 | The same shape, plus why some tasks need a model that can see |
| 08 | [▶ Connect a token API](videos/08-connect-a-token-api.mp4) | 1:10 | Base URLs, key handling, why Test calls every model |
| 09 | [▶ Connect an agentic CLI](videos/09-connect-an-agentic-cli.mp4) | 1:26 | The host shim, chat against agent mode, working directories, permission tiers |
| 10 | [▶ Allocate tasks to models](videos/10-allocate-tasks-to-models.mp4) | 1:39 | Routing each task to its own provider, model and parameters, then testing it |

## Building questions

| # | Clip | Length | What it covers |
|---|---|---|---|
| 11 | [▶ Course Map — propose and edit](videos/11-course-map-propose-and-edit.mp4) | 0:47 | AIEA proposes chapters and objectives; you edit every one of them |
| 12 | [▶ Generating questions](videos/12-generating-questions.mp4) | 1:35 | Every control on the plan, and why narrow requests produce better questions |
| 13 | [▶ The Question Bank](videos/13-the-question-bank.mp4) | 1:24 | Finding one question among hundreds, and what each filter does |
| 14 | [▶ Working on one question](videos/14-working-on-one-question.mp4) | 1:32 | Each section of the detail page, and the order to use the actions in |

## Building exams

| # | Clip | Length | What it covers |
|---|---|---|---|
| 15 | [▶ Build an exam automatically](videos/15-build-an-exam-automatically.mp4) | 0:52 | A blueprint, the quality filter, and marks taken from the questions themselves |
| 16 | [▶ The Exam Bank](videos/16-the-exam-bank.mp4) | 1:14 | Where finished papers live, the artifacts each row carries, and Analytics |

## Keeping an eye on it

| # | Clip | Length | What it covers |
|---|---|---|---|
| 17 | [▶ Watch jobs and token usage](videos/17-watch-jobs-and-token-usage.mp4) | 0:43 | The live job queue, and what every model call actually costs |
| 18 | [▶ The Chat console](videos/18-the-chat-console.mp4) | 1:06 | Talking to a model directly, and to the agent that drives AIEA |

Offline copies are attached to the [videos-v1 release](https://github.com/am7as/aiea/releases/tag/videos-v1).

## Which guide goes with which clip

| Clips | Written guide |
|---|---|
| 01–04 | [Getting started](guide/01-getting-started.md) · [Connecting your folders](guide/02-connecting-folders.md) |
| 05 | [Ingesting materials](guide/03-ingesting-materials.md) |
| 06–10 | [Setting up the AI engine](guide/06-ai-engine.md) |
| 11–14 | [Generate, refine, promote](guide/05-generate-refine-promote.md) |
| 15–16 | [Building exams](guide/07-building-exams.md) |
| 17–18 | [Working day-to-day](guide/04-daily-workflow.md) |

## Two notes on what you are watching

Clips 03, 04, 05, 14 and 16 are recorded against a small example course rather than a real
one, so no coursework filenames appear. Everything shown is live application state, not a
mock-up.

Clip 12 explains the generation controls but does not press Generate. A real run is a
background job that takes five to twenty minutes, which does not make a useful recording.
Clip 17 shows where that job appears while it runs.

## Not covered

The `Materials` item in the sidebar lists every registered file across all courses at once.
It is a read-only table with the same columns the course page shows, so it has no clip of its
own; clip 04 covers the same information scoped to one course.
