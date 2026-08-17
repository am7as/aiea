"""Read / write helpers for a course's brain/syllabus.md.

The syllabus is the markdown source of truth for chapters + expected learning
outcomes (ELOs). The DB stays an index; coverage joins question frontmatter
against this file.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import frontmatter
import yaml

SYLLABUS_FILENAME = "syllabus.md"
_STATUS_REL = ".aiea/syllabus.json"


def syllabus_file(brain_path: Path) -> Path:
    return brain_path / SYLLABUS_FILENAME


def _status_file(brain_path: Path) -> Path:
    return brain_path / _STATUS_REL


def write_status(brain_path: Path, status: str, error: str | None = None) -> None:
    """Persist build status — none | building | ready | error."""
    target = _status_file(brain_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(
            {
                "status": status,
                "error": error,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def read_status(brain_path: Path) -> dict:
    target = _status_file(brain_path)
    if not target.exists():
        return {"status": "none", "error": None, "updated_at": None}
    try:
        return json.loads(target.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"status": "none", "error": None, "updated_at": None}


def write_syllabus(brain_path: Path, content: str) -> Path:
    target = syllabus_file(brain_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content if content.endswith("\n") else content + "\n", encoding="utf-8")
    return target


def parse_syllabus(content: str) -> dict:
    """Pull chapters/elos out of the frontmatter; report whether it is well-formed."""
    try:
        post = frontmatter.loads(content)
    except Exception as exc:  # noqa: BLE001
        return {"chapters": [], "elos": [], "body": content, "ok": False, "error": str(exc)}
    meta = post.metadata if isinstance(post.metadata, dict) else {}
    chapters = meta.get("chapters")
    elos = meta.get("elos")
    ok = isinstance(chapters, list) and isinstance(elos, list)
    return {
        "chapters": chapters if isinstance(chapters, list) else [],
        "elos": elos if isinstance(elos, list) else [],
        "body": post.content or "",
        "ok": ok,
        "error": None if ok else "frontmatter is missing a chapters/elos list",
    }


def update_chapter_categories(
    brain_path: Path, mapping: dict[str, list[str]]
) -> dict:
    """Update only the `categories` list on chapters in syllabus.md.

    `mapping` is {chapter_id: [category, ...]}. Chapters not present in the
    mapping are left alone. Returns the freshly-read syllabus payload.
    """
    target = syllabus_file(brain_path)
    if not target.exists():
        raise FileNotFoundError("syllabus.md does not exist; build it first")
    content = target.read_text(encoding="utf-8")
    try:
        post = frontmatter.loads(content)
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"syllabus frontmatter is unparseable: {exc}") from exc
    meta = post.metadata if isinstance(post.metadata, dict) else {}
    chapters = meta.get("chapters")
    if not isinstance(chapters, list):
        raise ValueError("syllabus frontmatter has no chapters list")
    for ch in chapters:
        if not isinstance(ch, dict):
            continue
        cid = str(ch.get("id") or "").strip()
        if cid in mapping:
            cats = [str(c).strip() for c in mapping[cid] if str(c).strip()]
            ch["categories"] = cats
    fm = yaml.safe_dump(meta, sort_keys=False, allow_unicode=True).strip()
    body = post.content or ""
    new_content = f"---\n{fm}\n---\n\n{body}".rstrip() + "\n"
    write_syllabus(brain_path, new_content)
    return read_syllabus(brain_path)


def read_syllabus(brain_path: Path) -> dict:
    """Full state for the API — file content, parsed structure, and build status."""
    status = read_status(brain_path)
    target = syllabus_file(brain_path)
    if not target.exists():
        return {
            "exists": False,
            "content": "",
            "chapters": [],
            "elos": [],
            "body": "",
            "status": status.get("status", "none"),
            "error": status.get("error"),
            "updated_at": status.get("updated_at"),
        }
    content = target.read_text(encoding="utf-8")
    parsed = parse_syllabus(content)
    return {
        "exists": True,
        "content": content,
        "chapters": parsed["chapters"],
        "elos": parsed["elos"],
        "body": parsed["body"],
        "status": status.get("status", "ready"),
        "error": status.get("error") or parsed["error"],
        "updated_at": status.get("updated_at"),
    }
