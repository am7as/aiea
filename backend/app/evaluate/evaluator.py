"""Question evaluator — independently solve a question to check its answer key,
score correctness / clarity, assess difficulty / Bloom / solve-time, and judge
how well the question aligns with the course's declared scope.

Resolves the `question-evaluation` task, applies the difficulty-rubric and
bloom-taxonomy skills, and writes the verdict back to the Question row + its
vault markdown. Worker-side; the api only enqueues it.
"""
from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.events import ChatMessage, GenParams
from app.ai.jsonparse import extract_object
from app.ai.router import resolve
from app.db.models import Course, Question
from app.db.models.question import BLOOM_LEVELS
from app.skills.loader import build_skill_prompt
from app.vault.questions import question_figure_images, write_question_md
from app.vault.syllabus import read_syllabus

log = logging.getLogger(__name__)

_EVAL_SKILLS = ["difficulty-rubric", "bloom-taxonomy"]

_TASK = """Evaluate the exam question below.

First solve it yourself, independently, from its statement and any figures.
Then judge it, applying the difficulty-rubric and bloom-taxonomy skills above.
You are also given the course syllabus (chapters and expected learning outcomes).
Use it to decide how well the question fits the course's declared scope.

Return ONLY a JSON object — no prose, no code fences:
{
  "eval_correctness": 0-10,   // is the answer key correct and the question well-posed
  "eval_clarity": 0-10,       // unambiguous, exactly one defensible answer
  "difficulty": 1-5,
  "bloom": "remember|understand|apply|analyze|evaluate|create",
  "est_minutes": <integer>,
  "scope_alignment": 0-10,    // 10 = clearly within a syllabus chapter/ELO,
                              //  5 = adjacent but not a primary topic,
                              //  0 = off-topic for this course
  "off_topic_reason": "<one or two sentences; empty string if scope_alignment >= 7>",
  "needs_human_review": true|false,
  "evaluation_md": "markdown: your independent solution, whether it matches the
                    answer key, any flaws found, and the rationale for the scores"
}
Set needs_human_review true when the answer key looks wrong, the question is
ambiguous, off-topic for the course, or you could not solve it confidently."""


def _num(value: object, lo: float, hi: float) -> float | None:
    try:
        return max(lo, min(hi, float(value)))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _syllabus_block(brain: Path | None) -> str:
    """Return a compact JSON snapshot of chapters + ELOs for the evaluator.
    Empty when the course has no syllabus."""
    if brain is None:
        return ""
    syll = read_syllabus(brain)
    if not syll or not syll.get("exists"):
        return ""
    chapters = [
        {"id": str(c.get("id")), "title": str(c.get("title") or "")}
        for c in (syll.get("chapters") or [])
        if c.get("id")
    ]
    elos = [
        {
            "id": str(e.get("id")),
            "text": str(e.get("text") or "")[:200],
            "bloom": str(e.get("bloom") or ""),
        }
        for e in (syll.get("elos") or [])
        if e.get("id")
    ]
    if not chapters and not elos:
        return ""
    return json.dumps(
        {"chapters": chapters, "elos": elos}, indent=2, ensure_ascii=False
    )


async def evaluate_question(db: AsyncSession, question_id: uuid.UUID) -> Question:
    """Independently solve, score and classify one question."""
    q = await db.get(Question, question_id)
    if q is None:
        raise ValueError("question not found")
    course = await db.get(Course, q.course_id)
    if course is None or not course.workshop_path:
        raise ValueError("course workshop_path not configured")
    workshop = Path(course.workshop_path)
    brain = Path(course.brain_path) if course.brain_path else None

    resolution = await resolve(db, "question-evaluation")
    if resolution is None:
        raise ValueError("no AI route for question-evaluation and no default route")

    system = build_skill_prompt(resolution.active_skills or _EVAL_SKILLS, brain)
    system += "\n\n---\n\n" + _TASK

    syll_block = _syllabus_block(brain)

    parts = [f"Question kind: {q.kind}"]
    if syll_block:
        parts += ["", "## Course syllabus", "", syll_block]
    parts += ["", "## Question", "", q.prompt_md]
    if q.distractors:
        parts += ["", "## Options", *[f"- {d}" for d in q.distractors]]
    parts += ["", "## Proposed answer key", "", q.answer_md or "_(none)_"]
    if q.worked_solution_md:
        parts += ["", "## Proposed worked solution", "", q.worked_solution_md]
    images = question_figure_images(workshop, q, brain)

    result = await resolution.provider.complete(
        [ChatMessage(role="user", content="\n".join(parts), images=images)],
        model=resolution.model,
        system=system,
        params=GenParams(
            temperature=resolution.params.temperature,
            max_tokens=max(resolution.params.max_tokens, 2048),
        ),
    )
    data = extract_object(result.text)

    q.eval_correctness = _num(data.get("eval_correctness"), 0, 10)
    q.eval_clarity = _num(data.get("eval_clarity"), 0, 10)
    difficulty = _num(data.get("difficulty"), 1, 5)
    if difficulty is not None:
        q.difficulty = int(round(difficulty))
    bloom = str(data.get("bloom") or "").strip().lower()
    if bloom in BLOOM_LEVELS:
        q.bloom = bloom
    est = _num(data.get("est_minutes"), 0, 600)
    if est is not None:
        q.est_minutes = int(round(est))
    q.evaluation_md = str(data.get("evaluation_md") or "").strip() or None
    q.scope_alignment = _num(data.get("scope_alignment"), 0, 10)
    off_topic = str(data.get("off_topic_reason") or "").strip()
    q.off_topic_reason = off_topic or None
    q.needs_human_review = bool(data.get("needs_human_review"))
    if not q.needs_human_review:
        q.status = "ready"

    q.vault_path = str(write_question_md(workshop, q, brain))
    await db.commit()
    log.info(
        "evaluated question %s — correctness=%s clarity=%s review=%s",
        question_id, q.eval_correctness, q.eval_clarity, q.needs_human_review,
    )
    return q
