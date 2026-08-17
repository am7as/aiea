# 000 — Initial architecture (AIEA)

**Status:** accepted
**Date:** 2026-05-13

## Decisions

| Concern | Choice | Why |
|---|---|---|
| Backend | Python 3.12 + FastAPI (async) | Same as sibling AASAP; great for AI pipelines. |
| Frontend | Next.js 15 + React 19 + Tailwind v4 + shadcn primitives | Match AASAP aesthetic; rapid dark dashboards. |
| Datastore | Postgres 16 | Same as AASAP; consistent operational story. |
| Cache / queue | Redis 7 + ARQ + APScheduler | Async-native, durable enough for a personal tool. |
| Auth | **None** | AIEA is single-user local. Removing the auth surface area is a feature. |
| Containers | Docker Compose with Pixi inside | Inherits AASAP's NHTSA pattern (pixi.toml inside service dir). |
| AI premium | Claude / Gemini CLI as subprocesses | Same as AASAP — uses user's subscriptions. |
| AI local | LM Studio / llama.cpp / MLX over OpenAI HTTP | Same as AASAP. |
| File ingestion | pdfplumber, python-docx, python-pptx | Cover the three main course-material formats. OCR fallback via pytesseract for scans. |
| Exam export | weasyprint (PDF), Jinja2 LaTeX template, Markdown passthrough | Standard academic formats. |
| Repo structure | Two repos: private `aiea/` + clean `../aiea-clean/` via rsync | Same as AASAP. |

## Rejected alternatives

- **Adding auth (FastAPI-Users)**: explicit non-goal. Single-user local. If multi-user becomes needed later, fork AASAP — don't bolt onto AIEA.
- **SQLite instead of Postgres**: would simplify single-user deploy but breaks consistency with the family. Also Postgres handles concurrent api+worker writes more cleanly.
- **Streamlit / Gradio for UI**: same reason as AASAP — can't match the aesthetic we want.
- **Hatchet for workflows**: overkill; AIEA's pipeline (ingest → generate → evaluate) is shallower than AASAP's 21-stage one. APScheduler + ARQ is sufficient.
- **Embeddings + vector search for material retrieval**: deferred. Page-aware citation by page number works for v1. Add `pgvector` only if generator quality demands it.

## Things we'll revisit

- **OCR quality**: if a meaningful share of course books are scans, `pytesseract` quality may not be enough. Could swap to `marker-pdf` or Mistral OCR API.
- **LaTeX export**: Jinja2 template gets us 80%. If users want MathJax-quality rendering for math-heavy fields, may need pandoc-based export.
- **Multi-language**: scaffold assumes English. i18n of the AI prompts is a separate stream.
