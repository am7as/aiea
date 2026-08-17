from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from app.vault.bootstrap import (
    BRAIN_SUBFOLDERS,
    LIBRARY_SUBFOLDERS,
    MATERIALS_SUBFOLDERS,
    WORKSHOP_SUBFOLDERS,
)

_IGNORE_PREFIXES = ("~$", ".")
_IGNORE_NAMES = {"Thumbs.db", "desktop.ini", ".DS_Store"}
_IGNORE_SUFFIXES = (".tmp", ".swp", ".part")


@dataclass(slots=True)
class FileEntry:
    name: str
    relpath: str
    size: int
    mtime: str
    ext: str


@dataclass(slots=True)
class Section:
    name: str
    count: int = 0
    files: list[FileEntry] = field(default_factory=list)


@dataclass(slots=True)
class RoleSnapshot:
    role: str
    path: str | None
    exists: bool
    sections: list[Section]


def _is_ignored(name: str) -> bool:
    if name in _IGNORE_NAMES:
        return True
    if name == "README.md":
        return True
    if any(name.startswith(p) for p in _IGNORE_PREFIXES):
        return True
    if any(name.endswith(s) for s in _IGNORE_SUFFIXES):
        return True
    return False


def _list_section(root: Path, sub_root: Path) -> Section:
    section = Section(name=sub_root.name)
    if not sub_root.is_dir():
        return section
    for entry in sorted(sub_root.rglob("*")):
        if not entry.is_file():
            continue
        if _is_ignored(entry.name):
            continue
        try:
            stat = entry.stat()
            size = stat.st_size
            mtime = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
        except OSError:
            size = 0
            mtime = ""
        section.files.append(
            FileEntry(
                name=entry.name,
                relpath=str(entry.relative_to(root)),
                size=size,
                mtime=mtime,
                ext=entry.suffix.lower(),
            )
        )
    section.count = len(section.files)
    return section


def inspect_role(role: str, root: str | None) -> RoleSnapshot:
    if not root:
        return RoleSnapshot(role=role, path=None, exists=False, sections=[])
    root_path = Path(root)
    if not root_path.exists():
        return RoleSnapshot(role=role, path=str(root_path), exists=False, sections=[])

    if role == "materials":
        subfolders = MATERIALS_SUBFOLDERS
    elif role == "brain":
        subfolders = BRAIN_SUBFOLDERS
    elif role == "library":
        subfolders = LIBRARY_SUBFOLDERS
    elif role == "workshop":
        subfolders = WORKSHOP_SUBFOLDERS
    else:
        return RoleSnapshot(role=role, path=str(root_path), exists=True, sections=[])

    sections = [_list_section(root_path, root_path / name) for name in subfolders]
    return RoleSnapshot(role=role, path=str(root_path), exists=True, sections=sections)
