"""The three AI reviewers, wired as AIEA tasks.

These are the roles that found the defects a deterministic linter cannot: a blind
solver that tries to answer the question as printed, an examiner that judges the paper
as an instrument, and a syllabus auditor that rules on terminology the linter can only
flag as suspicious.

Follows the established one-question-in idiom of `app/generate/feedback.py`.
Worker-side; the api only enqueues.
"""

from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.events import ChatMessage, GenParams
from app.ai.jsonparse import extract_object
from app.ai.providers.agent import AgentProvider
from app.ai.router import resolve
from app.db.models import Course, Question
from app.db.models.exam import Exam, ExamQuestion
from app.skills.loader import build_skill_prompt
from app.validate.corpus import Corpus, load_corpus
from app.validate.rules import Finding
from app.vault.questions import question_figure_images
from app.vault.syllabus import read_syllabus

log = logging.getLogger(__name__)

#: A blind solve is worthless if the model cannot see the figure — polarity marks and
#: arrow directions live only there. Vision is required, not preferred.
_VISION_REQUIRED = "answer-validation"


@dataclass
class ReviewOutcome:
    task: str
    ok: bool
    data: dict = field(default_factory=dict)
    findings: list[Finding] = field(default_factory=list)
    error: str = ""


async def _prepare(db: AsyncSession, course_id: uuid.UUID, task: str):
    course = await db.get(Course, course_id)
    if course is None or not course.workshop_path:
        raise ValueError("course workshop_path is not configured")
    resolution = await resolve(db, task)
    if resolution is None:
        raise ValueError(f"no AI route for {task} and no default route")
    workshop = Path(course.workshop_path)
    brain = Path(course.brain_path) if course.brain_path else None
    return course, resolution, workshop, brain


def _system_for(task: str, resolution, brain: Path | None) -> str:
    system = build_skill_prompt([task], brain)
    if not system:
        raise ValueError(f"runtime skill '{task}' not found")
    tone = build_skill_prompt(["anti-ai-tone"], brain)
    if tone:
        system += "\n\n---\n\n" + tone
    if resolution.system_prompt:
        system += "\n\n---\n\n" + resolution.system_prompt
    return system


async def _complete(resolution, parts: list[str], system: str, images: list[str], max_tokens: int):
    result = await resolution.provider.complete(
        [ChatMessage(role="user", content="\n".join(parts), images=images)],
        model=resolution.model,
        system=system,
        params=GenParams(
            temperature=resolution.params.temperature,
            max_tokens=max(resolution.params.max_tokens, max_tokens),
        ),
    )
    return extract_object(result.text)


# ── blind solver ──────────────────────────────────────────────────────────────


async def blind_solve(db: AsyncSession, question_id: uuid.UUID) -> ReviewOutcome:
    """Solve a question from its text and figures alone, then compare to the key.

    The model is given the key only in the second half of the prompt, after it has been
    told to commit to its own answer — the skill instructs it to solve first. Splitting
    this into two provider calls would be stricter but doubles the cost on a shim-backed
    CLI provider, and the ordering has held up in practice.
    """
    q = await db.get(Question, question_id)
    if q is None:
        raise ValueError("question not found")
    course, resolution, workshop, brain = await _prepare(db, q.course_id, "answer-validation")

    if isinstance(resolution.provider, AgentProvider) or not getattr(
        resolution.provider, "supports_vision", False
    ):
        return ReviewOutcome(
            task="answer-validation",
            ok=False,
            error=(
                "answer-validation needs a vision-capable provider — a blind solve "
                "cannot read polarity marks or arrow directions from text alone. "
                "Route it to a token/lmstudio/ollama provider with a vision model."
            ),
        )

    system = _system_for("answer-validation", resolution, brain)
    parts = [
        f"Question kind: {q.kind}",
        "",
        "## Question (solve this from the text and the figures below)",
        "",
        q.prompt_md or "",
    ]
    if q.distractors:
        parts += ["", "## Options", *[f"- {d}" for d in q.distractors]]
    parts += [
        "",
        "---",
        "",
        "Commit to your own answer before reading further.",
        "",
        "## Answer key (compare only after you have solved it)",
        "",
        q.answer_md or "_(none)_",
    ]
    if q.worked_solution_md:
        parts += ["", "## Worked solution", "", q.worked_solution_md]

    images = question_figure_images(workshop, q, brain)
    data = await _complete(resolution, parts, system, images, 3072)

    findings: list[Finding] = []
    verdict = str(data.get("verdict") or "").strip().lower()
    if verdict == "mismatch":
        findings.append(
            Finding(
                rule_id="review.answer-mismatch",
                severity="blocking",
                title="An independent solve disagrees with the answer key",
                detail_md=str(data.get("discrepancy_md") or "").strip(),
                evidence={"verdict": verdict, "confidence": data.get("confidence")},
                question_id=q.id,
            )
        )
    elif verdict == "ambiguous":
        findings.append(
            Finding(
                rule_id="review.ambiguous",
                severity="warning",
                title="The question admits more than one defensible answer",
                detail_md=str(data.get("discrepancy_md") or "").strip(),
                evidence={"verdict": verdict},
                question_id=q.id,
            )
        )
    for item in data.get("defects") or []:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("kind") or "other")
        findings.append(
            Finding(
                rule_id=f"review.{kind}",
                severity="blocking" if kind in ("missing-data", "answer-leak") else "warning",
                title=f"Blind solver: {kind.replace('-', ' ')}",
                detail_md=str(item.get("detail") or ""),
                evidence={"kind": kind},
                question_id=q.id,
            )
        )
    for assumption in data.get("assumptions") or []:
        findings.append(
            Finding(
                rule_id="review.assumption",
                severity="warning",
                title="The solver had to guess something the question does not state",
                detail_md=str(assumption),
                question_id=q.id,
            )
        )

    log.info("blind solve for %s: verdict=%s findings=%d", question_id, verdict, len(findings))
    return ReviewOutcome(task="answer-validation", ok=True, data=data, findings=findings)


# ── syllabus auditor ──────────────────────────────────────────────────────────


def _term_evidence(corpus: Corpus, phrases: list[str]) -> list[dict]:
    out: list[dict] = []
    for phrase in phrases[:120]:
        verdict, counts = corpus.classify(phrase)
        out.append({"phrase": phrase, "verdict": verdict, "counts": counts})
    return out


async def audit_scope(
    db: AsyncSession, exam_id: uuid.UUID, candidate_phrases: list[str]
) -> ReviewOutcome:
    """Rule on terminology the deterministic tier could only flag as suspicious.

    `candidate_phrases` comes from the linter — phrases absent from the taught material.
    The model's job is to say which of them are genuine imported terminology and which
    are ordinary composition of taught words, a call counting cannot make.
    """
    exam = await db.get(Exam, exam_id)
    if exam is None:
        raise ValueError("exam not found")
    course, resolution, workshop, brain = await _prepare(db, exam.course_id, "syllabus-audit")
    corpus = await load_corpus(db, exam.course_id)

    rows = list(
        (
            await db.execute(
                select(ExamQuestion)
                .where(ExamQuestion.exam_id == exam_id)
                .order_by(ExamQuestion.position)
            )
        )
        .scalars()
        .all()
    )

    system = _system_for("syllabus-audit", resolution, brain)
    parts: list[str] = [f"# Exam: {exam.title}", ""]

    syllabus = read_syllabus(brain) if brain else None
    if syllabus:
        parts += ["## Course syllabus", "", json.dumps(syllabus, indent=2, ensure_ascii=False)[:4000], ""]

    parts += [
        "## Corpus evidence for candidate phrases",
        "",
        "Counts are occurrences per tier across this course's own material.",
        "",
        json.dumps(_term_evidence(corpus, candidate_phrases), indent=2, ensure_ascii=False)[:12000],
        "",
    ]

    for eq in rows:
        q = await db.get(Question, eq.question_id)
        if q is None:
            continue
        parts += [
            f"## Question {eq.position} [{eq.points} marks]",
            "",
            (q.prompt_md or "")[:4000],
            "",
            "### Answer key",
            "",
            ((q.answer_md or "") + "\n" + (q.worked_solution_md or ""))[:4000],
            "",
        ]

    images: list[str] = []
    data = await _complete(resolution, parts, system, images, 4096)

    findings: list[Finding] = []
    for term in data.get("terms") or []:
        if not isinstance(term, dict) or term.get("verdict") != "imported":
            continue
        severity = str(term.get("severity") or "warning")
        if severity not in ("blocking", "warning", "note"):
            severity = "warning"
        replacement = str(term.get("suggested_replacement") or "").strip()
        findings.append(
            Finding(
                rule_id="review.imported-term",
                severity=severity,  # type: ignore[arg-type]
                title=f"`{term.get('phrase')}` is imported terminology",
                detail_md=str(term.get("reason") or "")
                + (f"\n\nThe course would say: **{replacement}**." if replacement else ""),
                evidence={"phrase": term.get("phrase"), "replacement": replacement},
                auto_fixable=bool(replacement),
            )
        )
    for method in data.get("methods") or []:
        if isinstance(method, dict) and method.get("taught") is False:
            findings.append(
                Finding(
                    rule_id="review.untaught-method",
                    severity="blocking",
                    title=f"The key solves by `{method.get('method')}`, which the course does not teach",
                    detail_md=str(method.get("reason") or ""),
                    evidence={"where": method.get("where_used")},
                )
            )
    for conflict in data.get("symbol_conflicts") or []:
        if isinstance(conflict, dict):
            findings.append(
                Finding(
                    rule_id="review.symbol-conflict",
                    severity="warning",
                    title=(
                        f"`{conflict.get('used')}` is used for {conflict.get('quantity')}, "
                        f"but the course uses `{conflict.get('expected')}`"
                    ),
                    detail_md=str(conflict.get("where") or ""),
                    evidence=conflict,
                )
            )

    log.info("syllabus audit for exam %s: %d findings", exam_id, len(findings))
    return ReviewOutcome(task="syllabus-audit", ok=True, data=data, findings=findings)


# ── examiner ──────────────────────────────────────────────────────────────────


async def examiner_review(db: AsyncSession, exam_id: uuid.UUID) -> ReviewOutcome:
    """Judge the paper as an instrument: difficulty, timing, marks, coverage."""
    exam = await db.get(Exam, exam_id)
    if exam is None:
        raise ValueError("exam not found")
    course, resolution, workshop, brain = await _prepare(db, exam.course_id, "exam-examiner")

    rows = list(
        (
            await db.execute(
                select(ExamQuestion)
                .where(ExamQuestion.exam_id == exam_id)
                .order_by(ExamQuestion.position)
            )
        )
        .scalars()
        .all()
    )

    system = _system_for("exam-examiner", resolution, brain)
    total = sum(eq.points or 0 for eq in rows)
    parts: list[str] = [
        f"# Exam: {exam.title}",
        f"Slot: {exam.total_minutes} minutes. Paper total: {total} marks.",
        "",
    ]
    syllabus = read_syllabus(brain) if brain else None
    if syllabus:
        parts += ["## Course syllabus", "", json.dumps(syllabus, indent=2, ensure_ascii=False)[:3000], ""]

    for eq in rows:
        q = await db.get(Question, eq.question_id)
        if q is None:
            continue
        parts += [
            f"## Question {eq.position} [{eq.points} marks] (chapter {q.chapter_id or '?'})",
            "",
            (q.prompt_md or "")[:4000],
            "",
            "### Answer key",
            "",
            ((q.answer_md or "") + "\n" + (q.worked_solution_md or ""))[:4000],
            "",
        ]

    data = await _complete(resolution, parts, system, [], 4096)

    findings: list[Finding] = []
    by_position = {eq.position: eq for eq in rows}
    proposed_total = 0
    for item in data.get("questions") or []:
        if not isinstance(item, dict):
            continue
        pos = item.get("position")
        proposed = item.get("marks_proposed")
        if isinstance(proposed, int):
            proposed_total += proposed
        eq = by_position.get(pos)
        if eq is not None and isinstance(proposed, int) and proposed != (eq.points or 0):
            findings.append(
                Finding(
                    rule_id="review.mark-allocation",
                    severity="warning",
                    title=f"Q{pos}: examiner proposes {proposed} marks instead of {eq.points}",
                    detail_md=str(item.get("verdict") or ""),
                    evidence={"position": pos, "now": eq.points, "proposed": proposed},
                    question_id=eq.question_id,
                )
            )
        for redundant in item.get("redundant_parts") or []:
            findings.append(
                Finding(
                    rule_id="review.redundant-part",
                    severity="warning",
                    title=f"Q{pos}: a sub-part adds no new work",
                    detail_md=str(redundant),
                    evidence={"position": pos},
                    question_id=eq.question_id if eq else None,
                )
            )

    # The skill is told its re-allocation must total the paper. If it does not, the
    # proposal is unusable and saying so is more useful than passing it on.
    if proposed_total and total and proposed_total != total:
        findings.append(
            Finding(
                rule_id="review.mark-allocation",
                severity="note",
                title=f"The proposed re-allocation totals {proposed_total}, not {total}",
                detail_md="Treat the individual suggestions as advisory; they do not add up.",
                evidence={"proposed_total": proposed_total, "total": total},
            )
        )

    gift = data.get("gift_marks")
    if isinstance(gift, int) and total and gift * 2 >= total:
        findings.append(
            Finding(
                rule_id="review.gift-marks",
                severity="warning",
                title=f"{gift} of {total} marks are obtainable by substitution alone",
                detail_md=str(data.get("summary_md") or "")[:600],
                evidence={"gift_marks": gift, "total": total},
            )
        )

    log.info("examiner review for exam %s: %d findings", exam_id, len(findings))
    return ReviewOutcome(task="exam-examiner", ok=True, data=data, findings=findings)
