# Watch it work

Ten short screen recordings, about eleven minutes in total. Each one is scripted against a
live AIEA instance, so everything on screen is the real application.

**Click any title to play it in your browser** — GitHub plays these files directly, no
download needed. Work through them in order the first time: clips 3 to 7 build on each
other, and nothing else in AIEA runs until a model is connected.

## Start here

| # | Clip | Length | What you learn |
|---|---|---|---|
| 01 | [▶ Orientation — dashboard and sidebar](https://github.com/am7as/aiea/blob/main/docs/videos/01-orientation-dashboard-and-sidebar.mp4) | 0:58 | What the dashboard tells you, and how opening a course changes the sidebar |
| 02 | [▶ Where your files live](https://github.com/am7as/aiea/blob/main/docs/videos/02-where-your-files-live.mp4) | 1:00 | The four folders, who writes to each, and the plain Markdown behind every question |

## Connect a model

Nothing in AIEA runs without at least one provider. Start with a local one — it costs
nothing and needs no key.

| # | Clip | Length | What you learn |
|---|---|---|---|
| 03 | [▶ Connect a local model (Ollama)](https://github.com/am7as/aiea/blob/main/docs/videos/03-connect-a-local-model-ollama.mp4) | 1:11 | The whole form, a live **Test connection**, and setting a default model |
| 04 | [▶ Connect LM Studio (vision)](https://github.com/am7as/aiea/blob/main/docs/videos/04-connect-lm-studio-vision.mp4) | 1:19 | The same shape, plus why some tasks need a model that can *see* |
| 05 | [▶ Connect a token API](https://github.com/am7as/aiea/blob/main/docs/videos/05-connect-a-token-api.mp4) | 1:09 | Base URLs, key handling, and why Test makes a live call to every model |
| 06 | [▶ Connect an agentic CLI](https://github.com/am7as/aiea/blob/main/docs/videos/06-connect-an-agentic-cli.mp4) | 1:26 | The host shim, chat vs agent mode, working directories, permission tiers |
| 07 | [▶ Allocate tasks to models](https://github.com/am7as/aiea/blob/main/docs/videos/07-allocate-tasks-to-models.mp4) | 1:40 | Routing each task to its own provider, model and parameters, then testing the route |

## Do the work

| # | Clip | Length | What you learn |
|---|---|---|---|
| 08 | [▶ Course Map — propose and edit](https://github.com/am7as/aiea/blob/main/docs/videos/08-course-map-propose-and-edit.mp4) | 0:48 | AIEA proposes chapters and objectives; you edit every one of them |
| 09 | [▶ Build an exam automatically](https://github.com/am7as/aiea/blob/main/docs/videos/09-build-an-exam-automatically.mp4) | 0:53 | A blueprint, the quality filter, and marks taken from the questions themselves |
| 10 | [▶ Watch jobs and token usage](https://github.com/am7as/aiea/blob/main/docs/videos/10-watch-jobs-and-token-usage.mp4) | 0:43 | The live job queue, and what every model call actually costs |

Prefer them offline? [Download all ten as a bundle](https://github.com/am7as/aiea/releases/tag/videos-v1).

## Which guide goes with which clip

| Clip | Written guide |
|---|---|
| 01, 02 | [Getting started](guide/01-getting-started.md) · [Connecting your folders](guide/02-connecting-folders.md) |
| 03–07 | [Setting up the AI engine](guide/06-ai-engine.md) |
| 08 | [Generate, refine, promote](guide/05-generate-refine-promote.md) |
| 09 | [Building exams](guide/07-building-exams.md) |
| 10 | [Working day-to-day](guide/04-daily-workflow.md) |

## Not covered yet

These clips stop short of the middle of the pipeline. There is nothing here on ingesting
materials, AI extraction, harvesting questions out of past exams, generating new ones, or the
per-question refine loop. Those steps run background jobs that take five to twenty minutes
each, which does not record well in real time. Follow the written guides for now —
[03](guide/03-ingesting-materials.md) and [05](guide/05-generate-refine-promote.md) cover them.
