# 05 — Promotion flow (workshop → library)

> **Status:** the data model and folder layout are in place. The promote *action* lands in Phase 6/7 (review chain + exam builder). This diagram documents the intended flow so the future implementation has a fixed target.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as Frontend
    participant API as FastAPI
    participant DB as Postgres
    participant WS as workshop
    participant LIB as library

    Note over User,LIB: Draft in the workshop

    UI->>API: POST /questions/generate
    API-->>WS: write questions/qid/current.md and chat.md and evaluation.md

    Note over User,LIB: User iterates

    loop while not approved
      User->>UI: refine via chat (make harder, add distractor)
      UI->>API: POST /questions/qid/iterate
      API-->>WS: snapshot iter-NNN.md and update current.md
    end

    Note over User,LIB: User approves

    User->>UI: clicks Approve or Promote
    UI->>API: POST /questions/qid/promote

    API->>WS: read workshop/questions/qid/current.md
    API->>API: render frontmatter (promoted_from, promoted_at, source_iteration)
    API->>LIB: write library/question-bank/qid.md (overwrites if re-promoted)
    API->>DB: update Question status ready
    API-->>UI: PromotedQuestion

    Note over User,LIB: Demote just deletes the library file — workshop history kept

    Note over User,LIB: Exam finalization is symmetric

    User->>UI: select promoted questions, set order and points
    UI->>API: POST /exams/eid/finalize
    API->>LIB: read materials/exam-template (.sty and instructions.tex)
    API->>LIB: render exam.tex via Jinja
    API->>LIB: compile to exam.pdf (weasyprint or pdflatex)
    API->>LIB: write library/exams/eid (exam.md and exam.tex and exam.pdf and answer-key.md)
    API-->>UI: FinalizedExam
```

## Why promotion is an explicit user action

Without an explicit gate, the library would fill with every AI-generated artifact and lose its meaning. The library only earns its keep if:

- **Promotion is frictionless** — one button, one keystroke. Otherwise users won't curate.
- **Promotion is reversible** — demote just deletes the library file; workshop history (iterations + chat) is preserved indefinitely.
- **Promotion is gated by hooks** — `<brain>/hooks/before-promote.md` can enforce quality rules ("every question must have est_minutes set"); `after-promote.md` can log/notify.

## Frontmatter convention

Every promoted file carries:

```yaml
---
promoted_from: workshop/questions/<qid>/current.md
promoted_at: 2026-05-14T11:42:00+00:00
source_iteration: 5
course_id: <uuid>
course_code: SSY300
question_id: <uuid>
---
```

So the library is self-describing — open `library/question-bank/<qid>.md` in Obsidian and you immediately know what produced it.
