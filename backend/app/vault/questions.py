"""Folder-per-question vault writer.

Each question is its own folder under <workshop>/questions/<category>/<id>/.
Inside live:
  question.md   — frontmatter + prompt + (mcq) options
  answer.md     — answer key + worked solution
  feedback.md   — AI feedback (only when present)
  figures/      — rendered PNGs referenced from any of the above

`Question.vault_path` continues to point at question.md.
Figure markdown links read `![figure](figures/<fig>.png)` — relative to the
question folder, so the same path resolves at exam-render time after the
figures folder is copied into the exam workspace.
"""
from __future__ import annotations

import base64
import json
import re
import shutil
from typing import TYPE_CHECKING
from pathlib import Path

if TYPE_CHECKING:
    from app.db.models import Question


def questions_dir(workshop_path: Path) -> Path:
    return workshop_path / "questions"


# Folder name per origin. The DB stores "ai-generated" — the folder is just
# "generated" so the on-disk tree reads cleanly.
_ORIGIN_FOLDER = {"harvested": "harvested", "ai-generated": "generated"}


def origin_slug(origin: str | None) -> str:
    """Folder-safe slug for a question's origin — 'generated' or 'harvested'."""
    return _ORIGIN_FOLDER.get((origin or "").strip().lower(), "generated")


def category_slug(category: str | None) -> str:
    """Folder-safe slug for a question category — 'uncategorized' when unset."""
    slug = re.sub(r"[^a-z0-9]+", "-", (category or "").strip().lower()).strip("-")
    return slug or "uncategorized"


# Per-brain chapter-slug map cache, keyed by (brain_str, syllabus_mtime).
_CHAPTER_CACHE: dict[tuple[str, float], dict[str, str]] = {}


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def _load_chapter_map(brain_path: Path | None) -> dict[str, str]:
    """Read the course syllabus once per (brain, mtime) and build a
    chapter_id → '<id>-<title>' slug map. Returns {} when no syllabus."""
    if brain_path is None:
        return {}
    syll_md = brain_path / "syllabus.md"
    syll_yml = brain_path / "syllabus.yaml"
    src = syll_md if syll_md.is_file() else syll_yml if syll_yml.is_file() else None
    if src is None:
        return {}
    key = (str(brain_path), src.stat().st_mtime)
    cached = _CHAPTER_CACHE.get(key)
    if cached is not None:
        return cached
    from app.vault.syllabus import read_syllabus

    syll = read_syllabus(brain_path) or {}
    mapping: dict[str, str] = {}
    for c in syll.get("chapters") or []:
        cid = str(c.get("id") or "").strip()
        if not cid:
            continue
        title = str(c.get("title") or "").strip()
        id_slug = _slug(cid)
        title_slug = _slug(title)
        joined = f"{id_slug}-{title_slug}".strip("-") if title_slug else id_slug
        mapping[cid] = (joined or id_slug)[:80] or "unassigned"
    _CHAPTER_CACHE[key] = mapping
    return mapping


def chapter_slug(chapter_id: str | None, brain_path: Path | None = None) -> str:
    """Folder slug for a question's chapter. Falls back to 'unassigned' when
    no chapter is set; uses the syllabus title to enrich the slug when brain
    is available."""
    cid = (chapter_id or "").strip()
    if not cid:
        return "unassigned"
    mapping = _load_chapter_map(brain_path)
    if cid in mapping:
        return mapping[cid]
    return _slug(cid) or "unassigned"


def question_dir(
    workshop_path: Path, q: "Question", brain_path: Path | None = None
) -> Path:
    """<workshop>/questions/<origin>/<chapter>/<category>/<id>/"""
    return (
        questions_dir(workshop_path)
        / origin_slug(q.origin)
        / chapter_slug(q.chapter_id, brain_path)
        / category_slug(q.category)
        / str(q.id)
    )


def question_file(
    workshop_path: Path, q: "Question", brain_path: Path | None = None
) -> Path:
    """The question.md inside the question's folder."""
    return question_dir(workshop_path, q, brain_path) / "question.md"


def answer_file(
    workshop_path: Path, q: "Question", brain_path: Path | None = None
) -> Path:
    return question_dir(workshop_path, q, brain_path) / "answer.md"


def feedback_file(
    workshop_path: Path, q: "Question", brain_path: Path | None = None
) -> Path:
    return question_dir(workshop_path, q, brain_path) / "feedback.md"


def question_figures_dir(
    workshop_path: Path, q: "Question", brain_path: Path | None = None
) -> Path:
    """Rendered figures for a question — under its folder, in figures/."""
    return question_dir(workshop_path, q, brain_path) / "figures"


def question_figure_images(
    workshop_path: Path, q: "Question", brain_path: Path | None = None
) -> list[str]:
    """Base64-encoded PNGs of a question's rendered figures — fed to a vision
    model so the answer-finder / evaluator can see the question's diagrams."""
    fdir = question_figures_dir(workshop_path, q, brain_path)
    if not fdir.is_dir():
        return []
    return [
        base64.b64encode(p.read_bytes()).decode("ascii")
        for p in sorted(fdir.glob("*.png"))
    ]


def _frontmatter(q: "Question") -> list[str]:
    from datetime import datetime, timezone

    last_modified = datetime.now(timezone.utc).isoformat(timespec="seconds")
    return [
        "---",
        f"id: {q.id}",
        f"course_id: {q.course_id}",
        f"category: {q.category or 'null'}",
        f"kind: {q.kind}",
        f"status: {q.status}",
        f"difficulty: {q.difficulty if q.difficulty is not None else 'null'}",
        f"bloom: {q.bloom or 'null'}",
        f"est_minutes: {q.est_minutes if q.est_minutes is not None else 'null'}",
        f"chapter_id: {q.chapter_id or 'null'}",
        f"topics: {json.dumps(list(q.topics or []))}",
        f"elo_ids: {json.dumps(list(q.elo_ids or []))}",
        f"origin: {q.origin or 'ai-generated'}",
        f"created_by: {json.dumps(q.created_by)}",
        f"source_ref: {json.dumps(q.source_ref)}",
        f"source_material_ids: {json.dumps([str(x) for x in (q.source_material_ids or [])])}",
        f"source_pages: {json.dumps(list(q.source_pages or []))}",
        f"eval_correctness: {q.eval_correctness if q.eval_correctness is not None else 'null'}",
        f"eval_clarity: {q.eval_clarity if q.eval_clarity is not None else 'null'}",
        f"needs_human_review: {str(q.needs_human_review).lower()}",
        f"last_modified: {last_modified}",
        "---",
    ]


def render_question_md(q: "Question") -> str:
    """The prompt — frontmatter + question stem + (mcq) distractors + optional SV."""
    body: list[str] = ["## Prompt", "", (q.prompt_md or "").strip() or "_(empty)_"]
    if q.distractors:
        body += ["", "## Distractors", ""]
        body += [f"- {d}" for d in q.distractors]
    sv = getattr(q, "translation_sv", None)
    if sv and sv.strip():
        body += ["", "## Swedish translation", "", sv.strip()]
    return "\n".join(_frontmatter(q)) + "\n\n" + "\n".join(body) + "\n"


def render_answer_md(q: "Question") -> str:
    """The answer file — answer key + worked solution + inline evaluation summary."""
    parts: list[str] = [
        f"# Answer — {q.id}",
        "",
        "## Answer",
        "",
        (q.answer_md or "").strip() or "_(none)_",
    ]
    if q.worked_solution_md and q.worked_solution_md.strip():
        parts += ["", "## Worked solution", "", q.worked_solution_md.strip()]
    if q.evaluation_md and q.evaluation_md.strip():
        parts += ["", "## Evaluation", ""]
        scores = []
        if q.eval_correctness is not None:
            scores.append(f"correctness {q.eval_correctness:g}/10")
        if q.eval_clarity is not None:
            scores.append(f"clarity {q.eval_clarity:g}/10")
        if q.needs_human_review:
            scores.append("needs human review")
        if scores:
            parts += ["_" + " · ".join(scores) + "_", ""]
        parts += [q.evaluation_md.strip()]
    return "\n".join(parts) + "\n"


def render_feedback_md(q: "Question") -> str:
    return f"# Feedback — {q.id}\n\n{(q.feedback_md or '').strip()}\n"


def _remove_legacy_flat_file(workshop_path: Path, q: "Question") -> None:
    """Delete the pre-restructure flat file at <category>/<id>.md if it lingers."""
    legacy = questions_dir(workshop_path) / category_slug(q.category) / f"{q.id}.md"
    try:
        legacy.unlink(missing_ok=True)
    except OSError:
        pass


def _move_existing_question_folder(
    workshop_path: Path, q: "Question", brain_path: Path | None
) -> Path:
    """If the question already lives on disk at a path different from the one
    its current chapter/category/origin imply, MOVE the whole folder to the
    new location. Preserves figures and any other files the user dropped in.

    Returns the target folder path (whether or not a move was needed).
    """
    target = question_dir(workshop_path, q, brain_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    if not q.vault_path:
        return target
    prev = Path(q.vault_path).parent
    # Safety: only ever touch a folder whose leaf name is this question's id.
    if prev == target or not prev.is_dir() or prev.name != str(q.id):
        return target
    if target.exists():
        # Rare — target already populated. Merge file-by-file: anything in the
        # previous folder that's missing at the target gets moved in.
        for src in prev.rglob("*"):
            if src.is_file():
                rel = src.relative_to(prev)
                dest = target / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                if not dest.exists():
                    shutil.move(str(src), str(dest))
        shutil.rmtree(prev, ignore_errors=True)
    else:
        shutil.move(str(prev), str(target))
    return target


def write_question_md(
    workshop_path: Path, q: "Question", brain_path: Path | None = None
) -> Path:
    """Write the question's folder bundle — question.md, answer.md, feedback.md.
    If the question's chapter/category/origin changed since the last write,
    the existing folder is MOVED to the new path first so figures and any
    user-added files survive. Returns the path to question.md."""
    qdir = _move_existing_question_folder(workshop_path, q, brain_path)
    qdir.mkdir(parents=True, exist_ok=True)
    (qdir / "figures").mkdir(exist_ok=True)
    target = qdir / "question.md"
    target.write_text(render_question_md(q), encoding="utf-8")
    (qdir / "answer.md").write_text(render_answer_md(q), encoding="utf-8")
    fb = qdir / "feedback.md"
    if q.feedback_md and q.feedback_md.strip():
        fb.write_text(render_feedback_md(q), encoding="utf-8")
    else:
        try:
            fb.unlink(missing_ok=True)
        except OSError:
            pass
    _remove_legacy_flat_file(workshop_path, q)
    return target
