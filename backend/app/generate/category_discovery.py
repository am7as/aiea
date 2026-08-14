"""Discover per-chapter category lists from the syllabus + observed question data.

Resolves the `category-discovery` task. Builds a small evidence pack per chapter
(existing question categories tagged with that chapter_id; short material
excerpts when available), asks the model for 4-8 categories per chapter, and
writes the result back to `<brain>/syllabus.md`.
"""
from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.events import ChatMessage, GenParams
from app.ai.jsonparse import extract_object
from app.ai.router import resolve
from app.db.models import Course, Material, Question
from app.skills.loader import build_skill_prompt
from app.vault.syllabus import read_syllabus, update_chapter_categories
from app.vault.writer import final_dir

log = logging.getLogger(__name__)

_PER_MATERIAL_CAP = 6_000
_TOTAL_MATERIAL_CAP = 30_000


def _material_excerpt(workshop: Path, m: Material) -> str:
    f = final_dir(workshop, m.id) / "extracted.md"
    text = ""
    if f.exists():
        text = f.read_text(encoding="utf-8")
        if text.startswith("---"):
            end = text.find("\n---", 3)
            if end != -1:
                text = text[end + 4 :]
    if not text.strip():
        text = m.extracted_text or ""
    return text.strip()[:_PER_MATERIAL_CAP]


async def discover_categories(db: AsyncSession, course_id: uuid.UUID) -> dict:
    """Run the AI category-discovery task and persist the result. Returns the
    fresh syllabus payload."""
    course = await db.get(Course, course_id)
    if course is None:
        raise ValueError("course not found")
    if not course.brain_path:
        raise ValueError("course brain_path is not configured")
    brain = Path(course.brain_path)
    workshop = Path(course.workshop_path) if course.workshop_path else None

    syll = read_syllabus(brain)
    if not syll.get("exists"):
        raise ValueError("syllabus.md does not exist — build the course map first")
    chapters = [
        {"id": str(c.get("id")), "title": str(c.get("title") or "")}
        for c in (syll.get("chapters") or [])
        if c.get("id")
    ]
    if not chapters:
        raise ValueError("syllabus has no chapters")

    elos = [
        {
            "id": str(e.get("id")),
            "text": str(e.get("text") or "")[:200],
            "chapters": e.get("chapters") or [],
        }
        for e in (syll.get("elos") or [])
        if e.get("id")
    ]

    # Evidence — categories already in use, grouped by chapter_id.
    rows = await db.execute(
        select(Question.chapter_id, Question.category, func.count())
        .where(Question.course_id == course_id)
        .group_by(Question.chapter_id, Question.category)
    )
    evidence: dict[str, list[dict]] = {}
    unassigned: list[dict] = []
    for cid, cat, n in rows.all():
        if not cat:
            continue
        entry = {"category": cat, "count": int(n)}
        if cid:
            evidence.setdefault(cid, []).append(entry)
        else:
            unassigned.append(entry)

    # Material excerpts — pre-truncated, capped overall.
    materials_block = ""
    if workshop is not None:
        mat_rows = list(
            (
                await db.execute(
                    select(Material).where(
                        Material.course_id == course_id,
                        Material.extraction_status == "done",
                    )
                )
            ).scalars().all()
        )
        chunks: list[str] = []
        total = 0
        for m in mat_rows:
            excerpt = _material_excerpt(workshop, m)
            if not excerpt:
                continue
            block = f"### {m.title or m.original_filename} ({m.collection})\n\n{excerpt}"
            chunks.append(block)
            total += len(block)
            if total >= _TOTAL_MATERIAL_CAP:
                break
        materials_block = "\n\n".join(chunks)

    resolution = await resolve(db, "category-discovery")
    if resolution is None:
        raise ValueError("no AI route for category-discovery and no default route")

    system = build_skill_prompt(["category-discovery", "anti-ai-tone"], brain)
    if resolution.system_prompt:
        system += "\n\n---\n\n" + resolution.system_prompt

    payload = {
        "chapters": chapters,
        "elos": elos,
        "existing_categories_by_chapter": evidence,
        "unassigned_categories": unassigned,
    }
    user = (
        "Propose categories per chapter using the syllabus + the evidence below.\n\n"
        "## Syllabus + evidence\n\n```json\n"
        + json.dumps(payload, indent=2, ensure_ascii=False)
        + "\n```\n"
    )
    if materials_block:
        user += "\n## Material excerpts\n\n" + materials_block

    result = await resolution.provider.complete(
        [ChatMessage(role="user", content=user)],
        model=resolution.model,
        system=system,
        params=GenParams(
            temperature=min(resolution.params.temperature, 0.2),
            max_tokens=max(resolution.params.max_tokens, 2048),
        ),
    )
    data = extract_object(result.text)

    raw = data.get("chapters")
    if not isinstance(raw, list):
        raise ValueError("model did not return a chapters list")

    valid_ids = {c["id"] for c in chapters}
    mapping: dict[str, list[str]] = {}
    for ch in raw:
        if not isinstance(ch, dict):
            continue
        cid = str(ch.get("id") or "").strip()
        if cid not in valid_ids:
            continue
        cats_in = ch.get("categories")
        if not isinstance(cats_in, list):
            continue
        seen: set[str] = set()
        cats: list[str] = []
        for x in cats_in:
            s = str(x).strip()
            if not s or s.lower() in seen:
                continue
            seen.add(s.lower())
            cats.append(s)
        mapping[cid] = cats[:12]

    if not mapping:
        raise ValueError("model returned no usable chapter categories")

    updated = update_chapter_categories(brain, mapping)
    log.info(
        "category-discovery: %d chapter(s) updated for course %s",
        len(mapping), course_id,
    )
    return updated
