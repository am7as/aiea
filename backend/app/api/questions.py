from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import get_db
from app.db.models import Course, ExamQuestion, Question
from app.queue import enqueue
from app.schemas.question import (
    QuestionGenerateRequest,
    QuestionGenerateResult,
    QuestionRead,
    QuestionUpdate,
)
from app.validate.lint import lint_question
from app.validate.repair import repair_finding
from app.vault.parse_question import apply_parsed, diff_against, read_question_folder
from app.vault.questions import (
    question_dir,
    question_figures_dir,
    write_question_md,
)

router = APIRouter(prefix="/questions", tags=["questions"])


@router.post("/reconcile")
async def reconcile_questions(
    course_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    """Drop DB rows whose question folder is missing from the workshop vault.
    Used by the Question Bank's Resync button when the user has wiped the
    questions/ folder for a clean test. Returns the ids that were removed."""
    course = await db.get(Course, course_id)
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found")
    if not course.workshop_path:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "course workshop_path is not configured")
    workshop = Path(course.workshop_path)
    brain = Path(course.brain_path) if course.brain_path else None
    rows = list(
        (
            await db.execute(
                select(Question).where(Question.course_id == course_id)
            )
        ).scalars().all()
    )
    removed: list[uuid.UUID] = []
    for q in rows:
        qdir = question_dir(workshop, q, brain)
        qfile = qdir / "question.md"
        if qfile.is_file():
            continue
        if q.vault_path and Path(q.vault_path).is_file():
            continue
        removed.append(q.id)
    if removed:
        await db.execute(
            delete(ExamQuestion).where(ExamQuestion.question_id.in_(removed))
        )
        await db.execute(delete(Question).where(Question.id.in_(removed)))
    await db.commit()
    removed_strs = [str(x) for x in removed]
    return {
        "course_id": str(course_id),
        "removed": len(removed_strs),
        "removed_ids": removed_strs,
        "kept": len(rows) - len(removed_strs),
    }


@router.get("/", response_model=list[QuestionRead])
async def list_questions(
    course_id: uuid.UUID | None = None,
    status_: str | None = Query(default=None, alias="status"),
    kind: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[QuestionRead]:
    stmt = select(Question).order_by(Question.created_at.desc())
    if course_id is not None:
        stmt = stmt.where(Question.course_id == course_id)
    if status_ is not None:
        stmt = stmt.where(Question.status == status_)
    if kind is not None:
        stmt = stmt.where(Question.kind == kind)
    rows = (await db.execute(stmt)).scalars().all()
    return [QuestionRead.model_validate(q) for q in rows]


@router.post(
    "/generate",
    response_model=QuestionGenerateResult,
    status_code=status.HTTP_202_ACCEPTED,
)
async def generate_questions_route(
    payload: QuestionGenerateRequest,
    db: AsyncSession = Depends(get_db),
) -> QuestionGenerateResult:
    course = await db.get(Course, payload.course_id)
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found")
    if not course.workshop_path:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "course workshop_path is not configured")
    await enqueue(
        "generate_questions",
        {
            "course_id": str(payload.course_id),
            "material_ids": [str(m) for m in payload.material_ids],
            "kind": payload.kind,
            "count": payload.count,
            "difficulty": payload.difficulty,
            "bloom": payload.bloom,
            "topics": payload.topics,
            "chapter_id": payload.chapter_id,
            "category": payload.category,
            "with_diagrams": payload.with_diagrams,
        },
    )
    return QuestionGenerateResult(
        status="generating",
        detail=f"generating {payload.count} {payload.kind} question(s) — refresh shortly",
    )


class HarvestRequest(BaseModel):
    material_ids: list[uuid.UUID]


@router.post("/harvest", status_code=status.HTTP_202_ACCEPTED)
async def harvest_questions_route(payload: HarvestRequest) -> dict[str, int]:
    """Harvest existing questions out of extracted past-exam / exercise materials."""
    for mid in payload.material_ids:
        await enqueue("harvest_questions_job", str(mid))
    return {"enqueued": len(payload.material_ids)}


class QuestionBatchRequest(BaseModel):
    """A batch of questions + an overwrite toggle."""

    question_ids: list[uuid.UUID]
    overwrite: bool = False


class ClassifyBatchRequest(BaseModel):
    course_id: uuid.UUID
    question_ids: list[uuid.UUID] | None = None


@router.post("/classify-batch", status_code=status.HTTP_202_ACCEPTED)
async def classify_batch_route(
    payload: ClassifyBatchRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    """Enqueue classification for untagged questions in a course (or a given list)."""
    course = await db.get(Course, payload.course_id)
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found")
    if payload.question_ids is not None:
        ids = list(payload.question_ids)
    else:
        stmt = select(Question.id).where(
            Question.course_id == payload.course_id,
            or_(Question.chapter_id.is_(None), Question.bloom.is_(None)),
        )
        ids = [row for row in (await db.execute(stmt)).scalars().all()]
    for qid in ids:
        await enqueue("classify_question_job", str(qid))
    return {"enqueued": len(ids)}


@router.post("/answer-batch", status_code=status.HTTP_202_ACCEPTED)
async def answer_batch(
    payload: QuestionBatchRequest, db: AsyncSession = Depends(get_db)
) -> dict[str, int]:
    """Enqueue the answer-finder for many questions. Without overwrite, skips
    questions that already carry a worked solution."""
    stmt = select(Question.id).where(Question.id.in_(payload.question_ids))
    if not payload.overwrite:
        stmt = stmt.where(Question.worked_solution_md.is_(None))
    ids = list((await db.execute(stmt)).scalars().all())
    for qid in ids:
        await enqueue("find_answer_job", str(qid))
    return {"enqueued": len(ids), "skipped": len(payload.question_ids) - len(ids)}


@router.post("/evaluate-batch", status_code=status.HTTP_202_ACCEPTED)
async def evaluate_batch(
    payload: QuestionBatchRequest, db: AsyncSession = Depends(get_db)
) -> dict[str, int]:
    """Enqueue evaluation for many questions. Without overwrite, skips questions
    that already carry an eval_correctness score."""
    stmt = select(Question.id).where(Question.id.in_(payload.question_ids))
    if not payload.overwrite:
        stmt = stmt.where(Question.eval_correctness.is_(None))
    ids = list((await db.execute(stmt)).scalars().all())
    for qid in ids:
        await enqueue("evaluate_question_job", str(qid))
    return {"enqueued": len(ids), "skipped": len(payload.question_ids) - len(ids)}


@router.post("/feedback-batch", status_code=status.HTTP_202_ACCEPTED)
async def feedback_batch(
    payload: QuestionBatchRequest, db: AsyncSession = Depends(get_db)
) -> dict[str, int]:
    """Enqueue feedback for many questions. Without overwrite, skips questions
    that already carry a feedback_md."""
    stmt = select(Question.id).where(Question.id.in_(payload.question_ids))
    if not payload.overwrite:
        stmt = stmt.where(Question.feedback_md.is_(None))
    ids = list((await db.execute(stmt)).scalars().all())
    for qid in ids:
        await enqueue("feedback_question_job", str(qid))
    return {"enqueued": len(ids), "skipped": len(payload.question_ids) - len(ids)}


@router.post("/similarity-batch", status_code=status.HTTP_202_ACCEPTED)
async def similarity_batch(
    payload: QuestionBatchRequest, db: AsyncSession = Depends(get_db)
) -> dict[str, int]:
    """Enqueue reference-similarity for many questions. Without overwrite,
    skips questions that already carry a reference_deviation. Harvested
    questions are skipped — they ARE the reference set."""
    stmt = select(Question.id).where(
        Question.id.in_(payload.question_ids),
        Question.origin != "harvested",
    )
    if not payload.overwrite:
        stmt = stmt.where(Question.reference_deviation.is_(None))
    ids = list((await db.execute(stmt)).scalars().all())
    for qid in ids:
        await enqueue("similarity_question_job", str(qid))
    return {"enqueued": len(ids), "skipped": len(payload.question_ids) - len(ids)}


@router.post("/delete-batch", status_code=status.HTTP_200_OK)
async def delete_batch(
    payload: QuestionBatchRequest, db: AsyncSession = Depends(get_db)
) -> dict[str, int]:
    """Delete many questions + their vault .md files."""
    rows = list(
        (
            await db.execute(
                select(Question).where(Question.id.in_(payload.question_ids))
            )
        )
        .scalars()
        .all()
    )
    deleted = 0
    for q in rows:
        course = await db.get(Course, q.course_id)
        if course is not None and course.workshop_path:
            brain = Path(course.brain_path) if course.brain_path else None
            _remove_question_folder(Path(course.workshop_path), q, brain)
        await db.delete(q)
        deleted += 1
    await db.commit()
    return {"deleted": deleted}


def _remove_question_folder(workshop: Path, q: Question, brain: Path | None) -> None:
    import shutil

    qdir = question_dir(workshop, q, brain)
    if qdir.is_dir():
        shutil.rmtree(qdir, ignore_errors=True)
    legacy = qdir.parent / f"{q.id}.md"
    try:
        legacy.unlink(missing_ok=True)
    except OSError:
        pass


@router.get("/{question_id}", response_model=QuestionRead)
async def get_question(
    question_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> QuestionRead:
    q = await db.get(Question, question_id)
    if q is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found")
    return QuestionRead.model_validate(q)


@router.post("/{question_id}/answer", status_code=status.HTTP_202_ACCEPTED)
async def answer_question_route(
    question_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Enqueue the answer-finder for one question (worked solution + answer key)."""
    q = await db.get(Question, question_id)
    if q is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found")
    await enqueue("find_answer_job", str(question_id))
    return {"status": "enqueued", "question_id": str(question_id)}


@router.post("/{question_id}/evaluate", status_code=status.HTTP_202_ACCEPTED)
async def evaluate_question_route(
    question_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Enqueue evaluation for one question (correctness, clarity, difficulty, Bloom)."""
    q = await db.get(Question, question_id)
    if q is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found")
    await enqueue("evaluate_question_job", str(question_id))
    return {"status": "enqueued", "question_id": str(question_id)}


@router.post("/{question_id}/feedback", status_code=status.HTTP_202_ACCEPTED)
async def feedback_question_route(
    question_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Enqueue the feedback critic for one question."""
    q = await db.get(Question, question_id)
    if q is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found")
    await enqueue("feedback_question_job", str(question_id))
    return {"status": "enqueued", "question_id": str(question_id)}


@router.post("/{question_id}/similarity", status_code=status.HTTP_202_ACCEPTED)
async def similarity_question_route(
    question_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Enqueue reference-similarity scoring for one question."""
    q = await db.get(Question, question_id)
    if q is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found")
    if q.origin == "harvested":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "harvested questions are the reference set — no similarity to compute",
        )
    await enqueue("similarity_question_job", str(question_id))
    return {"status": "enqueued", "question_id": str(question_id)}


@router.post("/{question_id}/translate")
async def translate_question_route(
    question_id: uuid.UUID,
    refresh: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Produce / refresh the Swedish translation of a question (synchronous)."""
    from app.generate.translate import translate_question_sv

    q = await db.get(Question, question_id)
    if q is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found")
    try:
        sv = await translate_question_sv(db, question_id, refresh=refresh)
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR, f"translation failed: {exc}"
        ) from exc
    return {"question_id": str(question_id), "translation_sv": sv}


@router.get("/{question_id}/figures/{name}")
async def get_question_figure(
    question_id: uuid.UUID,
    name: str,
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    """Serve a rendered figure PNG for a question."""
    if "/" in name or "\\" in name or ".." in name or not name.endswith(".png"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "bad figure name")
    q = await db.get(Question, question_id)
    if q is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found")
    course = await db.get(Course, q.course_id)
    if course is None or not course.workshop_path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "course workshop not configured")
    brain = Path(course.brain_path) if course.brain_path else None
    path = question_figures_dir(Path(course.workshop_path), q, brain) / name
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "figure not found")
    return FileResponse(path, media_type="image/png")


@router.put("/{question_id}", response_model=QuestionRead)
async def update_question(
    question_id: uuid.UUID,
    payload: QuestionUpdate,
    db: AsyncSession = Depends(get_db),
) -> QuestionRead:
    """Edit a question — applies the supplied fields and rewrites its .md."""
    q = await db.get(Question, question_id)
    if q is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(q, field, value)
    course = await db.get(Course, q.course_id)
    if course is not None and course.workshop_path:
        brain = Path(course.brain_path) if course.brain_path else None
        q.vault_path = str(write_question_md(Path(course.workshop_path), q, brain))
    await db.commit()
    await db.refresh(q)
    return QuestionRead.model_validate(q)


@router.post("/{question_id}/validate")
async def validate_question_route(
    question_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> dict[str, object]:
    """Run the deterministic rules over one question. Synchronous — no AI call."""
    try:
        result = await lint_question(db, question_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return {
        "question_id": str(question_id),
        "counts": {
            "blocking": len(result.blocking),
            "warning": len(result.warnings),
            "note": len(result.notes),
        },
        "findings": [
            {
                "rule_id": f.rule_id,
                "severity": f.severity,
                "title": f.title,
                "detail_md": f.detail_md,
                "auto_fixable": f.auto_fixable,
            }
            for f in result.findings
        ],
    }


class RepairRequest(BaseModel):
    apply: bool = False


@router.post("/findings/{finding_id}/repair")
async def repair_finding_route(
    finding_id: uuid.UUID,
    payload: RepairRequest | None = None,
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    """Fix one finding.

    Deterministic rules apply immediately. Judgement rules return a proposal; send
    `apply=true` once a human has read the diff.
    """
    try:
        result = await repair_finding(
            db, finding_id, apply_proposal=bool(payload and payload.apply)
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return {
        "applied": result.applied,
        "proposal": result.proposal,
        "change_summary": result.change_summary,
        "blocked_reason": result.blocked_reason,
        "diff": result.diff,
    }


class PullRequest(BaseModel):
    apply: bool = False


@router.post("/{question_id}/pull-from-vault")
async def pull_question_from_vault(
    question_id: uuid.UUID,
    payload: PullRequest | None = None,
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    """Read this question's markdown back into the database.

    Every other path in AIEA writes DB -> disk, so an edit made in Obsidian is lost at
    the next write. This is the missing direction. Returns a diff by default; send
    `apply=true` to commit it.
    """
    q = await db.get(Question, question_id)
    if q is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found")
    course = await db.get(Course, q.course_id)
    if course is None or not course.workshop_path:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "course workshop_path is not configured")

    workshop = Path(course.workshop_path)
    brain = Path(course.brain_path) if course.brain_path else None
    folder = question_dir(workshop, q, brain)
    if not (folder / "question.md").is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"no question.md at {folder}")

    parsed = read_question_folder(folder)
    diff = diff_against(q, parsed)

    applied: list[str] = []
    if payload and payload.apply and diff:
        applied = apply_parsed(q, parsed)
        q.vault_path = str(write_question_md(workshop, q, brain))
        await db.commit()

    return {
        "question_id": str(question_id),
        "folder": str(folder),
        "in_sync": not diff,
        "changed_fields": applied,
        "diff": {
            name: {"before_chars": d["before_chars"], "after_chars": d["after_chars"],
                   "before": d["before"][:600], "after": d["after"][:600]}
            for name, d in diff.items()
        },
        "unknown_sections": parsed.unknown_sections,
    }


@router.delete("/{question_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_question(
    question_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> None:
    q = await db.get(Question, question_id)
    if q is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found")
    course = await db.get(Course, q.course_id)
    if course and course.workshop_path:
        brain = Path(course.brain_path) if course.brain_path else None
        _remove_question_folder(Path(course.workshop_path), q, brain)
    await db.delete(q)
