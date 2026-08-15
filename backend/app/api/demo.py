"""Demo reset — restore a course to a recorded baseline.

Exists for repeatable demo/walkthrough recording. A script that creates data through real
UI actions leaves that data behind, so re-running it after a pacing tweak duplicates rows
and vault folders. This lets a batch run start from a known state every time.

Deliberately **not** a wipe-and-reseed. AIEA's course data is expensive — hundreds of
questions, dozens of compiled exams, days of generation. Reset takes a *baseline snapshot*
first and then removes only what appeared after it, so a mistaken call costs nothing that
existed beforehand.

What it touches: questions, exams (with their vault folders and exam directories), and the
validation findings attached to them. What it does **not** touch: materials, extractions,
the course map, provider config, routing, or memory. Those are seed-once content — nothing
in the recording set creates them, and losing them would be expensive.

Off unless `AIEA_DEMO_RESET=1`. If `AIEA_DEMO_SECRET` is set, the mutating routes also
require it in `X-AIEA-Demo-Secret`.
"""

from __future__ import annotations

import hmac
import json
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import delete as sa_delete
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.questions import _remove_question_folder
from app.db.base import get_db
from app.db.models import Course, Exam, Question, ValidationFinding
from app.workflows.exam import exam_dir

router = APIRouter(prefix="/demo", tags=["demo"])

BASELINE_NAME = "demo-baseline.json"


def _enabled() -> bool:
    return os.getenv("AIEA_DEMO_RESET", "").strip().lower() in {"1", "true", "yes", "on"}


async def _guard(x_aiea_demo_secret: str | None = Header(default=None)) -> None:
    """404 when disabled — a build that shouldn't use this shouldn't advertise it."""
    if not _enabled():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not Found")
    expected = os.getenv("AIEA_DEMO_SECRET", "")
    if expected and not hmac.compare_digest(x_aiea_demo_secret or "", expected):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "bad or missing X-AIEA-Demo-Secret")


async def _course(db: AsyncSession, course_id: uuid.UUID) -> Course:
    course = await db.get(Course, course_id)
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found")
    if not course.workshop_path:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "course workshop_path is not configured")
    return course


def _baseline_path(course: Course) -> Path:
    return Path(course.workshop_path) / ".aiea" / BASELINE_NAME


def _read_baseline(course: Course) -> dict | None:
    p = _baseline_path(course)
    if not p.is_file():
        return None
    try:
        return json.loads(p.read_text())
    except (OSError, json.JSONDecodeError):
        return None


async def _ids(db: AsyncSession, course_id: uuid.UUID) -> tuple[list[str], list[str]]:
    qs = (
        await db.execute(select(Question.id).where(Question.course_id == course_id))
    ).scalars().all()
    es = (await db.execute(select(Exam.id).where(Exam.course_id == course_id))).scalars().all()
    return [str(i) for i in qs], [str(i) for i in es]


@router.get("/status")
async def demo_status(
    course_id: uuid.UUID | None = None, db: AsyncSession = Depends(get_db)
) -> dict[str, object]:
    """Whether demo reset is on, and whether a baseline exists. Safe to call always."""
    out: dict[str, object] = {
        "enabled": _enabled(),
        "secret_required": bool(os.getenv("AIEA_DEMO_SECRET", "")),
    }
    if course_id and _enabled():
        course = await _course(db, course_id)
        base = _read_baseline(course)
        q_now, e_now = await _ids(db, course_id)
        out["baseline"] = (
            None
            if base is None
            else {
                "taken_at": base.get("taken_at"),
                "questions": len(base.get("question_ids", [])),
                "exams": len(base.get("exam_ids", [])),
            }
        )
        out["current"] = {"questions": len(q_now), "exams": len(e_now)}
    return out


@router.post("/snapshot", dependencies=[Depends(_guard)])
async def take_snapshot(
    course_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> dict[str, object]:
    """Record the course's current questions and exams as the restore point."""
    course = await _course(db, course_id)
    q_ids, e_ids = await _ids(db, course_id)
    payload = {
        "taken_at": datetime.now(timezone.utc).isoformat(),
        "course_id": str(course_id),
        "question_ids": q_ids,
        "exam_ids": e_ids,
    }
    path = _baseline_path(course)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2))
    return {"baseline": str(path), "questions": len(q_ids), "exams": len(e_ids)}


@router.post("/reset", dependencies=[Depends(_guard)])
async def reset_to_baseline(
    course_id: uuid.UUID,
    dry_run: bool = Query(True, description="report what would go; pass false to delete"),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    """Delete every question and exam created since the baseline. Dry run by default."""
    course = await _course(db, course_id)
    base = _read_baseline(course)
    if base is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"no baseline for this course — POST /demo/snapshot first ({_baseline_path(course)})",
        )

    keep_q = set(base.get("question_ids", []))
    keep_e = set(base.get("exam_ids", []))
    workshop = Path(course.workshop_path)
    brain = Path(course.brain_path) if course.brain_path else None

    questions = [
        q
        for q in (
            await db.execute(select(Question).where(Question.course_id == course_id))
        ).scalars().all()
        if str(q.id) not in keep_q
    ]
    exams = [
        e
        for e in (
            await db.execute(select(Exam).where(Exam.course_id == course_id))
        ).scalars().all()
        if str(e.id) not in keep_e
    ]

    report: dict[str, object] = {
        "dry_run": dry_run,
        "baseline_taken_at": base.get("taken_at"),
        "questions": [str(q.id) for q in questions],
        "exams": [str(e.id) for e in exams],
    }
    if dry_run:
        return report

    for e in exams:
        # Findings about a *question* outlive the exam that surfaced them — detaching
        # rather than cascading is what stops a delete laundering a known defect.
        await db.execute(
            update(ValidationFinding)
            .where(
                ValidationFinding.exam_id == e.id,
                ValidationFinding.question_id.isnot(None),
            )
            .values(exam_id=None)
        )
        edir = exam_dir(workshop, e)
        if edir.is_dir():
            shutil.rmtree(edir, ignore_errors=True)
        await db.delete(e)

    for q in questions:
        await db.execute(sa_delete(ValidationFinding).where(ValidationFinding.question_id == q.id))
        _remove_question_folder(workshop, q, brain)
        await db.delete(q)

    await db.commit()
    report["deleted"] = {"questions": len(questions), "exams": len(exams)}
    return report
