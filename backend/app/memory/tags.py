from __future__ import annotations

import re

# Hierarchical tags — #namespace/sub/subsub
_TAG_RE = re.compile(r"#([a-z0-9][a-z0-9/_-]*)", re.IGNORECASE)
_SLUG_RE = re.compile(r"[^a-z0-9]+")


def extract_tags(text: str) -> list[str]:
    """Pull #hierarchical/tags from markdown, deduped, lowercased, order-preserving."""
    seen: dict[str, None] = {}
    for m in _TAG_RE.finditer(text):
        tag = m.group(1).strip("/").lower()
        if tag:
            seen.setdefault(tag, None)
    return list(seen)


def slugify(text: str) -> str:
    """Lowercase, hyphenate — safe for a tag segment or a session-file name."""
    return _SLUG_RE.sub("-", text.strip().lower()).strip("-") or "untitled"
