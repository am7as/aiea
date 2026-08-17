from __future__ import annotations

import json
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.extract.base import ExtractedDoc


# DB method value -> on-disk folder name under extracted/
_METHOD_FOLDER = {"python": "py", "ai": "ai"}


def version_dir(workshop_path: Path, material_id: uuid.UUID, method: str) -> Path:
    """Per-method extraction folder — <workshop>/extracted/{py,ai}/<id>/."""
    return workshop_path / "extracted" / _METHOD_FOLDER.get(method, method) / str(material_id)


def final_dir(workshop_path: Path, material_id: uuid.UUID) -> Path:
    """The selected final extraction — <workshop>/extracted/final/<id>/.
    This is what downstream (syllabus, question generation) reads."""
    return workshop_path / "extracted" / "final" / str(material_id)


def comparison_dir(workshop_path: Path, material_id: uuid.UUID) -> Path:
    """Extraction-quality reports — <workshop>/extracted/comparison/<id>/."""
    return workshop_path / "extracted" / "comparison" / str(material_id)


def write_report(workshop_path: Path, material_id: uuid.UUID, filename: str, content: str) -> Path:
    """Write a comparison/evaluation report into <workshop>/extracted/comparison/<id>/."""
    dir_ = comparison_dir(workshop_path, material_id)
    dir_.mkdir(parents=True, exist_ok=True)
    target = dir_ / filename
    target.write_text(content if content.endswith("\n") else content + "\n", encoding="utf-8")
    return target


def write_extracted(
    workshop_path: Path,
    course_id: uuid.UUID,
    material_id: uuid.UUID,
    collection: str,
    subpath: str,
    original_filename: str,
    doc: "ExtractedDoc",
    method: str = "",
) -> Path:
    """Write extracted.md into the method's version folder (or the final folder)."""
    dir_ = (
        version_dir(workshop_path, material_id, method)
        if method
        else final_dir(workshop_path, material_id)
    )
    dir_.mkdir(parents=True, exist_ok=True)
    frontmatter_lines = [
        "---",
        f"material_id: {material_id}",
        f"course_id: {course_id}",
        f"collection: {collection}",
        f"subpath: {subpath}",
        f"original_filename: {original_filename}",
        f"extraction_method: {doc.extraction_method}",
        f"pages: {len(doc.pages)}",
        f"word_count: {doc.word_count}",
        f"extracted_at: {datetime.now(timezone.utc).isoformat()}",
    ]
    if doc.title:
        frontmatter_lines.append(f"title: {json.dumps(doc.title)}")
    frontmatter_lines.append("---")
    content = "\n".join(frontmatter_lines) + "\n\n" + doc.to_markdown()
    target = dir_ / "extracted.md"
    target.write_text(content, encoding="utf-8")
    return target


def write_meta(
    workshop_path: Path,
    material_id: uuid.UUID,
    payload: dict,
    method: str = "",
) -> Path:
    dir_ = (
        version_dir(workshop_path, material_id, method)
        if method
        else final_dir(workshop_path, material_id)
    )
    dir_.mkdir(parents=True, exist_ok=True)
    target = dir_ / "meta.json"
    target.write_text(json.dumps(payload, indent=2, default=str) + "\n", encoding="utf-8")
    return target


def promote_version(workshop_path: Path, material_id: uuid.UUID, method: str) -> None:
    """Copy a method's extracted.md / meta.json + figure attachments into the final folder."""
    src = version_dir(workshop_path, material_id, method)
    dst = final_dir(workshop_path, material_id)
    dst.mkdir(parents=True, exist_ok=True)
    for name in ("extracted.md", "meta.json"):
        s = src / name
        if s.exists():
            shutil.copyfile(s, dst / name)
    # figure crops referenced by extracted.md as ![](attachments/...)
    dst_attachments = dst / "attachments"
    if dst_attachments.exists():
        shutil.rmtree(dst_attachments)
    src_attachments = src / "attachments"
    if src_attachments.is_dir():
        shutil.copytree(src_attachments, dst_attachments)


def save_upload_into_materials(
    materials_path: Path,
    collection: str,
    filename: str,
    payload: bytes,
) -> tuple[Path, str]:
    """Save a multipart upload into <materials>/<collection>/<filename>. Returns (abs_path, subpath)."""
    sub_dir = materials_path / collection
    sub_dir.mkdir(parents=True, exist_ok=True)
    target = sub_dir / filename
    target.write_bytes(payload)
    return target, f"{collection}/{filename}"
