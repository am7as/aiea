# 03 — Course lifecycle

From "I want to use AIEA for this course" to "I have a promoted question I trust".

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as Frontend
    participant API as FastAPI
    participant DB as Postgres
    participant FS as Disk
    participant W as ARQ worker

    Note over User,FS: 1. Create course

    User->>UI: open /courses/new (Quick or Custom)
    UI->>API: POST /courses/ with paths and metadata
    API->>DB: INSERT course (paths NULL or set)
    API->>FS: bootstrap_course_folders (4 mkdir + canonical subfolders + .aiea/course.json)
    API-->>UI: CourseRead
    UI-->>User: redirect to course detail

    Note over User,FS: 2. Configure folders (if not done at create)

    User->>UI: open /workspace, Set up or Connect from one parent
    UI->>API: GET /fs/preview-parent
    API->>FS: stat each canonical subpath
    API-->>UI: per-role exists and file_count
    UI-->>User: shows preview, user picks Connect or Create

    User->>UI: clicks Create and scaffold
    UI->>API: POST /courses/.../setup-from-parent (scaffold true)
    API->>DB: update 4 paths
    API->>FS: bootstrap_course_folders (idempotent)
    API-->>UI: CourseRead

    Note over User,FS: 3. Populate materials

    User->>FS: drag PDFs into materials/lectures via Finder

    User->>UI: open /workspace, clicks Rescan materials
    UI->>API: POST /materials/scan
    API->>FS: walk materials, filter Office locks and dotfiles
    API->>DB: INSERT Material rows (extraction_status pending)
    API-->>UI: ScanResult (per-collection breakdown)

    Note over User,FS: 4. Ingest one material

    User->>UI: clicks Ingest on a row
    UI->>API: POST /materials/.../ingest
    API->>DB: status pending and reset error
    API->>W: enqueue ingest_material
    API-->>UI: 202 Accepted

    W->>DB: SELECT material and parent course
    W->>DB: status running
    W->>FS: read materials/subpath
    W->>W: extract via app.extract.kind (lazy import, worker-only deps)
    W->>FS: write workshop/extracted/mid/extracted.md and meta.json
    W->>DB: status done, pages, word_count, extracted_text

    UI->>API: (poll or refresh) GET /materials/...
    UI-->>User: status pill flips to green done

    Note over User,FS: 5. Phase 3 onwards generate refine promote

    User->>UI: generate questions for these materials
    UI->>API: POST /questions/generate
    API->>W: enqueue generate
    W->>FS: write workshop/questions/qid current.md and chat.md and evaluation.md
    User->>UI: refine question in split-pane chat
    User->>UI: clicks Approve or Promote
    UI->>API: POST /questions/qid/promote
    API->>FS: copy current.md to library/question-bank/qid.md with promotion frontmatter
```

## What's shipped today vs. what's future

- ✅ Steps 1–4 are live (Phases 0 / 1 / 2 / 2.5 / 2.6).
- ⏳ Step 5 is Phase 3 onwards: AI gateway, generation, evaluation, review chain, promotion plumbing.
