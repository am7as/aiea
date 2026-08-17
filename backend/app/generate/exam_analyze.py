"""Exam analyser — coverage / difficulty / gap analysis of one assembled exam.

Computes deterministic stats client-side first (difficulty_profile, category_mix,
overall_difficulty as a points-weighted average), then feeds the exam + stats +
(optionally) the selected materials' final-extracted text to the model and asks
for a short markdown critique with two concrete swap suggestions. Synchronous —
the api calls it directly, no queue.
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
from app.db.models import Course, Exam, ExamQuestion, Material, Question
from app.skills.loader import build_skill_prompt
from app.vault.writer import final_dir, version_dir

log = logging.getLogger(__name__)

_PER_MATERIAL_CAP = 12_000
_MATERIALS_TOTAL_CAP = 60_000

_TASK = """Analyse the exam below.

You are given:
- the exam title and per-question metadata (kind, points, difficulty, category, prompt)
- computed statistics (difficulty profile, category mix, points-weighted overall difficulty)
- (optionally) extracted text from the course materials this exam draws on

Write a concise markdown critique covering:
- coverage — what the exam tests well and what it misses against the materials
- difficulty curve — is it well-paced, front-loaded, flat?
- gaps — categories or chapters under-represented or absent
- two concrete swap suggestions — name the slot and what would fit better

Return ONLY a JSON object — no prose, no code fences:
{
  "feedback_md": "markdown — the critique"
}
Be direct. No preamble."""


def _read_extracted_text(workshop: Path, material_id: uuid.UUID) -> str:
    for f in (
        final_dir(workshop, material_id) / "extracted.md",
        version_dir(workshop, material_id, "ai") / "extracted.md",
    ):
        if f.exists():
            text = f.read_text(encoding="utf-8")
            if text.startswith("---"):
                end = text.find("\n---", 3)
                if end != -1:
                    text = text[end + 4 :]
            if text.strip():
                return text.strip()
    return ""


def _compute_stats(rows: list[tuple[ExamQuestion, Question]]) -> dict:
    profile: dict[str, int] = {f"D{i}": 0 for i in range(1, 6)}
    cat_counts: dict[str, int] = {}
    points_sum = 0
    weighted = 0.0
    for er, q in rows:
        if q.difficulty is not None and 1 <= int(q.difficulty) <= 5:
            profile[f"D{int(q.difficulty)}"] += 1
            points_sum += er.points
            weighted += float(q.difficulty) * float(er.points)
        cat = (er.category or q.category or "uncategorized")
        cat_counts[cat] = cat_counts.get(cat, 0) + 1
    overall = round(weighted / points_sum, 1) if points_sum > 0 else 0.0
    category_mix = [
        {"name": k, "count": v}
        for k, v in sorted(cat_counts.items(), key=lambda kv: (-kv[1], kv[0]))
    ]
    return {
        "difficulty_profile": profile,
        "category_mix": category_mix,
        "overall_difficulty": overall,
    }


async def analyze_exam(
    db: AsyncSession,
    exam_id: uuid.UUID,
    material_ids: list[uuid.UUID] | None,
) -> dict:
    """Analyse an exam — coverage, difficulty curve, gaps, swap suggestions."""
    exam = await db.get(Exam, exam_id)
    if exam is None:
        raise ValueError("exam not found")
    course = await db.get(Course, exam.course_id)
    if course is None:
        raise ValueError("exam has no course")
    workshop = Path(course.workshop_path) if course.workshop_path else None
    brain = Path(course.brain_path) if course.brain_path else None

    eq_rows = list(
        (
            await db.execute(
                select(ExamQuestion)
                .where(ExamQuestion.exam_id == exam_id)
                .order_by(ExamQuestion.position)
            )
        ).scalars().all()
    )
    q_by_id: dict[uuid.UUID, Question] = {}
    if eq_rows:
        q_by_id = {
            q.id: q
            for q in (
                await db.execute(
                    select(Question).where(Question.id.in_([r.question_id for r in eq_rows]))
                )
            ).scalars().all()
        }
    pairs: list[tuple[ExamQuestion, Question]] = [
        (r, q_by_id[r.question_id]) for r in eq_rows if r.question_id in q_by_id
    ]

    stats = _compute_stats(pairs)

    resolution = await resolve(db, "exam-analysis")
    if resolution is None:
        raise ValueError("no AI route for exam-analysis and no default route")

    system = _TASK
    anti = build_skill_prompt(["anti-ai-tone"], brain)
    if anti:
        system += "\n\n---\n\n" + anti
    if resolution.system_prompt:
        system += "\n\n---\n\n" + resolution.system_prompt

    questions_payload = [
        {
            "position": r.position,
            "points": r.points,
            "category": r.category or q.category,
            "kind": q.kind,
            "difficulty": q.difficulty,
            "bloom": q.bloom,
            "prompt_md": (q.prompt_md or "").strip(),
        }
        for r, q in pairs
    ]

    parts = [
        f"# Exam: {exam.title}",
        f"Total minutes: {exam.total_minutes}",
        "",
        "## Computed statistics",
        "",
        json.dumps(stats, indent=2),
        "",
        "## Questions",
        "",
        json.dumps(questions_payload, indent=2),
    ]

    if material_ids and workshop is not None:
        mats = list(
            (
                await db.execute(
                    select(Material).where(
                        Material.course_id == exam.course_id,
                        Material.id.in_(material_ids),
                    )
                )
            ).scalars().all()
        )
        chunks: list[str] = []
        used = 0
        for m in mats:
            text = _read_extracted_text(workshop, m.id)
            if not text:
                text = (m.extracted_text or "").strip()
            if not text:
                continue
            snippet = text[:_PER_MATERIAL_CAP]
            remaining = _MATERIALS_TOTAL_CAP - used
            if remaining <= 0:
                break
            snippet = snippet[:remaining]
            chunks.append(
                f"=== {m.title or m.original_filename} ({m.collection}) ===\n\n{snippet}"
            )
            used += len(snippet)
        if chunks:
            parts += ["", "## Source materials", "", "\n\n".join(chunks)]

    result = await resolution.provider.complete(
        [ChatMessage(role="user", content="\n".join(parts))],
        model=resolution.model,
        system=system,
        params=GenParams(
            temperature=resolution.params.temperature,
            max_tokens=max(resolution.params.max_tokens, 2048),
        ),
    )
    data = extract_object(result.text)
    feedback_md = str(data.get("feedback_md") or "").strip()

    log.info("analysed exam %s (%d questions, %d cats)", exam_id, len(pairs), len(stats["category_mix"]))
    return {
        "exam_id": str(exam_id),
        "overall_difficulty": stats["overall_difficulty"],
        "difficulty_profile": stats["difficulty_profile"],
        "category_mix": stats["category_mix"],
        "feedback_md": feedback_md,
    }
