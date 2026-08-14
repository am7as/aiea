from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import PlainTextResponse

router = APIRouter(prefix="/docs", tags=["docs"])


_FALLBACKS = (Path("/aiea-docs"), Path("/workspace/../docs"), Path("/docs"))


def _docs_root() -> Path:
    """Locate the docs/ folder. AIEA_DOCS_PATH overrides; otherwise try fallbacks."""
    env = os.environ.get("AIEA_DOCS_PATH")
    if env:
        return Path(env)
    for candidate in _FALLBACKS:
        if candidate.exists():
            return candidate
    return _FALLBACKS[0]


def _resolve_inside_docs(rel: str) -> Path:
    root = _docs_root().resolve()
    target = (root / rel).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="path escapes docs root",
        ) from exc
    return target


def _build_tree(folder: Path, root: Path) -> list[dict]:
    entries: list[dict] = []
    for entry in sorted(folder.iterdir(), key=lambda p: (p.is_file(), p.name.lower())):
        if entry.name.startswith("."):
            continue
        rel = str(entry.relative_to(root))
        if entry.is_dir():
            entries.append(
                {
                    "name": entry.name,
                    "path": rel,
                    "type": "folder",
                    "children": _build_tree(entry, root),
                }
            )
        elif entry.suffix.lower() == ".md":
            entries.append(
                {
                    "name": entry.name,
                    "path": rel,
                    "type": "file",
                }
            )
    return entries


@router.get("/tree")
async def docs_tree() -> dict:
    """Return docs/ folder as a tree of folders + .md files."""
    root = _docs_root()
    if not root.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"docs root not found: {root}",
        )
    return {"root": str(root.resolve()), "tree": _build_tree(root, root.resolve())}


@router.get("/file", response_class=PlainTextResponse)
async def docs_file(path: str = Query(..., description="Relative path under docs/")) -> str:
    """Return raw Markdown content for a doc file. Sandboxed to docs root."""
    if not path or path.startswith("/"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="relative path required")
    target = _resolve_inside_docs(path)
    if not target.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"not found: {path}")
    if target.suffix.lower() != ".md":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="only .md files")
    try:
        return target.read_text(encoding="utf-8")
    except OSError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
