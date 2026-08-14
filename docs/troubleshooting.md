# AIEA — Troubleshooting

Inherited verbatim from AASAP's bring-up. These bugs have been pre-fixed in AIEA's scaffold; the entries are here so when you hit a *new* version of the same bug class, you recognize it fast.

---

## 1. `pixi install` fails on `"package[extras]"` syntax

**Symptom**: `Not a valid package or extra name: "uvicorn[standard]"`.

**Cause**: Pixi's `pypi-dependencies` table rejects the string-with-brackets form.

**Fix**: Use the table form:
```toml
uvicorn = { version = ">=0.30", extras = ["standard"] }
```

Pre-fixed in `backend/pixi.toml`.

---

## 2. Pixi manifest not found at runtime — `pixi run` fails inside container

**Symptom**: Container exits because the bind mount overlays `/workspace` with the host's source dir (which has no `pixi.toml`).

**Cause**: We COPYed `pixi.toml` into the image at build time, but the bind mount hides it.

**Fix**: Put `pixi.toml` **inside the service dir** (`backend/pixi.toml`, `frontend/pixi.toml`) so the bind mount makes the host's same-content manifest visible to `pixi run` at runtime. NHTSA pattern.

Pre-fixed.

---

## 3. ARQ worker exits with "no functions registered"

**Symptom**: Worker container in restart loop.

**Cause**: ARQ refuses to start when `WorkerSettings.functions` is empty.

**Fix**: Register at least one (a `heartbeat()` no-op is fine):
```python
class WorkerSettings:
    functions = [heartbeat]
```

Pre-fixed in `backend/app/workers/main.py`.

---

## 4. api container won't start — `ModuleNotFoundError: No module named 'pdfplumber'`

**Symptom**: uvicorn import error at startup; api in restart loop; the missing module is a worker-only dep (`pdfplumber`, `python-docx`, `python-pptx`).

**Cause**: Some module in the api import chain (`app/api/materials.py`?) imports `app/extract/pdf.py` at top-of-file, which imports `pdfplumber`, which only exists in the worker pixi env.

**Fix**: Lazy registry pattern:
```python
# app/extract/registry.py
import importlib

_REGISTRY = {"pdf": ("app.extract.pdf", "PdfExtractor"), ...}

def get_extractor(kind):
    module_path, cls = _REGISTRY[kind]
    return getattr(importlib.import_module(module_path), cls)()
```

Then in api routes: enqueue an ARQ job; never call `get_extractor()` from a route.

See `.claude/skills/fastapi-patterns/SKILL.md` and `docs/decisions/001-worker-vs-api-deps.md`. Pre-fixed by leaving `app/extract/registry.py` as the only allowed entry point.

---

## 5. Alembic migration fails — `NameError: fastapi_users_db_sqlalchemy is not defined`

Inherited from AASAP. AIEA does NOT use fastapi-users, so this specific symptom shouldn't recur. The general rule remains:

**Cause class**: Alembic's autogenerate references types in column definitions but doesn't auto-import their modules.

**Fix**: Bake the imports into `backend/alembic/script.py.mako` so future autogens include them. Currently only `sqlalchemy as sa` is pre-imported. If you add custom column types (`pgvector.sqlalchemy.Vector`, etc.), add their imports to the template.

---

## 6. `relation "users" does not exist` (or any table doesn't exist) on first run

**Symptom**: API returns 500 on every endpoint that hits the DB. `\dt` shows only `alembic_version`.

**Cause**: `pixi run migrate` ran but had no migration files to apply. The first time, you must **generate** the migration first.

**Fix**: Two-step:
```bash
docker compose -f infra/docker-compose.yml exec api pixi run revision -m "initial"
docker compose -f infra/docker-compose.yml exec api pixi run migrate
```

Documented in `docs/setup.md`.

---

## 7. Form labels appear next to inputs instead of above

**Symptom**: Login / register / settings forms have labels horizontally adjacent to inputs.

**Cause**: `<label className="block">` with `<span>` + `<input>` children — the children are still inline.

**Fix**: Wrap each label+input in `<div className="flex flex-col gap-1">` with an explicit `<label htmlFor>`. Pattern in `.claude/skills/ui-dashboard/SKILL.md`.

---

## 8. `.gitignore` `models/` clobbers `backend/app/db/models/`

**Symptom**: `git add` doesn't pick up new files under `backend/app/db/models/`.

**Cause**: Unanchored `models/` matches every directory named `models` recursively.

**Fix**: Anchor with leading slash for repo-root-only entries:
```gitignore
/models/
!/models/.gitkeep
```

Pre-fixed.

---

## 9. pnpm content-addressable store leaks into git

**Symptom**: First commit grabs thousands of tiny files under `frontend/.pnpm-store/`.

**Cause**: pnpm creates the store in the bind-mounted host dir because the in-container home dir isn't usable.

**Fix**:
```gitignore
.pnpm-store/
**/.pnpm-store/
```

Optionally set `PNPM_STORE_PATH=/tmp/.pnpm-store` in `frontend/pixi.toml` task env so it never lands on the host.

Pre-fixed.

---

## 10. Docker Desktop crashes on boot with `service fs failed: injecting event blocked for 60s`

**Symptom**: After a compose change, Docker Desktop won't stay open — it shows the crash dialog above, and reopens into the same crash. Even after force-quit and reopen, it keeps crashing on boot.

**Cause**: A compose file bind-mounted the entire user home directory (e.g. `/Users/yourname:/Users/yourname`) into one or more containers. Docker Desktop's file-sharing service (osxfs/VirtioFS) tries to register file-system event watchers for every file under that mount on Docker boot, hits an internal deadlock against the ~tens of thousands of files in a typical macOS home (Library, Caches, node_modules across many projects), and the daemon crashes.

The crash happens during Docker boot, *before* containers start — so simply stopping the containers won't fix it. The mount config is baked into existing containers; `restart: unless-stopped` makes Docker try to remount on every boot.

**Fix**:
1. Force-quit every Docker process: `pkill -9 -f "Docker Desktop"; pkill -9 -f com.docker; pkill -9 -f docker`. Confirm in Activity Monitor.
2. Reopen Docker Desktop. If it boots, stop right there and edit the compose to use narrow subpath mounts (see below). If it still crashes, click **Quit** (NOT factory reset). Then Settings → Troubleshoot → **Clean / Purge data** (middle option — safe; host bind-mounts like `data/pg` survive, named volumes get wiped).
3. **Never** mount `$HOME` whole. Always mount specific subpaths:
   ```yaml
   - ${AIEA_HOST_HOME:-/Users/yourname}/Downloads:${AIEA_HOST_HOME:-/Users/yourname}/Downloads
   - ${AIEA_HOST_HOME:-/Users/yourname}/aiea:${AIEA_HOST_HOME:-/Users/yourname}/aiea
   - ${AIEA_HOST_HOME:-/Users/yourname}/Documents:${AIEA_HOST_HOME:-/Users/yourname}/Documents
   ```
4. Mirror the list in `AIEA_ALLOWED_ROOTS` env (colon-separated) so the `/api/v1/fs/list` folder picker sandbox matches what's actually mounted.

This is pre-fixed in `infra/docker-compose.yml` and `backend/app/api/fs.py`. If you ever need to expose additional host paths to AIEA, add them by name to *both* the volumes block and `AIEA_ALLOWED_ROOTS` — do not generalize to the home dir.

---

## 11.5. Mermaid diagram renders briefly then errors with "Cannot read properties of null (reading 'firstChild')"

**Symptom**: A Mermaid block in the docs viewer flashes a parsed diagram for a moment, then replaces it with the error above. Sometimes it just shows the error. Happens for some diagrams (typically the more complex ones) and not others.

**Cause**: React StrictMode in dev double-mounts every component (intentional, to surface side-effect bugs). When the Mermaid component used a *stable* id (e.g. `useId()`), both mounts called `mermaid.render(SAME_ID, ...)` concurrently. The second mount's cleanup destroyed the temp DOM element the first mount's render was still reading, causing Mermaid to deref `null.firstChild`.

**Fix**: Pre-fixed in `frontend/src/components/Mermaid.tsx`:
1. Generate a **random id per `useEffect` invocation** (not `useId()`) so each mount has its own DOM workspace.
2. Only remove the temp orphan in `finally` after `await mermaid.render()` completes — never before render, never in the unmount cleanup. Pre-cleanup or unmount-cleanup races the in-flight render.

If you wrap `<Mermaid>` in custom code, follow the same pattern: random id, finally-only cleanup.

---

## 11. In-app docs page shows "x error in text version 11.15.0" repeated everywhere, even on pages with no diagrams

**Symptom**: After viewing a docs page with a broken Mermaid diagram, *every* subsequent page in AIEA (Dashboard, Workspace, Materials, even Settings) shows multiple "x error in text version 11.15.0" SVG blocks in the page background.

**Cause**: Mermaid's `render(id, text)` appends a temporary DOM element with id `d<id>` to `document.body` during rendering. On a successful parse it removes that element afterward. On a *failed* parse (often during dev edits when a diagram has a syntax error) it can leave the error-SVG element behind. Those orphans accumulate in `document.body` and are visible across all client-side route changes because they aren't part of React's managed tree.

**Fix**: The Mermaid component now proactively cleans up `document.getElementById('d' + renderId)` before render, after error, and on unmount. Pre-fixed in `frontend/src/components/Mermaid.tsx`. If you see this again after a hard refresh, it means a new path failed to clean up — file a bug.

**Workaround if you hit it during development**: hard-reload (`Cmd+Shift+R`) the page. The orphans are tied to the page session.

---

## 12.5. Mermaid sequence-diagram parse error with note/message text containing a semicolon

**Symptom**: A `sequenceDiagram` block fails with a parse error in the middle of a Note or message line. The error context often shows text that spans two source lines, like the parser concatenated them.

**Cause**: Mermaid treats `;` as a statement separator (like in JavaScript). A line such as `Note over A,B: did X; then Y` is silently split at the semicolon into two statements. Statement 2 (`then Y`) is gibberish to the parser → error.

**Fix**: Use commas, em dashes, or periods instead of semicolons inside Mermaid message/note text. `Note over A,B: did X, then Y` parses fine. Pre-fixed in 03/04/05.

---

## 12. Mermaid sequence-diagram message body starting with `click` (or other reserved word) gives a parse error

**Symptom**: A `sequenceDiagram` block fails to render with `Parse error on line X: ...User->>UI: cli`. The error position is in the *middle of a word*, not at any visible syntax issue.

**Cause**: Mermaid v11's lexer is shared across diagram types. Words like `click`, `end`, `call`, `link`, `class`, `style` are flowchart-statement keywords. Even inside a sequenceDiagram message body (`User->>UI: click ...`), the lexer can interpret them as the start of a new statement.

**Fix**: Don't put those words as the FIRST WORD of a message body. Rename or paraphrase:
- ❌ `User->>UI: click Approve`
- ✅ `User->>UI: clicks Approve`
- ✅ `User->>UI: taps Approve`

See `docs/diagrams/AUTHORING.md` for the full list of authoring rules.

---

## 13. Mermaid diagram parses but colors are washed out / boxes unreadable

**Symptom**: classDef-assigned fills come out as light pastels instead of the dark colors specified.

**Cause**: Mermaid v11's built-in `dark` theme applies a lightness transform to user-specified `classDef fill:` values, brightening them for what it assumes is a light background.

**Fix**: Use `theme: "base"` (not `"dark"`) with explicit `themeVariables`. Pre-fixed in `frontend/src/components/Mermaid.tsx`. AIEA's style convention is **border-only** classDefs: `fill:transparent,stroke:<color>,color:<text-color>,stroke-width:2px`. See `docs/diagrams/AUTHORING.md` for the palette.

---

## Adding a new entry

When you hit a new bring-up bug, document it here with the same three-section shape: **Symptom**, **Cause**, **Fix**. Future-you (or your friends running the clean repo) will thank you.
