"""Memory store — session logs as tagged markdown. Path-parametrized: works on any root."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

DEFAULT_TAXONOMY = """---
name: tag-taxonomy
description: Canonical tag namespaces for AIEA memory. Tag against these; grow deliberately.
---

# Tag taxonomy

AIEA memory uses hierarchical tags — `#namespace/sub/subsub`. Reuse existing
tags wherever possible; add new ones deliberately so retrieval stays reliable.

## Namespaces

- `#topic/...`       — subject matter, e.g. `#topic/thermodynamics/entropy`
- `#task/...`        — which AI task produced this, e.g. `#task/question-generation`
- `#kind/...`        — artifact kind, e.g. `#kind/mcq`, `#kind/mcq/distractors`
- `#difficulty/...`  — `#difficulty/easy` … `#difficulty/hard`
- `#status/...`      — `#status/draft`, `#status/accepted`, `#status/rejected`
- `#date/YYYY/MM/DD` — when, e.g. `#date/2026/05/16`
- `#model/...`       — model that responded, e.g. `#model/claude/opus-4-7`
- `#provider/...`    — provider connection name
- `#course/...`      — course code
"""


def chats_dir(root: Path) -> Path:
    return root / "chats"


def index_dir(root: Path) -> Path:
    return root / "index"


def taxonomy_path(root: Path) -> Path:
    return root / "taxonomy.md"


def init_root(root: Path) -> None:
    """Create the memory layout (chats/, index/, taxonomy.md) if missing."""
    chats_dir(root).mkdir(parents=True, exist_ok=True)
    index_dir(root).mkdir(parents=True, exist_ok=True)
    tp = taxonomy_path(root)
    if not tp.exists():
        tp.write_text(DEFAULT_TAXONOMY, encoding="utf-8")


def _title(text: str, n: int = 70) -> str:
    line = " ".join(text.strip().split())
    if not line:
        return "untitled"
    return f"{line[:n]}…" if len(line) > n else line


def append_exchange(
    root: Path,
    session: str,
    user_text: str,
    assistant_text: str,
    tags: list[str],
    *,
    title: str | None = None,
) -> str:
    """Append one exchange as a `## header` block to chats/<session>.md. Returns the header."""
    init_root(root)
    path = chats_dir(root) / f"{session}.md"
    now = datetime.now(timezone.utc)
    if not path.exists():
        path.write_text(
            f"---\nsession: {session}\ncreated: {now.isoformat(timespec='seconds')}\n---\n",
            encoding="utf-8",
        )
    header = title or _title(user_text)
    tag_line = " ".join(f"#{t}" for t in tags)
    block = (
        f"\n## {header}\n"
        f"_{now.isoformat(timespec='seconds')}_\n\n"
        f"**user:** {user_text.strip()}\n\n"
        f"**assistant:** {assistant_text.strip()}\n\n"
        f"`{tag_line}`\n"
    )
    with path.open("a", encoding="utf-8") as f:
        f.write(block)
    return header
