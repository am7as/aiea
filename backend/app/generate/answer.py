"""Answer-finder — produce a thorough worked solution + answer key for a question.

Resolves the `answer-generation` task, feeds the question (and its rendered
figures) to the model, and writes the worked solution / answer key back to the
Question row and its vault markdown. Worker-side; the api only enqueues it.
"""
from __future__ import annotations

import logging
import uuid
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.events import ChatMessage, GenParams
from app.ai.jsonparse import extract_object
from app.ai.router import resolve
from app.db.models import Course, Question
from app.vault.questions import question_figure_images, write_question_md

log = logging.getLogger(__name__)

_SYSTEM = """You are an exam-answer author. Given one exam question, solve it
completely and produce a model answer.

Work the problem step by step. If the question includes figures, use them. Be
faithful to the question exactly as written — do not invent missing data.

Return ONLY a JSON object — no prose, no code fences:
{
  "worked_solution_md": "the full step-by-step solution in markdown, LaTeX as $...$",
  "answer_md": "the concise final answer / answer key",
  "distractors": ["a plausible wrong option", "..."]
}
`distractors` is only for mcq / true_false questions — otherwise [].
For non-problem / non-code questions `worked_solution_md` may be a brief justification."""


async def find_answer(db: AsyncSession, question_id: uuid.UUID) -> Question:
    """Produce / refine the worked solution + answer key for one question."""
    q = await db.get(Question, question_id)
    if q is None:
        raise ValueError("question not found")
    course = await db.get(Course, q.course_id)
    if course is None or not course.workshop_path:
        raise ValueError("course workshop_path not configured")
    workshop = Path(course.workshop_path)
    brain = Path(course.brain_path) if course.brain_path else None

    resolution = await resolve(db, "answer-generation")
    if resolution is None:
        raise ValueError("no AI route for answer-generation and no default route")

    parts = [f"Question kind: {q.kind}", "", "## Question", "", q.prompt_md]
    if q.distractors:
        parts += ["", "## Options", *[f"- {d}" for d in q.distractors]]
    images = question_figure_images(workshop, q, brain)

    result = await resolution.provider.complete(
        [ChatMessage(role="user", content="\n".join(parts), images=images)],
        model=resolution.model,
        system=_SYSTEM,
        params=GenParams(
            temperature=resolution.params.temperature,
            max_tokens=max(resolution.params.max_tokens, 2048),
        ),
    )
    data = extract_object(result.text)

    worked = str(data.get("worked_solution_md") or "").strip()
    answer = str(data.get("answer_md") or "").strip()
    if worked:
        q.worked_solution_md = worked
    if answer:
        q.answer_md = answer
    if q.kind in ("mcq", "true_false") and data.get("distractors"):
        q.distractors = [str(d) for d in data["distractors"]]
    q.vault_path = str(write_question_md(workshop, q, brain))
    await db.commit()
    log.info("answered question %s", question_id)
    return q
