"""Question feedback — a concise human-style critique of one question.

Resolves the `question-feedback` task, feeds the question stem, answer key,
worked solution, prior evaluation and any rendered figures to the model, and
asks for a short markdown critique (well-posed? answers agree? difficulty right?
one concrete improvement). Writes the result to Question.feedback_md and to the
vault markdown. Worker-side; the api only enqueues it.
"""
from __future__ import annotations

import logging
import uuid
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.events import ChatMessage, GenParams
from app.ai.jsonparse import extract_object
from app.ai.providers.agent import AgentProvider
from app.ai.router import resolve
from app.db.models import Course, Question
from app.skills.loader import build_skill_prompt
from app.vault.questions import question_figure_images, write_question_md

log = logging.getLogger(__name__)

_TASK = """Critique the exam question below.

Address four points in 4-8 sentences total:
1. Is the question well-posed and unambiguous?
2. Do the answer key and worked solution agree, and are they correct?
3. Is the difficulty rating right for what the question actually demands?
4. One concrete improvement the examiner should make.

Return ONLY a JSON object — no prose, no code fences:
{
  "feedback_md": "markdown — the critique, written for the examiner"
}
Be direct. No preamble, no recap of the question."""


async def submit_feedback(db: AsyncSession, question_id: uuid.UUID) -> Question:
    """Produce a short human-style critique of one question."""
    q = await db.get(Question, question_id)
    if q is None:
        raise ValueError("question not found")
    course = await db.get(Course, q.course_id)
    if course is None or not course.workshop_path:
        raise ValueError("course workshop_path not configured")
    workshop = Path(course.workshop_path)
    brain = Path(course.brain_path) if course.brain_path else None

    resolution = await resolve(db, "question-feedback")
    if resolution is None:
        raise ValueError("no AI route for question-feedback and no default route")

    system = _TASK
    anti = build_skill_prompt(["anti-ai-tone"], brain)
    if anti:
        system += "\n\n---\n\n" + anti
    if resolution.system_prompt:
        system += "\n\n---\n\n" + resolution.system_prompt

    parts = [f"Question kind: {q.kind}", "", "## Question", "", q.prompt_md or ""]
    if q.distractors:
        parts += ["", "## Options", *[f"- {d}" for d in q.distractors]]
    parts += ["", "## Answer key", "", q.answer_md or "_(none)_"]
    if q.worked_solution_md:
        parts += ["", "## Worked solution", "", q.worked_solution_md]
    if q.evaluation_md:
        parts += ["", "## Prior evaluation", "", q.evaluation_md]
    if q.difficulty is not None:
        parts += ["", f"Current difficulty rating: {q.difficulty}/5"]

    images: list[str] = []
    if not isinstance(resolution.provider, AgentProvider):
        images = question_figure_images(workshop, q, brain)

    result = await resolution.provider.complete(
        [ChatMessage(role="user", content="\n".join(parts), images=images)],
        model=resolution.model,
        system=system,
        params=GenParams(
            temperature=resolution.params.temperature,
            max_tokens=max(resolution.params.max_tokens, 1024),
        ),
    )
    data = extract_object(result.text)

    feedback = str(data.get("feedback_md") or "").strip()
    if feedback:
        q.feedback_md = feedback
    q.vault_path = str(write_question_md(workshop, q, brain))
    await db.commit()
    log.info("feedback for question %s written (%d chars)", question_id, len(feedback))
    return q
