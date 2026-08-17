from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, status

router = APIRouter(prefix="/fs", tags=["fs"])


def _allowed_roots() -> list[Path]:
    """Roots the folder browser is allowed to traverse.

    Read from AIEA_ALLOWED_ROOTS (colon-separated) when set; otherwise fall
    back to AIEA_HOST_HOME, otherwise the container's $HOME. Keeping the
    surface narrow avoids exposing the entire host home directory and keeps
    Docker's file-watcher load light.
    """
    roots: list[Path] = []
    raw = os.environ.get("AIEA_ALLOWED_ROOTS")
    if raw:
        for part in raw.split(":"):
            p = part.strip()
            if p:
                roots.append(Path(p))
    elif (home := os.environ.get("AIEA_HOST_HOME")):
        roots.append(Path(home))
    if not roots:
        roots.append(Path.home())
    return roots


def _is_inside_allowed(path: Path) -> bool:
    try:
        resolved = path.resolve()
    except OSError:
        return False
    for root in _allowed_roots():
        try:
            resolved.relative_to(root.resolve())
            return True
        except ValueError:
            continue
    return False


@router.get("/roots")
async def fs_roots() -> dict:
    """Return the allowed root path(s) for the folder browser."""
    roots = [str(r) for r in _allowed_roots()]
    return {"roots": roots, "default": roots[0] if roots else "/"}


@router.get("/list")
async def fs_list(
    path: str = Query(..., description="Absolute path to list (must be inside an allowed root)"),
    show_hidden: bool = Query(False, description="Include dotfiles / hidden folders"),
) -> dict:
    """List subdirectories (and a sample of files) inside a folder.

    Used by the folder-picker UI. Sandboxed to the user's home directory.
    """
    target = Path(path).expanduser()
    if not target.is_absolute():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Path must be absolute")
    if not _is_inside_allowed(target):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Path outside allowed roots: {target}",
        )
    if not target.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Path does not exist: {target}"
        )
    if not target.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=f"Path is not a directory: {target}"
        )

    folders: list[dict] = []
    files: list[dict] = []
    try:
        for entry in sorted(target.iterdir(), key=lambda p: p.name.lower()):
            if not show_hidden and entry.name.startswith("."):
                continue
            if entry.name.startswith("~$"):
                continue
            try:
                is_dir = entry.is_dir()
            except OSError:
                continue
            if is_dir:
                folders.append({"name": entry.name, "path": str(entry)})
            else:
                try:
                    size = entry.stat().st_size
                except OSError:
                    size = 0
                files.append({"name": entry.name, "size": size})
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Permission denied: {target}",
        ) from exc

    resolved = target.resolve()
    parent: str | None = str(resolved.parent) if _is_inside_allowed(resolved.parent) and resolved.parent != resolved else None

    return {
        "path": str(resolved),
        "parent": parent,
        "folders": folders,
        "files": files[:50],
        "file_count": len(files),
    }


@router.get("/preview-parent")
async def preview_parent(
    path: str = Query(..., description="Absolute parent path to preview"),
) -> dict:
    """Look at <parent>/{materials,brain,library,workshop} and report what's there.

    Used by the dashboard's 'Set up from one parent' modal to decide whether to
    connect to existing folders, scaffold from scratch, or a mix.
    """
    target = Path(path).expanduser()
    if not target.is_absolute():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Path must be absolute")
    if not _is_inside_allowed(target):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Path outside allowed roots: {target}",
        )

    out: dict = {"parent": str(target.resolve()), "exists": target.exists(), "subfolders": {}}
    for role in ("materials", "brain", "library", "workshop"):
        sub = target / role
        entry: dict = {"path": str(sub), "exists": sub.is_dir()}
        if entry["exists"]:
            file_count = 0
            subfolders_present: list[str] = []
            try:
                for child in sub.iterdir():
                    if child.is_file() and not child.name.startswith("."):
                        file_count += 1
                    elif child.is_dir() and not child.name.startswith("."):
                        # count files in nested canonical-style subfolders too
                        subfolders_present.append(child.name)
                        try:
                            for sub_entry in child.rglob("*"):
                                if sub_entry.is_file() and not sub_entry.name.startswith("."):
                                    file_count += 1
                        except OSError:
                            pass
            except OSError:
                pass
            entry["file_count"] = file_count
            entry["subfolders"] = sorted(subfolders_present)
        out["subfolders"][role] = entry
    return out


@router.post("/mkdir")
async def fs_mkdir(payload: dict) -> dict:
    """Create a directory (including parents). Sandboxed."""
    raw = payload.get("path")
    if not isinstance(raw, str) or not raw:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing 'path'")
    target = Path(raw).expanduser()
    if not target.is_absolute():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Path must be absolute")
    if not _is_inside_allowed(target):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Path outside allowed roots: {target}",
        )
    try:
        target.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not create directory: {exc}",
        ) from exc
    return {"path": str(target.resolve()), "created": True}
