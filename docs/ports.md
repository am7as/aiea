# AIEA — Ports

## This project: `4020–4039`

| Host port | Service | Inside container |
|:-:|---|:-:|
| **4020** | Next.js frontend | 3000 |
| **4021** | FastAPI api (+ WebSocket) | 8000 |
| **4022** | Caddy reverse proxy (single entry) | 80 |
| **4023** | Host AI shim (subscription CLIs — runs on host) | — |
| 4024 | *(reserved for additional user-facing services)* | |
| **4025** | Postgres | 5432 |
| **4026** | Redis | 6379 |
| 4027–4029 | *(reserved for additional data services)* | |
| 4030–4034 | *(reserved for debug — VNC/dashboards if added later)* | |
| 4035–4039 | *(reserved)* | |

## Project port-block convention

Every project at this workstation uses a contiguous **20-port block** on the host. Within each block:

| Offset | Use |
|:-:|---|
| `+00..+04` | user-facing services (frontend, api, proxy, +2 spare) |
| `+05..+09` | data services (postgres, redis, +3 spare) |
| `+10..+14` | debug / observability (VNC, noVNC, dashboards) |
| `+15..+19` | reserved for future |

So **"data is always +5"**, **"VNC is always +10"** — you never have to look up which port hosts what once you know the project's base.

## Project allocation register

Keep this list in sync as you add new projects. The block sizes are 20 so two adjacent projects can never collide.

| Base | Project | Status |
|:-:|---|---|
| 4000 | AASAP (job application assistant) | active |
| 4020 | **AIEA** (this — course exam assistant) | active |
| 4040 | *(free)* | |
| 4060 | *(free)* | |
| 4080 | *(free)* | |
| 4100+ | *(free, allocate by step of 20)* | |

When starting a new project: pick the lowest free base that's a multiple of 20, write its `docs/ports.md` using this table format, and update the register entries in *every* existing project's `docs/ports.md` so the global view stays consistent.

## Why these specific numbers

Nothing magic — `4xxx` was empty for this workstation and stays clear of:
- 3000-range (Node defaults, Grafana, many tutorials)
- 5000 (Flask, Mac AirPlay)
- 8000-range (FastAPI/Django defaults — too crowded)
- 9000+ (often used by PHP-FPM, SonarQube, etc.)

Inside containers the services still bind their stock ports (Postgres 5432, etc.); only the **host-side mapping** changes. The Caddy reverse-proxy upstreams still target `api:8000` / `frontend:3000` over the Docker network — that's internal, not host-visible.

## Connecting LM Studio (host service)

LM Studio runs on the host, listens on **its own** port (default 1234) — that's not part of any project's block. The api/worker containers reach it via `host.docker.internal:1234`. No change.
