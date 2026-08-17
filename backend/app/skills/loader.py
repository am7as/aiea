"""Runtime-skill loader.

Runtime skills are SKILL.md files (YAML frontmatter + markdown body) consumed
by the AI engine as system-prompt fragments. Two sources, brain wins:

- global:      backend/skills/<name>/SKILL.md
- per-course:  <brain>/skills/<name>/SKILL.md
"""
from __future__ import annotations

from pathlib import Path

import frontmatter

GLOBAL_SKILLS_ROOT = Path(__file__).resolve().parents[2] / "skills"


def _read(skill_md: Path) -> dict | None:
    if not skill_md.is_file():
        return None
    try:
        post = frontmatter.loads(skill_md.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None
    meta = post.metadata if isinstance(post.metadata, dict) else {}
    return {
        "name": str(meta.get("name") or skill_md.parent.name),
        "description": str(meta.get("description") or ""),
        "body": (post.content or "").strip(),
    }


def load_skill(name: str, brain_path: Path | None = None) -> dict | None:
    """Per-course override wins over the global skill of the same name."""
    candidates: list[tuple[str, Path]] = []
    if brain_path is not None:
        candidates.append(("course", brain_path / "skills" / name / "SKILL.md"))
    candidates.append(("global", GLOBAL_SKILLS_ROOT / name / "SKILL.md"))
    for source, f in candidates:
        skill = _read(f)
        if skill is not None:
            skill["source"] = source
            return skill
    return None


def list_skills(brain_path: Path | None = None) -> list[dict]:
    """Every available skill, brain overrides shadowing globals by name."""
    seen: dict[str, dict] = {}
    roots: list[tuple[str, Path]] = [("global", GLOBAL_SKILLS_ROOT)]
    if brain_path is not None:
        roots.append(("course", brain_path / "skills"))
    for source, root in roots:
        if not root.is_dir():
            continue
        for child in sorted(root.iterdir()):
            skill = _read(child / "SKILL.md")
            if skill is None:
                continue
            skill["source"] = source
            seen[skill["name"]] = skill
    return list(seen.values())


def build_skill_prompt(names: list[str], brain_path: Path | None = None) -> str:
    """Concatenate the bodies of the named skills into one prompt fragment."""
    blocks: list[str] = []
    for name in names:
        skill = load_skill(name, brain_path)
        if skill and skill["body"]:
            blocks.append(skill["body"])
    return "\n\n---\n\n".join(blocks)
