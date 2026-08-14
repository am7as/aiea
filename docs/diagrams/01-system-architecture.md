# 01 — System architecture

How AIEA's services fit together on the host (your Mac) and inside Docker.

```mermaid
flowchart TB
    user["You<br/>browser at localhost:4020"]:::user

    subgraph host["macOS host"]
      direction TB
      lmstudio["LM Studio<br/>localhost:1234<br/>optional"]:::external

      subgraph dockerNet["Docker network (project: aiea)"]
        direction TB

        frontend["Next.js 15<br/>3000 maps to host:4020"]:::frontend
        api["FastAPI uvicorn<br/>8000 maps to host:4021"]:::api
        fs["/fs router<br/>sandboxed to AIEA_ALLOWED_ROOTS"]:::api
        worker["ARQ worker plus heavy parsers<br/>pdfplumber python-docx python-pptx frontmatter"]:::worker
        caddy["Caddy proxy<br/>80 maps to host:4022"]:::infra
        pg["Postgres 16<br/>5432 maps to host:4025<br/>data at host ./data/pg"]:::db
        redis["Redis 7<br/>6379 maps to host:4026<br/>arq queue + cache"]:::db
      end

      hostMounts["Bind mounts<br/>~/Downloads ~/aiea ~/Documents<br/>narrow per AIEA_ALLOWED_ROOTS"]:::mount
    end

    user -- "HTTP :4020" --> frontend
    frontend -- "API_URL_INTERNAL http://api:8000" --> api
    user -. "alt :4022 via Caddy" .-> caddy
    caddy --> frontend
    caddy --> api

    api -- "asyncpg" --> pg
    api -- "enqueue" --> redis
    worker -- "dequeue" --> redis
    worker -- "asyncpg" --> pg

    api -. "reads files only" .-> hostMounts
    worker -. "reads + writes" .-> hostMounts

    worker -. "future Phase 3" .-> lmstudio

    classDef user fill:transparent,stroke:#3b82f6,color:#bfdbfe,stroke-width:2px
    classDef frontend fill:transparent,stroke:#3b82f6,color:#cbd5e1,stroke-width:2px
    classDef api fill:transparent,stroke:#3b82f6,color:#cbd5e1,stroke-width:2px
    classDef worker fill:transparent,stroke:#f59e0b,color:#fcd34d,stroke-width:2px
    classDef infra fill:transparent,stroke:#64748b,color:#cbd5e1,stroke-width:2px
    classDef db fill:transparent,stroke:#10b981,color:#d1fae5,stroke-width:2px
    classDef external fill:transparent,stroke:#a78bfa,color:#ddd6fe,stroke-width:2px
    classDef mount fill:transparent,stroke:#64748b,color:#94a3b8,stroke-width:2px,stroke-dasharray:4 2
```

## Key invariants

- **The api container does NOT have pdfplumber / python-docx / python-pptx.** Those live only in the worker's pixi env. Any module under `backend/app/extract/` must be loaded via `importlib.import_module()` from `app/extract/registry.py` — never imported at module load time from anywhere the api loads. See `docs/decisions/001-worker-vs-api-deps.md`.
- **Bind mounts are narrow.** `AIEA_ALLOWED_ROOTS` lists which host folders are reachable; the docker-compose volumes block mounts the same set. Never bind-mount `$HOME` whole on macOS — see `docs/troubleshooting.md` entry #10.
- **Postgres data lives on the host filesystem** (`./data/pg/`), not in a named Docker volume. `docker compose down -v` and even Docker Desktop's "Clean / Purge data" preserve it. Wipe with `rm -rf data/pg/` only when you really mean it.
- **No auth.** Single-user, localhost. CORS regex permits `localhost / 127.0.0.1 / host.docker.internal / LAN-IP` origins. Don't run AIEA on a public host without adding auth in front.
