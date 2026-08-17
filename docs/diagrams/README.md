# AIEA — Diagrams

All diagrams are written in [Mermaid](https://mermaid.js.org/) so they render natively on GitHub, in Obsidian, and in most Markdown previewers. To edit, just change the code block — no separate tool, no binary asset to lose.

**Before editing a diagram, read [AUTHORING.md](AUTHORING.md).** A few non-obvious rules around reserved keywords and special characters save a lot of debugging.

| Diagram | What it shows |
|---|---|
| [01 — System architecture](01-system-architecture.md) | Services, ports, bind mounts, how the api / worker / frontend / postgres / redis fit together |
| [02 — Four-folder model](02-four-folder-model.md) | The materials / brain / library / workshop split, who reads vs. writes each |
| [03 — Course lifecycle](03-course-lifecycle.md) | What happens from "create course" to "ingested material" to "promoted question" — sequence diagram |
| [04 — Ingestion flow](04-ingestion-flow.md) | What happens when you click Rescan materials → Ingest — request flow including ARQ + worker-only extractors |
| [05 — Promotion flow](05-promotion-flow.md) | Workshop → Library: how a draft question becomes a finalized question-bank entry |
