from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, status

from app.config import get_settings
from app.memory import index as mem_index
from app.memory import retrieval as mem_retrieval
from app.memory import store as mem_store

router = APIRouter(prefix="/memory", tags=["memory"])


def memory_root() -> Path:
    """Global memory root for now — becomes per-course (<brain>/memory) once courses drive tasks."""
    return get_settings().vault_path / "aiea-memory"


@router.get("/overview")
async def overview():
    root = memory_root()
    idx = mem_retrieval.load_index(root)
    return {
        "root": str(root),
        "sessions": idx.get("sessions", 0),
        "headers": idx.get("headers", 0),
        "tag_count": len(idx.get("counts", {})),
        "generated": idx.get("generated"),
    }


@router.get("/tags")
async def tags():
    return {"counts": mem_retrieval.load_index(memory_root()).get("counts", {})}


@router.get("/sessions")
async def sessions():
    d = mem_store.chats_dir(memory_root())
    if not d.exists():
        return []
    return sorted(p.stem for p in d.glob("*.md"))


@router.get("/sessions/{name}")
async def read_session(name: str):
    if "/" in name or ".." in name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid session name")
    path = mem_store.chats_dir(memory_root()) / f"{name}.md"
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "session not found")
    return {"name": name, "markdown": path.read_text(encoding="utf-8", errors="replace")}


@router.get("/sessions/{name}/exchanges")
async def session_exchanges(name: str):
    if "/" in name or ".." in name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid session name")
    path = mem_store.chats_dir(memory_root()) / f"{name}.md"
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "session not found")
    return mem_index.parse_exchanges(path.read_text(encoding="utf-8", errors="replace"))


@router.get("/search")
async def search(tag: list[str] = Query(default=[])):
    return mem_retrieval.search(memory_root(), tag)


@router.get("/taxonomy")
async def taxonomy():
    root = memory_root()
    mem_store.init_root(root)
    return {"markdown": mem_store.taxonomy_path(root).read_text(encoding="utf-8", errors="replace")}


@router.post("/reindex")
async def reindex():
    return mem_index.reindex(memory_root())
