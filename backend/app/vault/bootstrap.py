from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path


MATERIALS_SUBFOLDERS = ("book", "lectures", "exercises", "exams", "exam-template", "other")
WORKSHOP_SUBFOLDERS = ("extracted", "questions", "exams", "chats", "checklists", "logs")
LIBRARY_SUBFOLDERS = ("question-bank", "exams")
BRAIN_SUBFOLDERS = ("skills", "agents", "hooks", "prompts", "memory")

SCHEMA_VERSION = 1


_README = {
    # materials
    "book": "Drop the main textbook PDF, errata, and reference manuals here.\n",
    "lectures": "Drop lecture slide decks here. PPTX preferred (carries speaker notes); PDF accepted.\n",
    "exercises": "Drop exercise sheets and problem sets here.\n",
    "exams": "Drop past exams here. PDFs, .tex sources, and solution variants (e.g. *_losning.pdf) all welcome.\n",
    "exam-template": (
        "Drop the visual identity of your generated exams here.\n"
        "  - LaTeX:    your .sty file(s) + an instructions.tex / template.tex with the preamble\n"
        "  - Markdown: a template.md with {{title}}, {{instructions}}, {{questions}} placeholders\n"
        "AIEA reads this folder at export time. Nothing in here is ingested as study material.\n"
    ),
    "other": "Drop anything that doesn't fit the other folders: formulas, dictionaries, hand-ins, supplementary references.\n",
    # brain
    "skills": "Course-specific SKILL.md fragments. Merged on top of AIEA's global skills at prompt-build time.\n",
    "agents": "Course-specific agent overrides as <task>.yaml. Pins provider/model/skills for a task.\n",
    "hooks": "Prompt-level hooks: before-generate.md, after-evaluate.md, before-promote.md, etc. Filename = event name.\n",
    "prompts": "Optional system-prompt overrides per task. Rare — use agents instead unless you need raw control.\n",
    "memory": "AIEA's persistent notes about this course. Read + edit them; AIEA appends durable observations here.\n",
}


def _write_course_json(folder_root: Path, role: str, course_id: uuid.UUID, code: str) -> None:
    aiea_dir = folder_root / ".aiea"
    aiea_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "course_id": str(course_id),
        "code": code,
        "role": role,
        "schema_version": SCHEMA_VERSION,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    (aiea_dir / "course.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _scaffold_subfolders(root: Path, names: tuple[str, ...], with_readme: bool) -> None:
    for name in names:
        sub = root / name
        sub.mkdir(parents=True, exist_ok=True)
        if with_readme and name in _README:
            readme = sub / "README.md"
            if not readme.exists():
                readme.write_text(_README[name], encoding="utf-8")


_ROLE_CONFIG: dict[str, tuple[tuple[str, ...], bool]] = {
    "materials": (MATERIALS_SUBFOLDERS, True),
    "brain": (BRAIN_SUBFOLDERS, True),
    "library": (LIBRARY_SUBFOLDERS, False),
    "workshop": (WORKSHOP_SUBFOLDERS, False),
}


def bootstrap_role(
    role: str,
    root: Path,
    course_id: uuid.UUID,
    code: str,
) -> None:
    """Scaffold one role's canonical layout. Idempotent."""
    if role not in _ROLE_CONFIG:
        raise ValueError(f"unknown role: {role}")
    subfolders, with_readme = _ROLE_CONFIG[role]
    root.mkdir(parents=True, exist_ok=True)
    _scaffold_subfolders(root, subfolders, with_readme=with_readme)
    _write_course_json(root, role, course_id, code)


def bootstrap_course_folders(
    course_id: uuid.UUID,
    code: str,
    materials_path: Path,
    brain_path: Path,
    library_path: Path,
    workshop_path: Path,
) -> None:
    """Create the four folder trees for a course. Idempotent."""
    bootstrap_role("materials", materials_path, course_id, code)
    bootstrap_role("brain", brain_path, course_id, code)
    bootstrap_role("library", library_path, course_id, code)
    bootstrap_role("workshop", workshop_path, course_id, code)


def quick_parent_paths_with_subs(parent: Path) -> dict[str, Path]:
    """Same as quick_mode_paths, kept as the canonical name when re-bootstrapping from a parent."""
    return quick_mode_paths(parent)


def quick_mode_paths(parent: Path) -> dict[str, Path]:
    """Given a single parent folder, return the four canonical subpaths inside it."""
    return {
        "materials_path": parent / "materials",
        "brain_path": parent / "brain",
        "library_path": parent / "library",
        "workshop_path": parent / "workshop",
    }
