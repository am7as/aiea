# 01 — System architecture

How AIEA's parts fit together: what runs on your machine, what runs in Docker, and how they
reach each other.

```mermaid
flowchart TB
    you(["You<br/><small>browser</small>"]):::person

    subgraph host[" Your machine "]
      direction TB
      shim["host AI shim<br/><small>node script on port 4023</small>"]:::person
      clis["claude / gemini CLIs<br/><small>already logged in</small>"]:::person
      local["LM Studio 1234<br/>Ollama 11434<br/><small>optional</small>"]:::person
      files["your course folders<br/><small>listed in AIEA_ALLOWED_ROOTS</small>"]:::infra
    end

    subgraph docker[" Docker network "]
      direction TB
      caddy["caddy<br/><small>the way in</small>"]:::infra
      web["frontend<br/><small>Next.js</small>"]:::engine
      api["api<br/><small>FastAPI</small>"]:::engine
      worker["worker<br/><small>ARQ jobs, heavy parsers, LaTeX</small>"]:::engine
      pg[("postgres")]:::infra
      redis[("redis")]:::infra
    end

    you --> caddy --> web --> api
    api --> pg
    api -- "enqueues" --> redis --> worker
    worker --> pg
    worker -- "reads and writes" --> files
    api -- "browses" --> files

    api -. "AI calls" .-> shim
    worker -. "AI calls" .-> shim
    shim --> clis
    api -. "AI calls" .-> local
    worker -. "AI calls" .-> local

    classDef person fill:transparent,stroke:#C6664A,stroke-width:2px
    classDef engine fill:transparent,stroke:#8B7BB8,stroke-width:2px
    classDef infra fill:transparent,stroke:#6B7280,stroke-width:2px
```

Clay is you and your machine. Violet is AIEA. Slate is infrastructure. Dashed lines are AI
calls, which are the only traffic that can leave your computer.

## Ports

Every published port is bound to `127.0.0.1`, so nothing is reachable from your network.

| Port | Service | Use it? |
|---|---|---|
| **4022** | caddy | **Yes. This is the app.** |
| 4020 | frontend | Direct, for debugging |
| 4021 | api | Direct, for curl and the API docs |
| 4023 | host AI shim | Runs on your machine, not in Docker |
| 4025 / 4026 | postgres / redis | Debugging only |

## Why the shim exists

Subscription providers drive the `claude` and `gemini` CLIs that you have already logged
into. Those are programs on your machine, and a container cannot run them. The shim is a
small Node script that exposes them over HTTP so the containers can reach them.

Start it with `pixi run shim start`, or it starts with `pixi run up`. Without it,
subscription providers do not work at all. The Providers page shows whether it is running.

## Key invariants

- **The api container does not have the heavy parsers.** `pdfplumber`, `python-docx` and
  `python-pptx` live only in the worker's environment. Anything under `backend/app/extract/`
  is loaded through `importlib` from a registry, never imported at module load time by the
  api. See [decisions/001](../decisions/001-worker-vs-api-deps.md).
- **Bind mounts are narrow.** `AIEA_ALLOWED_ROOTS` lists which of your folders the
  containers can see, and the Compose mounts match it. Never mount your whole home
  directory. See [troubleshooting](../troubleshooting.md) entry 10.
- **Postgres and Redis persist to `./data/`** on your disk, not to a named Docker volume.
  `docker compose down -v` will not remove them; `rm -rf data/pg` will.
- **No auth.** Single user, localhost only. Do not expose AIEA on a public host without
  putting authentication in front of it.
