from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from app.vault.bootstrap import MATERIALS_SUBFOLDERS


SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".pptx", ".md", ".markdown", ".tex", ".html", ".htm"}

# Files / folders we never register or extract.
_IGNORE_PREFIXES = ("~$", ".")  # Office locks, dotfiles
_IGNORE_NAMES = {"README.md", "Thumbs.db", "desktop.ini"}
_IGNORE_SUFFIXES = (".tmp", ".swp", ".part")


@dataclass(slots=True)
class ScannedFile:
    collection: str          # e.g. "lectures"
    subpath: str             # relative to materials_path, e.g. "lectures/L01-intro.pptx"
    filename: str
    size: int
    suffix: str              # ".pdf" etc.


def _is_ignored(name: str) -> bool:
    if name in _IGNORE_NAMES:
        return True
    if any(name.startswith(p) for p in _IGNORE_PREFIXES):
        return True
    if any(name.endswith(s) for s in _IGNORE_SUFFIXES):
        return True
    return False


def scan_materials(materials_root: Path) -> list[ScannedFile]:
    """Walk each canonical materials subfolder; return discovered ingestible files."""
    out: list[ScannedFile] = []
    if not materials_root.exists():
        return out
    for collection in MATERIALS_SUBFOLDERS:
        col_root = materials_root / collection
        if not col_root.is_dir():
            continue
        for entry in sorted(col_root.rglob("*")):
            if not entry.is_file():
                continue
            if _is_ignored(entry.name):
                continue
            # skip browser "Save Page As — Complete" resource folders (<name>_files/)
            if any(part.endswith("_files") for part in entry.relative_to(col_root).parts[:-1]):
                continue
            suffix = entry.suffix.lower()
            if suffix not in SUPPORTED_EXTENSIONS:
                continue
            rel = entry.relative_to(materials_root)
            try:
                size = entry.stat().st_size
            except OSError:
                size = 0
            out.append(
                ScannedFile(
                    collection=collection,
                    subpath=str(rel),
                    filename=entry.name,
                    size=size,
                    suffix=suffix,
                )
            )
    return out


_EXTRACTOR_BY_SUFFIX = {
    ".pdf": "pdf",
    ".docx": "docx",
    ".pptx": "pptx",
    ".md": "md",
    ".markdown": "md",
    ".tex": "md",  # treat .tex as Markdown-ish for now; specialized .tex extractor is a later phase
    ".html": "html",
    ".htm": "html",
}


def extractor_kind_for(filename: str) -> str | None:
    return _EXTRACTOR_BY_SUFFIX.get(Path(filename).suffix.lower())
