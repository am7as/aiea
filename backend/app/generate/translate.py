"""Bilingual translation for exam rendering.

Resolves the `translate` task and produces a Swedish version of one question's
prompt markdown. Math, code, tables and figure links are preserved verbatim;
only prose is translated. The result is cached on Question.translation_sv so
each question is translated at most once. Worker-side; the api never calls it
directly.
"""
from __future__ import annotations

import logging
import re
import uuid
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.events import ChatMessage, GenParams
from app.ai.router import resolve
from app.db.models import Course, Question
from app.skills.loader import build_skill_prompt

log = logging.getLogger(__name__)

_FENCES = re.compile(r"^```|^~~~", re.MULTILINE)


def _looks_bilingual(text: str) -> bool:
    """Heuristic: harvested reference questions often already contain a Swedish
    block. Skip them rather than double-translating."""
    if not text:
        return False
    sv_markers = (
        " och ",
        "Visa att",
        "Beräkna",
        "Härled",
        "Skissa",
        "Förklara",
        "vippa",
        "kretsschema",
        "spänning",
    )
    return any(m in text for m in sv_markers)


async def translate_question_sv(
    db: AsyncSession, question_id: uuid.UUID, *, refresh: bool = False
) -> str:
    """Return the Swedish translation of a question's prompt markdown, caching
    it on the Question row. Returns "" when no route is available — callers
    treat that as "skip the SV block in the rendered exam"."""
    q = await db.get(Question, question_id)
    if q is None:
        raise ValueError("question not found")
    if q.translation_sv and not refresh:
        return q.translation_sv
    if _looks_bilingual(q.prompt_md or "") and not refresh:
        q.translation_sv = ""
        await db.commit()
        return ""

    course = await db.get(Course, q.course_id)
    brain = Path(course.brain_path) if course and course.brain_path else None

    resolution = await resolve(db, "translate")
    if resolution is None:
        log.info("no translate route — skipping SV translation for %s", question_id)
        return ""

    system = build_skill_prompt(["translate", "anti-ai-tone"], brain)
    if resolution.system_prompt:
        system += "\n\n---\n\n" + resolution.system_prompt
    system += (
        "\n\n---\n\n"
        "Translate the question below from English to Swedish. Return ONLY the "
        "translated markdown body — no preamble, no commentary, no code fences "
        "wrapping the result."
    )

    user = q.prompt_md or ""

    result = await resolution.provider.complete(
        [ChatMessage(role="user", content=user)],
        model=resolution.model,
        system=system,
        params=GenParams(
            temperature=min(resolution.params.temperature, 0.2),
            max_tokens=max(resolution.params.max_tokens, 2048),
        ),
    )
    translated = (result.text or "").strip()
    # Some providers wrap output in a single fenced block — strip the outer fence.
    if translated.startswith("```") and translated.endswith("```"):
        inner = translated[3:-3]
        nl = inner.find("\n")
        if nl >= 0:
            inner = inner[nl + 1 :]
        translated = inner.strip()

    q.translation_sv = translated
    await db.commit()
    log.info("translated question %s to SV (%d chars)", question_id, len(translated))
    return translated
