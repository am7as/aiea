"""Question classifier — tag chapter_id / bloom / category / difficulty on a
question that arrived untagged (typically a harvested question).

Resolves the `question-classification` task, feeds the question stem and the
course's syllabus chapter list to the model, and updates only the fields the
model returns non-null values for. Worker-side; the api only enqueues it.
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
from app.vault.questions import write_question_md
from app.vault.syllabus import read_syllabus

log = logging.getLogger(__name__)

_TASK = """Classify the exam question below against the course syllabus.

Pick the single most-fitting chapter from the syllabus chapter list. Then pick
the category from THAT chapter's `categories` list when one of them fits the
question — only fall back to free-text when the chapter has no list or none of
the listed categories fit. Use the question's existing category as a hint.
Assign Bloom's level and difficulty (1=easiest, 5=hardest) based on the
question itself.

Return ONLY a JSON object — no prose, no code fences:
{
  "chapter_id": "<id from the chapter list, or null if none fits>",
  "bloom": "remember|understand|apply|analyze|evaluate|create" | null,
  "category": "<one of the chapter's categories verbatim, or a new short topic label, or null>",
  "difficulty": 1-5 | null
}
Set any field to null when you cannot decide with confidence. Do not invent a
chapter_id that is not in the list."""


def _bloom_or_none(value: object) -> str | None:
    v = str(value or "").strip().lower()
    return v if v in BLOOM_LEVELS else None


def _difficulty_or_none(value: object) -> int | None:
    try:
        n = int(round(float(value)))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return n if 1 <= n <= 5 else None


async def classify_question(db: AsyncSession, question_id: uuid.UUID) -> Question:
    """Tag a question with chapter_id / bloom / category / difficulty."""
    q = await db.get(Question, question_id)
    if q is None:
        raise ValueError("question not found")
    course = await db.get(Course, q.course_id)
    if course is None or not course.workshop_path:
        raise ValueError("course workshop_path not configured")
    workshop = Path(course.workshop_path)
    brain = Path(course.brain_path) if course.brain_path else None

    resolution = await resolve(db, "question-classification")
    if resolution is None:
        raise ValueError("no AI route for question-classification and no default route")

    chapters: list[dict] = []
    if brain is not None:
        raw = read_syllabus(brain).get("chapters") or []
        for c in raw:
            if isinstance(c, dict) and c.get("id"):
                chapters.append(
                    {
                        "id": str(c["id"]),
                        "title": str(c.get("title") or ""),
                        "categories": [
                            str(x) for x in (c.get("categories") or []) if str(x).strip()
                        ],
                    }
                )

    system = _TASK
    anti = build_skill_prompt(["anti-ai-tone"], brain)
    if anti:
        system += "\n\n---\n\n" + anti
    if resolution.system_prompt:
        system += "\n\n---\n\n" + resolution.system_prompt

    parts = [
        f"Question kind: {q.kind}",
        f"Current category: {q.category or '(none)'}",
        "",
        "## Syllabus chapters",
        "",
        json.dumps(chapters, indent=2) if chapters else "_(no syllabus chapters available)_",
        "",
        "## Question",
        "",
        q.prompt_md or "",
    ]
    if q.distractors:
        parts += ["", "## Options", *[f"- {d}" for d in q.distractors]]

    result = await resolution.provider.complete(
        [ChatMessage(role="user", content="\n".join(parts))],
        model=resolution.model,
        system=system,
        params=GenParams(
            temperature=resolution.params.temperature,
            max_tokens=max(resolution.params.max_tokens, 512),
        ),
    )
    data = extract_object(result.text)

    valid_chapter_ids = {c["id"] for c in chapters}
    chapter_id = data.get("chapter_id")
    if chapter_id is not None:
        cid = str(chapter_id).strip()
        if cid and (not valid_chapter_ids or cid in valid_chapter_ids):
            q.chapter_id = cid

    bloom = _bloom_or_none(data.get("bloom"))
    if bloom is not None:
        q.bloom = bloom

    category = data.get("category")
    if category is not None:
        cat = str(category).strip()
        if cat:
            q.category = cat

    difficulty = _difficulty_or_none(data.get("difficulty"))
    if difficulty is not None:
        q.difficulty = difficulty

    q.vault_path = str(write_question_md(workshop, q, brain))
    await db.commit()
    log.info(
        "classified question %s — chapter=%s bloom=%s category=%s difficulty=%s",
        question_id, q.chapter_id, q.bloom, q.category, q.difficulty,
    )
    return q
