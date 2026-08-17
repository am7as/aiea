"""Persist findings and derive an exam's validation status.

Findings are replaced wholesale on each run, with one deliberate exception: anything an
examiner has already ruled on (`accepted` / `dismissed`) survives, so a decision does not
have to be made twice. Matching across runs is by (rule_id, question_id, title), which is
stable for the deterministic rules and good enough for the AI ones.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.exam import Exam, ValidationFinding
from app.validate.rules import Finding

#: A ruling by the examiner outlives a re-run; an open or auto-fixed finding does not.
_STICKY = ("accepted", "dismissed")


def _key(rule_id: str, question_id: uuid.UUID | None, title: str) -> tuple:
    return (rule_id, str(question_id) if question_id else None, title)


async def replace_exam_findings(
    db: AsyncSession, exam_id: uuid.UUID, findings: list[Finding]
) -> dict[str, int]:
    """Write this run's findings, preserving examiner rulings from previous runs."""
    existing = list(
        (
            await db.execute(
                select(ValidationFinding).where(ValidationFinding.exam_id == exam_id)
            )
        )
        .scalars()
        .all()
    )
    ruled = {
        _key(f.rule_id, f.question_id, f.title): f for f in existing if f.status in _STICKY
    }

    await db.execute(
        delete(ValidationFinding).where(
            ValidationFinding.exam_id == exam_id,
            ValidationFinding.status.notin_(_STICKY),
        )
    )

    counts = {"blocking": 0, "warning": 0, "note": 0, "carried": 0}
    for f in findings:
        key = _key(f.rule_id, f.question_id, f.title)
        if key in ruled:
            counts["carried"] += 1
            continue  # already ruled on — do not resurrect it
        db.add(
            ValidationFinding(
                exam_id=exam_id,
                question_id=f.question_id,
                rule_id=f.rule_id,
                severity=f.severity,
                title=f.title,
                detail_md=f.detail_md,
                evidence=f.evidence or {},
                auto_fixable=f.auto_fixable,
                status="open",
            )
        )
        counts[f.severity] = counts.get(f.severity, 0) + 1

    await db.flush()
    return counts


async def open_blocking(db: AsyncSession, exam_id: uuid.UUID) -> list[ValidationFinding]:
    return list(
        (
            await db.execute(
                select(ValidationFinding).where(
                    ValidationFinding.exam_id == exam_id,
                    ValidationFinding.severity == "blocking",
                    ValidationFinding.status == "open",
                )
            )
        )
        .scalars()
        .all()
    )


async def refresh_status(db: AsyncSession, exam: Exam) -> str:
    """Recompute `exam.validation_status` from the current findings.

    An override survives only while it is still needed; once the blocking findings are
    gone the exam is simply clean, and the stale override reason is cleared so it cannot
    silently authorise a future defect.
    """
    blocking = await open_blocking(db, exam.id)
    if blocking:
        exam.validation_status = "overridden" if exam.validation_override_reason else "blocked"
    else:
        exam.validation_status = "clean"
        exam.validation_override_reason = None
    exam.validated_at = datetime.now(timezone.utc)
    return exam.validation_status
