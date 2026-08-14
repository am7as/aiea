# 001 — Worker vs API dependency boundary

**Status:** accepted (inherited from AASAP)
**Date:** 2026-05-13

## Context

AIEA's worker container handles heavy work — PDF / DOCX / PPTX extraction, AI generation, evaluation, export. The api container handles HTTP requests, DB CRUD, and WebSocket streaming.

These two roles need very different sets of Python libraries. Putting them all in one env makes the api image hundreds of MB heavier and pulls in libs (pdfplumber, etc.) that the api never needs.

In AASAP we hit this concretely: `app/api/sources.py` imported a scraper registry that eagerly imported every scraper, including ones using `feedparser` / `curl_cffi` / `playwright` — libs that only exist in the worker pixi env. uvicorn crashed at import. We took ~30 min to find it.

## Decision

1. **One `backend/pixi.toml` with two Pixi features:**
   - `default` env = api deps (FastAPI, SQLAlchemy, httpx, structlog, etc.)
   - `worker` env = api deps + heavy parsers + AI client deps

2. **`infra/api.Dockerfile`** runs `pixi install -e default`; **`infra/worker.Dockerfile`** runs `pixi install -e worker`.

3. **Worker-only modules** live under predictable paths:
   - `backend/app/extract/{pdf,docx,pptx,md}.py` — import parser libs at top-of-file is fine here
   - `backend/app/generate/`, `backend/app/evaluate/`, `backend/app/export/` — may import worker-only libs

4. **The api's import chain must never reach a worker-only module at module-load.** Enforce via:
   - **Lazy registry**: `app/extract/registry.py` uses `importlib.import_module()` so importing the registry module itself is free; the extractor class is only loaded when `get_extractor(kind)` is called.
   - **ARQ dispatch**: any api route that needs ingestion / generation / evaluation enqueues a job; the actual work runs in the worker.

## Consequences

- **Api startup is fast and reliable** even when worker-only libs aren't installable on a given platform.
- **Sync-API-call temptations are killed.** Routes that say "just run the PDF parse synchronously, it's fast" are forbidden — they would force the api env to grow.
- **Frontend UX** for long jobs becomes async-by-default: enqueue → poll / WebSocket for status. This is a feature, not a bug.

## Enforcement

- `.claude/skills/fastapi-patterns/SKILL.md` documents the rule with a concrete example.
- The runbook in `docs/troubleshooting.md` (entry 4) shows what the failure mode looks like.
- A CI lint (future work) should fail PRs that add `import pdfplumber` / `import python_docx` / `import python_pptx` to anything in `app/api/` or `app/main.py`'s import closure.

## See also

- `/Users/yourname/Files/projects/aasap/docs/decisions/001-worker-vs-api-deps.md` (if added later) — same rule, sibling project.
- Commit `db111e41` in AASAP — `fix(api): lazy scraper registry + dispatch runs through ARQ`.
