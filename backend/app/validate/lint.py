"""Assemble questions from the DB and run the deterministic rules over them.

This is the shared entry point for the ARQ job, the API and the tests — nothing else
should build a `QuestionView` by hand.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.course import Course
from app.db.models.exam import Exam, ExamQuestion
from app.db.models.question import Question
from app.validate.corpus import (
    Corpus,
    load_allowlist,
    load_corpus,
    load_denylist,
    tier_summary,
)
from app.validate.rules import Finding, QuestionView, RuleContext, run_question_rules
from app.vault.questions import question_dir

#: Figure sources whose baked-in text must be scanned. `viscous` and `load line` were
#: burned into a matplotlib legend long after the question text had been cleaned.
_FIGURE_SOURCE_SUFFIXES = (".tex", ".py")


@dataclass
class LintResult:
    findings: list[Finding] = field(default_factory=list)
    corpus_tiers: list[tuple[str, list[str]]] = field(default_factory=list)
    questions_checked: int = 0

    @property
    def blocking(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "blocking"]

    @property
    def warnings(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "warning"]

    @property
    def notes(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "note"]

    @property
    def is_clean(self) -> bool:
        return not self.blocking


def _figure_sources(figure_dir: Path | None) -> dict[str, str]:
    if figure_dir is None or not figure_dir.is_dir():
        return {}
    out: dict[str, str] = {}
    for path in sorted(figure_dir.iterdir()):
        if path.suffix in _FIGURE_SOURCE_SUFFIXES and path.is_file():
            try:
                out[path.name] = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
    return out


def build_view(
    question: Question, workshop: Path, brain: Path | None, points: int | None = None
) -> QuestionView:
    figure_dir = question_dir(workshop, question, brain) / "figures"
    return QuestionView(
        id=question.id,
        prompt_md=question.prompt_md or "",
        answer_md=question.answer_md or "",
        worked_solution_md=question.worked_solution_md or "",
        translation_sv=question.translation_sv or "",
        points=points,
        figure_dir=figure_dir if figure_dir.is_dir() else None,
        figure_sources=_figure_sources(figure_dir if figure_dir.is_dir() else None),
    )


async def build_context(
    db: AsyncSession, course: Course, corpus: Corpus | None = None
) -> RuleContext:
    brain = Path(course.brain_path) if course.brain_path else None
    if corpus is None:
        corpus = await load_corpus(db, course.id)
    return RuleContext(
        corpus=corpus,
        allowlist=load_allowlist(brain),
        denylist=load_denylist(brain),
    )


async def lint_question(
    db: AsyncSession, question_id: uuid.UUID, ctx: RuleContext | None = None
) -> LintResult:
    """Run the deterministic rules over one question."""
    question = await db.get(Question, question_id)
    if question is None:
        raise ValueError("question not found")
    course = await db.get(Course, question.course_id)
    if course is None or not course.workshop_path:
        raise ValueError("course workshop_path is not configured")

    if ctx is None:
        ctx = await build_context(db, course)
    workshop = Path(course.workshop_path)
    brain = Path(course.brain_path) if course.brain_path else None

    # Points are a property of the question's place in an exam, so a standalone lint
    # cannot check mark arithmetic — only the exam-level run can.
    view = build_view(question, workshop, brain, points=None)
    return LintResult(
        findings=run_question_rules(view, ctx),
        corpus_tiers=[(t, names) for t, names in tier_summary(ctx.corpus)] if ctx.corpus else [],
        questions_checked=1,
    )


async def lint_exam(db: AsyncSession, exam_id: uuid.UUID) -> LintResult:
    """Run the deterministic rules over every question in an exam.

    Unlike the per-question path this knows each question's mark allocation, so the
    mark-arithmetic rule can run.
    """
    exam = await db.get(Exam, exam_id)
    if exam is None:
        raise ValueError("exam not found")
    course = await db.get(Course, exam.course_id)
    if course is None or not course.workshop_path:
        raise ValueError("course workshop_path is not configured")

    ctx = await build_context(db, course)
    workshop = Path(course.workshop_path)
    brain = Path(course.brain_path) if course.brain_path else None

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

    findings: list[Finding] = []
    checked = 0
    for eq in rows:
        question = await db.get(Question, eq.question_id)
        if question is None:
            continue
        view = build_view(question, workshop, brain, points=eq.points)
        findings.extend(run_question_rules(view, ctx))
        checked += 1

    return LintResult(
        findings=findings,
        corpus_tiers=[(t, names) for t, names in tier_summary(ctx.corpus)] if ctx.corpus else [],
        questions_checked=checked,
    )
