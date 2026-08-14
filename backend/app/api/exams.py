from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import get_db
from app.db.models import Course, Exam, ExamQuestion, Material, Question, ValidationFinding
from app.generate.exam_analyze import analyze_exam
from app.queue import enqueue
from app.validate.rules import intrinsic_marks
from app.validate.store import open_blocking, refresh_status
from app.schemas.exam import (
    ExamBuildAuto,
    ExamCreate,
    ExamDetail,
    ExamListItem,
    ExamQuestionItem,
    ExamQuestionsUpdate,
)

router = APIRouter(prefix="/exams", tags=["exams"])


@router.post("/reconcile")
async def reconcile_exams(
    course_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    """Drop DB Exam rows whose tex/pdf files are missing AND whose target dir
    is gone. Reference exams (no tex/pdf) are kept — they're DB-only entries
    that link to harvested questions. Used by the Exam Bank's Resync button."""
    from app.workflows.exam import exam_dir

    course = await db.get(Course, course_id)
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found")
    if not course.workshop_path:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "course workshop_path is not configured")
    workshop = Path(course.workshop_path)
    rows = list(
        (
            await db.execute(select(Exam).where(Exam.course_id == course_id))
        ).scalars().all()
    )
    removed: list[str] = []
    nulled: list[str] = []
    for e in rows:
        edir = exam_dir(workshop, e)
        had_artifacts = bool(e.tex_path or e.pdf_path)
        tex_ok = bool(e.tex_path) and Path(e.tex_path).is_file()
        pdf_ok = bool(e.pdf_path) and Path(e.pdf_path).is_file()
        dir_ok = edir.is_dir()
        # Reference exams carry no on-disk artifacts; keep them (they're DB-only).
        if e.origin == "reference" and not had_artifacts:
            continue
        # Full delete only when EVERYTHING is gone (tex, pdf, and the whole dir).
        if had_artifacts and not tex_ok and not pdf_ok and not dir_ok:
            removed.append(str(e.id))
            await db.delete(e)
            continue
        # Partial: file paths are stale (user deleted .tex or .pdf). Null the
        # missing paths so the UI shows them as needing rebuild.
        changed = False
        if e.tex_path and not tex_ok:
            e.tex_path = None
            changed = True
        if e.pdf_path and not pdf_ok:
            # For reference exams we DON'T null pdf_path if it points at a
            # source file outside the workshop (materials/<exam>.pdf) — that
            # file is the user's source of truth and the link is meant to stay.
            in_workshop = str(e.pdf_path or "").startswith(str(workshop))
            if in_workshop:
                e.pdf_path = None
                changed = True
        if changed:
            # Roll status back to "draft" so the UI prompts a rebuild.
            if e.tex_path is None and e.pdf_path is None and e.origin != "reference":
                e.status = "draft"
            nulled.append(str(e.id))
    await db.commit()
    return {
        "course_id": str(course_id),
        "removed": len(removed),
        "removed_ids": removed,
        "nulled": len(nulled),
        "nulled_ids": nulled,
        "kept": len(rows) - len(removed),
    }


@router.get("/", response_model=list[ExamListItem])
async def list_exams(
    course_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[ExamListItem]:
    stmt = select(Exam).order_by(Exam.created_at.desc())
    if course_id is not None:
        stmt = stmt.where(Exam.course_id == course_id)
    exams = list((await db.execute(stmt)).scalars().all())
    counts = dict(
        (
            await db.execute(
                select(ExamQuestion.exam_id, func.count(ExamQuestion.id))
                .where(ExamQuestion.exam_id.in_([e.id for e in exams]))
                .group_by(ExamQuestion.exam_id)
            )
        ).all()
        if exams
        else []
    )
    blocking = dict(
        (
            await db.execute(
                select(ValidationFinding.exam_id, func.count(ValidationFinding.id))
                .where(
                    ValidationFinding.exam_id.in_([e.id for e in exams]),
                    ValidationFinding.severity == "blocking",
                    ValidationFinding.status == "open",
                )
                .group_by(ValidationFinding.exam_id)
            )
        ).all()
        if exams
        else []
    )
    return [
        ExamListItem(
            id=e.id,
            course_id=e.course_id,
            title=e.title,
            origin=e.origin,
            status=e.status,
            total_minutes=e.total_minutes,
            question_count=int(counts.get(e.id, 0)),
            tex_path=e.tex_path,
            pdf_path=e.pdf_path,
            solution_pdf_path=e.solution_pdf_path,
            source_pdf_path=e.source_pdf_path,
            reproduction_score=e.reproduction_score,
            reproduction_notes=e.reproduction_notes,
            validation_status=e.validation_status,
            open_blocking=int(blocking.get(e.id, 0)),
            created_at=e.created_at,
        )
        for e in exams
    ]


@router.post("/", response_model=ExamDetail, status_code=status.HTTP_201_CREATED)
async def create_exam(
    payload: ExamCreate, db: AsyncSession = Depends(get_db)
) -> ExamDetail:
    course = await db.get(Course, payload.course_id)
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found")
    exam = Exam(
        course_id=payload.course_id,
        title=payload.title,
        total_minutes=payload.total_minutes,
        origin="generated",
        status="draft",
    )
    db.add(exam)
    await db.commit()
    await db.refresh(exam)
    return await _exam_detail(exam, db)


async def _exam_detail(exam: Exam, db: AsyncSession) -> ExamDetail:
    rows = list(
        (
            await db.execute(
                select(ExamQuestion)
                .where(ExamQuestion.exam_id == exam.id)
                .order_by(ExamQuestion.position)
            )
        )
        .scalars()
        .all()
    )
    questions = (
        {
            q.id: q
            for q in (
                await db.execute(
                    select(Question).where(
                        Question.id.in_([r.question_id for r in rows])
                    )
                )
            )
            .scalars()
            .all()
        }
        if rows
        else {}
    )
    items: list[ExamQuestionItem] = []
    for r in rows:
        q = questions.get(r.question_id)
        preview = None
        if q is not None and q.prompt_md:
            preview = q.prompt_md.strip()[:200]
        items.append(
            ExamQuestionItem(
                question_id=r.question_id,
                position=r.position,
                points=r.points,
                category=r.category,
                kind=q.kind if q else None,
                difficulty=q.difficulty if q else None,
                prompt_preview=preview,
            )
        )
    return ExamDetail(
        id=exam.id,
        course_id=exam.course_id,
        title=exam.title,
        instructions_md=exam.instructions_md or "",
        total_minutes=exam.total_minutes,
        origin=exam.origin,
        status=exam.status,
        tex_path=exam.tex_path,
        pdf_path=exam.pdf_path,
        solution_pdf_path=exam.solution_pdf_path,
        source_pdf_path=exam.source_pdf_path,
        reproduction_score=exam.reproduction_score,
        reproduction_notes=exam.reproduction_notes,
        created_at=exam.created_at,
        questions=items,
    )


@router.get("/{exam_id}", response_model=ExamDetail)
async def get_exam(
    exam_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> ExamDetail:
    exam = await db.get(Exam, exam_id)
    if exam is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exam not found")
    return await _exam_detail(exam, db)


@router.put("/{exam_id}/questions", response_model=ExamDetail)
async def replace_exam_questions(
    exam_id: uuid.UUID,
    payload: ExamQuestionsUpdate,
    db: AsyncSession = Depends(get_db),
) -> ExamDetail:
    """Replace the full ExamQuestion set of an exam."""
    exam = await db.get(Exam, exam_id)
    if exam is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exam not found")
    await db.execute(delete(ExamQuestion).where(ExamQuestion.exam_id == exam_id))
    seen: set[uuid.UUID] = set()
    for item in payload.questions:
        if item.question_id in seen:
            continue
        seen.add(item.question_id)
        db.add(
            ExamQuestion(
                exam_id=exam_id,
                question_id=item.question_id,
                position=item.position,
                points=item.points,
                category=item.category,
            )
        )
    await db.commit()
    await db.refresh(exam)
    return await _exam_detail(exam, db)


@router.post("/build-auto", status_code=status.HTTP_201_CREATED)
async def build_auto(
    payload: ExamBuildAuto, db: AsyncSession = Depends(get_db)
) -> dict[str, list[str]]:
    """Assemble `variants` exams by filling each blueprint slot from the pool."""
    course = await db.get(Course, payload.course_id)
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found")
    # Quality filter. Previously this took the first row matching category and
    # difficulty, with no regard for whether the question had an answer key, had been
    # evaluated, or was flagged for review — so a paper could be assembled entirely from
    # unchecked questions and go straight to render. An exam is only as good as the pool
    # it is drawn from, so the filtering belongs here rather than in a later gate.
    pool = list(
        (
            await db.execute(
                select(Question).where(
                    Question.course_id == payload.course_id,
                    Question.answer_md.isnot(None),
                    Question.answer_md != "",
                    Question.needs_human_review.is_(False),
                )
            )
        )
        .scalars()
        .all()
    )

    # Questions carrying an unresolved blocking finding are excluded outright.
    flagged = set(
        (
            await db.execute(
                select(ValidationFinding.question_id).where(
                    ValidationFinding.severity == "blocking",
                    ValidationFinding.status == "open",
                    ValidationFinding.question_id.isnot(None),
                )
            )
        )
        .scalars()
        .all()
    )
    pool = [q for q in pool if q.id not in flagged]

    # Best first, so a slot with several candidates gets the strongest one.
    pool.sort(
        key=lambda q: (
            -(q.eval_correctness or 0),
            -(q.eval_clarity or 0),
            -(q.scope_alignment or 0),
        )
    )

    if not pool:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "No questions qualify: every candidate is missing an answer key, is flagged "
            "for human review, or has an unresolved blocking finding.",
        )
    created: list[str] = []
    # Across variants, not per variant. Reset per variant, every paper picked the
    # same best question for each slot and "2 variants" produced two byte-identical
    # exams — silently, which is worse than failing. Variants exist so two sittings
    # get different papers, so a question used by one must not reappear in the next
    # while any alternative remains.
    used_across: set[uuid.UUID] = set()
    exhausted: list[str] = []

    for variant in range(payload.variants):
        exam = Exam(
            course_id=payload.course_id,
            title=(
                payload.title
                if payload.variants == 1
                else f"{payload.title} — Variant {variant + 1}"
            ),
            total_minutes=payload.total_minutes,
            origin="generated",
            status="draft",
        )
        db.add(exam)
        await db.flush()
        used_here: set[uuid.UUID] = set()
        for position, slot in enumerate(payload.slots):

            def _matches(q: Question) -> bool:
                return (slot.category is None or q.category == slot.category) and (
                    slot.difficulty is None or q.difficulty == slot.difficulty
                )

            pick = next(
                (q for q in pool if _matches(q) and q.id not in used_across), None
            )
            if pick is None:
                # The category ran dry across variants. Repeating a question between
                # papers is a compromise, but an empty slot is a broken paper — take
                # the reuse and tell the caller which categories were too thin.
                pick = next(
                    (q for q in pool if _matches(q) and q.id not in used_here), None
                )
                if pick is not None and slot.category:
                    exhausted.append(slot.category)
            if pick is None:
                continue
            used_here.add(pick.id)
            used_across.add(pick.id)
            # A question authored with its own sub-marks is worth what those sum to.
            # Stamping the blueprint's number on top of it produces a paper whose
            # header contradicts its own sub-parts — the defect the validator then
            # blocks the compile for. Prefer the question's own arithmetic and treat
            # the slot's points as the fallback for questions that declare none.
            declared = intrinsic_marks(pick.prompt_md or "")
            db.add(
                ExamQuestion(
                    exam_id=exam.id,
                    question_id=pick.id,
                    position=position,
                    points=declared if declared else slot.points,
                    category=slot.category or pick.category,
                )
            )
        created.append(str(exam.id))
    await db.commit()
    return {"exam_ids": created, "reused_categories": sorted(set(exhausted))}


@router.post("/{exam_id}/render", status_code=status.HTTP_202_ACCEPTED)
async def render_exam_route(
    exam_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> dict[str, str]:
    """Enqueue LaTeX rendering of an exam."""
    exam = await db.get(Exam, exam_id)
    if exam is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exam not found")
    await enqueue("render_exam", str(exam_id))
    return {"status": "enqueued", "exam_id": str(exam_id)}


@router.post("/{exam_id}/compile", status_code=status.HTTP_202_ACCEPTED)
async def compile_exam_route(
    exam_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> dict[str, str]:
    """Enqueue PDF compilation of a rendered exam."""
    exam = await db.get(Exam, exam_id)
    if exam is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exam not found")
    if not exam.tex_path:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "exam has not been rendered — render it first"
        )
    # Fail fast in the request rather than letting the job discover it, so the UI can
    # show the findings instead of a generic job error.
    blocking = await open_blocking(db, exam_id)
    if blocking and not exam.validation_override_reason:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {
                "message": f"{len(blocking)} unresolved blocking finding(s) — fix or override",
                "findings": [
                    {"rule_id": f.rule_id, "title": f.title, "question_id": str(f.question_id or "")}
                    for f in blocking
                ],
            },
        )
    await enqueue("compile_exam_pdf", str(exam_id))
    return {"status": "enqueued", "exam_id": str(exam_id)}


class ExamOverride(BaseModel):
    reason: str


class FindingPatch(BaseModel):
    status: str
    note: str | None = None


@router.post("/{exam_id}/validate", status_code=status.HTTP_202_ACCEPTED)
async def validate_exam_route(
    exam_id: uuid.UUID,
    deep: bool = Query(False, description="also run the AI reviewers (slow)"),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Enqueue validation. `deep=false` is the free deterministic tier only."""
    exam = await db.get(Exam, exam_id)
    if exam is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exam not found")
    await enqueue("validate_exam_job", str(exam_id), deep)
    return {"status": "enqueued", "exam_id": str(exam_id), "deep": str(deep).lower()}


@router.get("/{exam_id}/findings")
async def get_exam_findings(
    exam_id: uuid.UUID,
    include_resolved: bool = Query(False),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    """Findings for one exam, most severe first."""
    exam = await db.get(Exam, exam_id)
    if exam is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exam not found")

    stmt = select(ValidationFinding).where(ValidationFinding.exam_id == exam_id)
    if not include_resolved:
        stmt = stmt.where(ValidationFinding.status == "open")
    rows = list((await db.execute(stmt)).scalars().all())
    order = {"blocking": 0, "warning": 1, "note": 2}
    rows.sort(key=lambda f: (order.get(f.severity, 3), f.rule_id))

    return {
        "exam_id": str(exam_id),
        "validation_status": exam.validation_status,
        "validated_at": exam.validated_at.isoformat() if exam.validated_at else None,
        "override_reason": exam.validation_override_reason,
        "counts": {
            sev: sum(1 for f in rows if f.severity == sev and f.status == "open")
            for sev in ("blocking", "warning", "note")
        },
        "findings": [
            {
                "id": str(f.id),
                "rule_id": f.rule_id,
                "severity": f.severity,
                "title": f.title,
                "detail_md": f.detail_md,
                "evidence": f.evidence,
                "status": f.status,
                "auto_fixable": f.auto_fixable,
                "question_id": str(f.question_id) if f.question_id else None,
                "resolution_note": f.resolution_note,
            }
            for f in rows
        ],
    }


@router.patch("/findings/{finding_id}")
async def patch_finding(
    finding_id: uuid.UUID, payload: FindingPatch, db: AsyncSession = Depends(get_db)
) -> dict[str, str]:
    """Rule on a finding — accept it, dismiss it, or reopen it."""
    allowed = {"open", "accepted", "dismissed", "fixed"}
    if payload.status not in allowed:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"status must be one of {sorted(allowed)}")
    finding = await db.get(ValidationFinding, finding_id)
    if finding is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Finding not found")
    finding.status = payload.status
    if payload.note is not None:
        finding.resolution_note = payload.note
    if finding.exam_id:
        exam = await db.get(Exam, finding.exam_id)
        if exam is not None:
            await refresh_status(db, exam)
    await db.commit()
    return {"status": finding.status, "finding_id": str(finding_id)}


@router.post("/{exam_id}/override")
async def override_exam_validation(
    exam_id: uuid.UUID, payload: ExamOverride, db: AsyncSession = Depends(get_db)
) -> dict[str, str]:
    """Compile past blocking findings, on the record.

    Pass an empty reason to withdraw a previous override.
    """
    exam = await db.get(Exam, exam_id)
    if exam is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exam not found")
    reason = payload.reason.strip()
    exam.validation_override_reason = reason or None
    await refresh_status(db, exam)
    await db.commit()
    return {"exam_id": str(exam_id), "validation_status": exam.validation_status}


@router.get("/{exam_id}/file")
async def get_exam_file(
    exam_id: uuid.UUID,
    kind: str = Query(default="pdf"),
    download: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    """Serve an exam's rendered .tex or compiled .pdf.

    Default disposition is `inline` so browsers render the PDF in an <iframe>
    (and show the .tex as text). Pass `?download=true` to get an `attachment`
    disposition with a sensible filename for downloads.
    """
    if kind not in ("tex", "pdf", "source", "solution-pdf"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "kind must be tex, pdf, source, or solution-pdf",
        )
    exam = await db.get(Exam, exam_id)
    if exam is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exam not found")
    if kind == "source":
        path_str = exam.source_pdf_path
    elif kind == "solution-pdf":
        path_str = exam.solution_pdf_path
    else:
        path_str = exam.tex_path if kind == "tex" else exam.pdf_path
    if not path_str:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"exam has no {kind} — not built yet")
    path = Path(path_str)
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{kind} file missing on disk")
    media = (
        "application/pdf"
        if kind in ("pdf", "source", "solution-pdf")
        else "text/plain; charset=utf-8"
    )
    safe_title = "".join(c if c.isalnum() or c in "-_." else "_" for c in exam.title)
    if download:
        return FileResponse(
            path, media_type=media, filename=f"{safe_title}.{kind}"
        )
    headers = {"Content-Disposition": f'inline; filename="{safe_title}.{kind}"'}
    return FileResponse(path, media_type=media, headers=headers)


_SOURCE_EXTS = {".tex", ".sty", ".cls", ".md", ".bib"}


def _resolve_exam_source(
    exam: Exam, course: Course, rel_path: str
) -> Path:
    """Resolve a relative source path inside the exam folder safely."""
    from app.workflows.exam import exam_dir as _exam_dir

    if not course.workshop_path:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "course workshop_path is not configured")
    edir = _exam_dir(Path(course.workshop_path), exam).resolve()
    if not edir.is_dir():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "exam folder not found — render the exam first")
    rel = (rel_path or "").lstrip("/")
    if not rel or ".." in Path(rel).parts:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid path")
    target = (edir / rel).resolve()
    try:
        target.relative_to(edir)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "path escapes the exam folder") from None
    if target.suffix.lower() not in _SOURCE_EXTS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"editing {target.suffix} files is not allowed")
    return target


@router.get("/{exam_id}/sources")
async def list_exam_sources(
    exam_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> dict[str, list[dict[str, str | int]]]:
    """List editable .tex / .sty / .cls / .md files inside the exam folder.
    Each entry has {name, size, mtime}. The frontend's source editor renders
    these in a side rail."""
    from app.workflows.exam import exam_dir as _exam_dir

    exam = await db.get(Exam, exam_id)
    if exam is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exam not found")
    course = await db.get(Course, exam.course_id)
    if course is None or not course.workshop_path:
        return {"files": []}
    edir = _exam_dir(Path(course.workshop_path), exam)
    if not edir.is_dir():
        return {"files": []}
    files: list[dict[str, str | int]] = []
    for f in sorted(edir.iterdir(), key=lambda p: p.name):
        if f.is_file() and f.suffix.lower() in _SOURCE_EXTS:
            stat = f.stat()
            files.append(
                {"name": f.name, "size": int(stat.st_size), "mtime": int(stat.st_mtime)}
            )
    return {"files": files}


@router.get("/{exam_id}/source")
async def read_exam_source(
    exam_id: uuid.UUID,
    path: str = Query(...),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    exam = await db.get(Exam, exam_id)
    if exam is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exam not found")
    course = await db.get(Course, exam.course_id)
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found")
    target = _resolve_exam_source(exam, course, path)
    if not target.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "file not found")
    text = target.read_text(encoding="utf-8", errors="replace")
    return {"name": target.name, "path": path, "content": text}


class ExamSourceWrite(BaseModel):
    path: str
    content: str


@router.put("/{exam_id}/source")
async def write_exam_source(
    exam_id: uuid.UUID,
    payload: ExamSourceWrite,
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Write a per-exam source file. User must Recompile afterwards to refresh
    the PDF. exam.tex / _questions.tex / instructions.tex / *.sty are all
    editable; the auto-render does not touch them on subsequent rebuilds."""
    exam = await db.get(Exam, exam_id)
    if exam is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exam not found")
    course = await db.get(Course, exam.course_id)
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found")
    target = _resolve_exam_source(exam, course, payload.path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(payload.content, encoding="utf-8")
    return {"status": "ok", "name": target.name, "path": payload.path}


@router.post("/{exam_id}/reset-template", status_code=status.HTTP_202_ACCEPTED)
async def reset_exam_template_route(
    exam_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Discard per-exam .sty / instructions.tex / exam.tex customizations and
    re-copy from materials/exam-template/. Question content is unaffected."""
    exam = await db.get(Exam, exam_id)
    if exam is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exam not found")
    await enqueue("reset_exam_template", str(exam_id))
    return {"status": "enqueued", "exam_id": str(exam_id)}


@router.post("/{exam_id}/reproduction-compare", status_code=status.HTTP_202_ACCEPTED)
async def reproduction_compare_route(
    exam_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Score how identical a reference exam's reproduction is to the original.
    Requires both `source_pdf_path` (original) and `pdf_path` (rebuilt) set."""
    exam = await db.get(Exam, exam_id)
    if exam is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exam not found")
    if not exam.source_pdf_path or not exam.pdf_path:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Both the source PDF and the reproduced PDF must exist before comparing.",
        )
    await enqueue("compare_reproduction_job", str(exam_id))
    return {"status": "enqueued", "exam_id": str(exam_id)}


class ExamAnalyzeRequest(BaseModel):
    material_ids: list[uuid.UUID] | None = None


@router.post("/{exam_id}/analyze")
async def analyze_exam_route(
    exam_id: uuid.UUID,
    payload: ExamAnalyzeRequest,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Synchronously analyse an exam — coverage, difficulty curve, gaps, swaps."""
    exam = await db.get(Exam, exam_id)
    if exam is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exam not found")
    try:
        return await analyze_exam(db, exam_id, payload.material_ids)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR, f"exam analysis failed: {exc}"
        ) from exc


@router.delete("/{exam_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_exam(
    exam_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> None:
    exam = await db.get(Exam, exam_id)
    if exam is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exam not found")
    # A finding about a *question* outlives the exam that surfaced it. Cascading it
    # away meant deleting an exam laundered the defect: the question became eligible
    # for the next build and was picked straight back in. Detach question-scoped
    # findings; only exam-scoped ones die with the exam.
    await db.execute(
        update(ValidationFinding)
        .where(
            ValidationFinding.exam_id == exam_id,
            ValidationFinding.question_id.isnot(None),
        )
        .values(exam_id=None)
    )
    await db.delete(exam)


def _material_stem(filename: str) -> str:
    stem, dot, _ext = (filename or "").rpartition(".")
    return stem if dot else (filename or "")


@router.post("/import-reference", status_code=status.HTTP_201_CREATED)
async def import_reference_exams(
    course_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    """Register the course's past exams (materials/exams/) as reference Exam rows,
    linking the questions harvested from each.

    Sibling .pdf / .tex of the same exam are collapsed into ONE reference exam
    (the .pdf is preferred for the source-PDF preview / reproduction compare).
    Questions are matched by source_material_ids (reliable) with a source_ref
    filename fallback, and pulled across the whole sibling group — because the
    harvest dedup may have tagged them under whichever sibling was harvested
    first. Idempotent + self-cleaning: redundant auto-created reference rows
    are dropped on re-import."""
    course = await db.get(Course, course_id)
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found")
    mats = list(
        (
            await db.execute(
                select(Material).where(
                    Material.course_id == course_id,
                    Material.collection == "exams",
                )
            )
        ).scalars().all()
    )
    existing_refs = list(
        (
            await db.execute(
                select(Exam).where(Exam.course_id == course_id, Exam.origin == "reference")
            )
        ).scalars().all()
    )
    existing_by_title = {e.title: e for e in existing_refs}
    materials_root = (
        Path(course.materials_path) if getattr(course, "materials_path", None) else None
    )

    def _source_pdf_path(material: Material) -> str | None:
        if not materials_root or not material.subpath:
            return None
        src = materials_root / material.subpath
        if src.is_file() and src.suffix.lower() == ".pdf":
            return str(src)
        return None

    # Group sibling materials (same folder + stem) so a .pdf/.tex pair becomes
    # one reference exam.
    groups: dict[tuple[str, str], list[Material]] = {}
    for m in mats:
        sub = m.subpath or (m.original_filename or "")
        key = (str(Path(sub).parent), _material_stem(m.original_filename or ""))
        groups.setdefault(key, []).append(m)

    # All harvested questions for the course — matched in Python so we can
    # check both source_material_ids overlap and the source_ref prefix.
    harvested = list(
        (
            await db.execute(
                select(Question)
                .where(
                    Question.course_id == course_id,
                    Question.origin == "harvested",
                )
                .order_by(Question.created_at)
            )
        ).scalars().all()
    )

    created = 0
    relinked = 0
    claimed_exam_ids: set[uuid.UUID] = set()
    for group in groups.values():
        primary = next(
            (m for m in group if (m.original_filename or "").lower().endswith(".pdf")),
            group[0],
        )
        title = primary.title or primary.original_filename
        src_pdf = _source_pdf_path(primary)
        group_ids = {str(m.id) for m in group}
        group_names = [m.original_filename or "" for m in group]

        # Reuse an existing reference exam matching any sibling's title.
        exam = None
        for m in group:
            cand = existing_by_title.get(m.title or m.original_filename)
            if cand is not None:
                exam = cand
                break
        if exam is None:
            exam = Exam(
                course_id=course_id,
                title=title,
                origin="reference",
                status="reference",
                source_pdf_path=src_pdf,
            )
            db.add(exam)
            await db.flush()
            created += 1
        else:
            await db.execute(delete(ExamQuestion).where(ExamQuestion.exam_id == exam.id))
            exam.title = title  # normalise to the .pdf-preferred title
            if src_pdf:
                exam.source_pdf_path = src_pdf
            relinked += 1
        claimed_exam_ids.add(exam.id)

        def _belongs(q: Question) -> bool:
            if any(mid in (q.source_material_ids or []) for mid in group_ids):
                return True
            ref = q.source_ref or ""
            return any(ref == n or ref.startswith(f"{n} ") for n in group_names)

        questions = [q for q in harvested if _belongs(q)]
        for i, q in enumerate(questions, start=1):
            db.add(
                ExamQuestion(
                    exam_id=exam.id, question_id=q.id, position=i, points=1, category=q.category
                )
            )

    # Drop redundant auto-created reference rows (e.g. the leftover .tex sibling
    # exam once its group merged into the .pdf one). Only delete reference rows
    # that were NOT claimed AND whose title is a known exam-material filename —
    # never touch generated exams or manually-titled rows.
    material_filenames = {m.original_filename for m in mats} | {m.title for m in mats}
    dropped = 0
    for e in existing_refs:
        if e.id not in claimed_exam_ids and e.title in material_filenames:
            await db.delete(e)
            dropped += 1

    await db.commit()
    return {"imported": created, "relinked": relinked, "dropped": dropped}


class ExamBatchRequest(BaseModel):
    exam_ids: list[uuid.UUID]
    overwrite: bool = False


@router.post("/render-batch", status_code=status.HTTP_202_ACCEPTED)
async def render_batch(
    payload: ExamBatchRequest, db: AsyncSession = Depends(get_db)
) -> dict[str, int]:
    """Enqueue render_exam for many exams. Without overwrite, skips already-rendered."""
    stmt = select(Exam.id).where(Exam.id.in_(payload.exam_ids))
    if not payload.overwrite:
        stmt = stmt.where(Exam.tex_path.is_(None))
    ids = list((await db.execute(stmt)).scalars().all())
    for eid in ids:
        await enqueue("render_exam", str(eid))
    return {"enqueued": len(ids), "skipped": len(payload.exam_ids) - len(ids)}


@router.post("/compile-batch", status_code=status.HTTP_202_ACCEPTED)
async def compile_batch(
    payload: ExamBatchRequest, db: AsyncSession = Depends(get_db)
) -> dict[str, int]:
    """Enqueue compile_exam_pdf for many exams. Without overwrite, skips already-compiled."""
    stmt = select(Exam.id).where(
        Exam.id.in_(payload.exam_ids), Exam.tex_path.is_not(None)
    )
    if not payload.overwrite:
        stmt = stmt.where(Exam.pdf_path.is_(None))
    ids = list((await db.execute(stmt)).scalars().all())
    for eid in ids:
        await enqueue("compile_exam_pdf", str(eid))
    return {"enqueued": len(ids), "skipped": len(payload.exam_ids) - len(ids)}


@router.post("/delete-batch", status_code=status.HTTP_200_OK)
async def delete_exams_batch(
    payload: ExamBatchRequest, db: AsyncSession = Depends(get_db)
) -> dict[str, int]:
    """Delete many exams (and cascade their ExamQuestion rows)."""
    rows = list(
        (
            await db.execute(select(Exam).where(Exam.id.in_(payload.exam_ids)))
        ).scalars().all()
    )
    # Same rule as the single delete: a question's defect survives the exam.
    await db.execute(
        update(ValidationFinding)
        .where(
            ValidationFinding.exam_id.in_([e.id for e in rows]),
            ValidationFinding.question_id.isnot(None),
        )
        .values(exam_id=None)
    )
    for e in rows:
        await db.delete(e)
    await db.commit()
    return {"deleted": len(rows)}
