"""Extraction-version bookkeeping — shared by the workers and the API.

A material can hold a `python` and an `ai` ExtractionVersion. Exactly one may
be `is_final`; the Material columns mirror the final version so downstream
(syllabus, question generation) keeps reading Material unchanged.
"""
from __future__ import annotations

import uuid
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import ExtractionVersion, Material
from app.vault.writer import final_dir, promote_version

VERSION_METHODS = ("python", "ai")


async def get_version(
    session: AsyncSession, material_id: uuid.UUID, method: str
) -> ExtractionVersion | None:
    res = await session.execute(
        select(ExtractionVersion).where(
            ExtractionVersion.material_id == material_id,
            ExtractionVersion.method == method,
        )
    )
    return res.scalar_one_or_none()


async def list_versions(
    session: AsyncSession, material_id: uuid.UUID
) -> list[ExtractionVersion]:
    res = await session.execute(
        select(ExtractionVersion)
        .where(ExtractionVersion.material_id == material_id)
        .order_by(ExtractionVersion.method)
    )
    return list(res.scalars().all())


async def upsert_version(
    session: AsyncSession, material_id: uuid.UUID, method: str
) -> ExtractionVersion:
    version = await get_version(session, material_id, method)
    if version is None:
        version = ExtractionVersion(material_id=material_id, method=method, status="pending")
        session.add(version)
        await session.flush()
    return version


async def has_final(session: AsyncSession, material_id: uuid.UUID) -> bool:
    return any(v.is_final for v in await list_versions(session, material_id))


def _plain_text(md_path: Path) -> str:
    if not md_path.exists():
        return ""
    text = md_path.read_text(encoding="utf-8")
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            text = text[end + 4 :]
    return text.strip()


async def finalize_version(
    session: AsyncSession,
    workshop_path: Path,
    material: Material,
    version: ExtractionVersion,
) -> None:
    """Make `version` the final one: clear other flags, promote its files,
    and mirror it onto the Material so downstream reads it."""
    for v in await list_versions(session, material.id):
        v.is_final = v.id == version.id
    version.is_final = True
    promote_version(workshop_path, material.id, version.method)
    material.extraction_status = version.status
    material.extraction_method = version.extraction_method
    material.extraction_error = version.error
    material.pages = version.pages
    material.meta = {
        **(material.meta or {}),
        "word_count": version.word_count,
        "pages": version.pages,
        "extraction_method": version.extraction_method,
    }
    material.extracted_text = _plain_text(final_dir(workshop_path, material.id) / "extracted.md")
