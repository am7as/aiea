"""Read / write the exam plan — per-category question targets for a course.

Kept as <brain>/exam-plan.md with YAML frontmatter, the same Obsidian-native
pattern as the syllabus. The "have" counts are computed live from Question rows.
"""
from __future__ import annotations

from pathlib import Path

import frontmatter

DEFAULT_TOTAL_QUESTIONS = 20
DEFAULT_TOTAL_MINUTES = 120


def exam_plan_path(brain_path: Path) -> Path:
    return brain_path / "exam-plan.md"


def _categories(raw: object) -> list[dict]:
    out: list[dict] = []
    if isinstance(raw, list):
        for c in raw:
            if isinstance(c, dict) and c.get("name"):
                out.append({"name": str(c["name"]), "target": int(c.get("target") or 0)})
    return out


def read_exam_plan(brain_path: Path) -> dict:
    """Return {exists, total_questions, total_minutes, categories:[{name,target}], notes}."""
    path = exam_plan_path(brain_path)
    if not path.is_file():
        return {
            "exists": False,
            "total_questions": DEFAULT_TOTAL_QUESTIONS,
            "total_minutes": DEFAULT_TOTAL_MINUTES,
            "categories": [],
            "notes": "",
        }
    post = frontmatter.load(str(path))
    return {
        "exists": True,
        "total_questions": int(post.get("total_questions") or DEFAULT_TOTAL_QUESTIONS),
        "total_minutes": int(post.get("total_minutes") or DEFAULT_TOTAL_MINUTES),
        "categories": _categories(post.get("categories")),
        "notes": (post.content or "").strip(),
    }


def write_exam_plan(brain_path: Path, plan: dict) -> Path:
    path = exam_plan_path(brain_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    post = frontmatter.Post(
        str(plan.get("notes") or ""),
        total_questions=int(plan.get("total_questions") or DEFAULT_TOTAL_QUESTIONS),
        total_minutes=int(plan.get("total_minutes") or DEFAULT_TOTAL_MINUTES),
        categories=_categories(plan.get("categories")),
    )
    path.write_text(frontmatter.dumps(post), encoding="utf-8")
    return path
