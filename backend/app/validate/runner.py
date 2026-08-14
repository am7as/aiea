"""Orchestrate a full validation pass over one exam.

Tier 1 (deterministic) always runs and is free. Tier 2 (the AI reviewers) is expensive
on a shim-backed CLI provider, so it runs only when asked, and a reviewer that cannot be
routed degrades to a note rather than failing the whole pass.
"""

from __future__ import annotations

import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.exam import Exam
from app.validate.lint import lint_exam
from app.validate.reviewers import audit_scope, blind_solve, examiner_review
from app.validate.rules import Finding
from app.validate.store import refresh_status, replace_exam_findings

log = logging.getLogger(__name__)


def _candidate_phrases(findings: list[Finding]) -> list[str]:
    """Phrases the linter could not rule on, for the syllabus auditor to judge."""
    out: list[str] = []
    for f in findings:
        if f.rule_id == "terminology.candidates":
            out.extend(str(c).split(" (")[0] for c in f.evidence.get("candidates", []))
        elif f.rule_id == "terminology.untaught":
            phrase = f.evidence.get("phrase")
            if phrase:
                out.append(str(phrase))
    # preserve order, drop duplicates
    return list(dict.fromkeys(out))


async def validate_exam(
    db: AsyncSession, exam_id: uuid.UUID, *, deep: bool = False
) -> dict:
    """Run validation over an exam and persist the findings.

    `deep=False` runs only the deterministic tier — sub-second, no AI call. `deep=True`
    adds the three reviewers.
    """
    exam = await db.get(Exam, exam_id)
    if exam is None:
        raise ValueError("exam not found")

    result = await lint_exam(db, exam_id)
    findings: list[Finding] = list(result.findings)
    reviewers: dict[str, str] = {}

    if deep:
        # Each reviewer is independent; one failing must not lose the others' findings.
        for name, coro in (
            ("syllabus-audit", audit_scope(db, exam_id, _candidate_phrases(result.findings))),
            ("exam-examiner", examiner_review(db, exam_id)),
        ):
            try:
                outcome = await coro
                findings.extend(outcome.findings)
                reviewers[name] = "ok" if outcome.ok else f"skipped: {outcome.error}"
                if not outcome.ok:
                    findings.append(
                        Finding(
                            rule_id="review.not-run",
                            severity="note",
                            title=f"{name} did not run",
                            detail_md=outcome.error,
                        )
                    )
            except Exception as exc:  # noqa: BLE001
                log.exception("%s failed for exam %s", name, exam_id)
                reviewers[name] = f"error: {exc}"
                findings.append(
                    Finding(
                        rule_id="review.not-run",
                        severity="note",
                        title=f"{name} failed",
                        detail_md=f"`{exc}`",
                    )
                )

        for eq in exam.questions:
            try:
                outcome = await blind_solve(db, eq.question_id)
                findings.extend(outcome.findings)
                if not outcome.ok:
                    reviewers["answer-validation"] = f"skipped: {outcome.error}"
                    findings.append(
                        Finding(
                            rule_id="review.not-run",
                            severity="note",
                            title="answer-validation did not run",
                            detail_md=outcome.error,
                        )
                    )
                    break  # the provider will not work for the other questions either
                reviewers["answer-validation"] = "ok"
            except Exception as exc:  # noqa: BLE001
                log.exception("blind solve failed for question %s", eq.question_id)
                reviewers["answer-validation"] = f"error: {exc}"

    counts = await replace_exam_findings(db, exam_id, findings)
    status = await refresh_status(db, exam)
    await db.commit()

    log.info("validated exam %s: status=%s counts=%s deep=%s", exam_id, status, counts, deep)
    return {
        "exam_id": str(exam_id),
        "status": status,
        "deep": deep,
        "questions_checked": result.questions_checked,
        "counts": counts,
        "reviewers": reviewers,
        "corpus_tiers": [{"tier": t, "documents": names} for t, names in result.corpus_tiers],
    }
