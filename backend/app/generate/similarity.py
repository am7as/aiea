"""Reference-similarity for AI-generated questions.

Picks up to K harvested (reference) questions in the same course that share the
candidate's chapter / category / topics, asks the `question-similarity` task
to pick the closest match and score the deviation, then writes
`closest_reference_id`, `reference_deviation`, `reference_match_note` back to
the Question row. Worker-side; the api only enqueues it.
"""
from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.events import ChatMessage, GenParams
from app.ai.jsonparse import extract_object
from app.ai.router import resolve
from app.db.models import Course, Question
from app.skills.loader import build_skill_prompt
from app.vault.questions import write_question_md

log = logging.getLogger(__name__)

_TOP_K = 6
_STEM_CAP = 1200


def _stem(text: str | None) -> str:
    body = (text or "").strip()
    return body[:_STEM_CAP] + ("…" if len(body) > _STEM_CAP else "")


def _retrieve_reference_pool(rows: list[Question], q: Question) -> list[Question]:
    """Pick up to TOP_K harvested questions ranked by topic affinity."""
    candidates: list[tuple[int, Question]] = []
    q_topics = {t.strip().lower() for t in (q.topics or []) if t}
    q_cat = (q.category or "").strip().lower()
    for r in rows:
        if r.id == q.id or r.origin != "harvested":
            continue
        score = 0
        if q.chapter_id and r.chapter_id == q.chapter_id:
            score += 5
        if q_cat and (r.category or "").strip().lower() == q_cat:
            score += 3
        r_topics = {t.strip().lower() for t in (r.topics or []) if t}
        score += len(q_topics & r_topics)
        if score == 0 and not (q.chapter_id or q_cat or q_topics):
            # No tagging on the candidate — fall through with score 1 so we
            # still surface some references rather than returning nothing.
            score = 1
        if score > 0:
            candidates.append((score, r))
    candidates.sort(key=lambda x: x[0], reverse=True)
    return [r for _, r in candidates[:_TOP_K]]


async def compare_to_references(db: AsyncSession, question_id: uuid.UUID) -> Question:
    """Score how far one question deviates from the course's reference set."""
    q = await db.get(Question, question_id)
    if q is None:
        raise ValueError("question not found")
    course = await db.get(Course, q.course_id)
    if course is None or not course.workshop_path:
        raise ValueError("course workshop_path not configured")
    workshop = Path(course.workshop_path)
    brain = Path(course.brain_path) if course.brain_path else None

    pool_rows = list(
        (
            await db.execute(
                select(Question).where(
                    Question.course_id == q.course_id,
                    Question.origin == "harvested",
                )
            )
        )
        .scalars()
        .all()
    )
    pool = _retrieve_reference_pool(pool_rows, q)
    if not pool:
        q.closest_reference_id = None
        q.reference_deviation = None
        q.reference_match_note = (
            "No harvested questions on this topic to compare against."
        )
        q.vault_path = str(write_question_md(workshop, q, brain))
        await db.commit()
        log.info("similarity: empty reference pool for question %s", question_id)
        return q

    resolution = await resolve(db, "question-similarity")
    if resolution is None:
        raise ValueError("no AI route for question-similarity and no default route")

    system = build_skill_prompt(
        ["question-similarity", "anti-ai-tone"], brain
    )
    if resolution.system_prompt:
        system += "\n\n---\n\n" + resolution.system_prompt
    system += (
        "\n\n---\n\nReturn ONLY a single JSON object — no prose, no fences:\n"
        '{ "closest_reference_id": "<id from References or null>", '
        '"deviation": 0-10, "note": "one or two sentences" }'
    )

    references_payload = [
        {
            "id": str(r.id),
            "chapter_id": r.chapter_id,
            "category": r.category,
            "topics": r.topics,
            "stem": _stem(r.prompt_md),
        }
        for r in pool
    ]
    candidate_payload = {
        "kind": q.kind,
        "chapter_id": q.chapter_id,
        "category": q.category,
        "topics": q.topics,
        "stem": _stem(q.prompt_md),
    }
    user = (
        "## Candidate\n\n```json\n"
        + json.dumps(candidate_payload, ensure_ascii=False, indent=2)
        + "\n```\n\n## References\n\n```json\n"
        + json.dumps(references_payload, ensure_ascii=False, indent=2)
        + "\n```\n\nScore the deviation of the candidate from the references."
    )

    result = await resolution.provider.complete(
        [ChatMessage(role="user", content=user)],
        model=resolution.model,
        system=system,
        params=GenParams(
            temperature=min(resolution.params.temperature, 0.1),
            max_tokens=max(resolution.params.max_tokens, 512),
        ),
    )
    data = extract_object(result.text)

    valid_ids = {str(r.id) for r in pool}
    raw_id = data.get("closest_reference_id")
    closest: uuid.UUID | None = None
    if raw_id is not None:
        as_str = str(raw_id).strip()
        if as_str in valid_ids:
            try:
                closest = uuid.UUID(as_str)
            except ValueError:
                closest = None

    deviation: float | None
    try:
        deviation = max(0.0, min(10.0, float(data.get("deviation"))))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        deviation = None

    q.closest_reference_id = closest
    q.reference_deviation = deviation
    q.reference_match_note = str(data.get("note") or "").strip() or None
    q.vault_path = str(write_question_md(workshop, q, brain))
    await db.commit()
    log.info(
        "similarity for %s — closest=%s deviation=%s",
        question_id, closest, deviation,
    )
    return q
