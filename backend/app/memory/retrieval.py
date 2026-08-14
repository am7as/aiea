"""Memory retrieval — read the tag index, resolve tags to header locations."""
from __future__ import annotations

import json
from pathlib import Path

from app.memory.store import index_dir


def load_index(root: Path) -> dict:
    p = index_dir(root) / "tags.json"
    if not p.exists():
        return {"counts": {}, "tags": {}, "sessions": 0, "headers": 0}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"counts": {}, "tags": {}, "sessions": 0, "headers": 0}


def search(root: Path, tags: list[str]) -> list[dict]:
    """Headers matching any of the given tags, ranked by how many they match."""
    tag_map = load_index(root).get("tags", {})
    hits: dict[tuple[str, str], int] = {}
    for tag in tags:
        for entry in tag_map.get(tag.lower(), []):
            key = (entry["session"], entry["header"])
            hits[key] = hits.get(key, 0) + 1
    ranked = sorted(hits.items(), key=lambda kv: (-kv[1], kv[0]))
    return [{"session": s, "header": h, "matched": n} for (s, h), n in ranked]
