from __future__ import annotations

import asyncio
import logging
import uuid
from pathlib import Path

from app.db.base import SessionLocal
from app.db.models import Course, Material
from app.extract.registry import get_extractor
from app.vault.extraction import finalize_version, upsert_version
from app.vault.scanner import extractor_kind_for
from app.vault.writer import version_dir, write_extracted, write_meta

log = logging.getLogger(__name__)


async def ingest_material(ctx: dict, material_id: str) -> dict:
    """ARQ task. Python extraction — writes the `python` ExtractionVersion."""
    mid = uuid.UUID(material_id)
    async with SessionLocal() as session:
        material = await session.get(Material, mid)
        if material is None:
            log.warning("ingest_material: material %s not found", material_id)
            return {"status": "error", "error": "material not found"}

        course = await session.get(Course, material.course_id)
        if course is None or not course.materials_path or not course.workshop_path:
            return {"status": "error", "error": "course paths not configured"}

        version = await upsert_version(session, mid, "python")
        version.status = "running"
        version.error = None
        version.job_id = ctx.get("job_id")
        material.extraction_status = "running"
        await session.commit()

        original_abs = Path(course.materials_path) / material.subpath
        workshop = Path(course.workshop_path)

        try:
            if not original_abs.exists():
                raise FileNotFoundError(f"source file missing: {material.subpath}")
            kind = extractor_kind_for(material.original_filename)
            if not kind:
                raise RuntimeError(f"no extractor for {material.original_filename}")

            extractor = get_extractor(kind)
            doc = await asyncio.to_thread(extractor.extract, original_abs)

            write_extracted(
                workshop_path=workshop,
                course_id=course.id,
                material_id=mid,
                collection=material.collection,
                subpath=material.subpath,
                original_filename=material.original_filename,
                doc=doc,
                method="python",
            )
            write_meta(
                workshop,
                mid,
                {
                    "word_count": doc.word_count,
                    "title": doc.title,
                    "pages": len(doc.pages),
                    "extraction_method": doc.extraction_method,
                },
                method="python",
            )
            version.status = "done"
            version.pages = len(doc.pages)
            version.word_count = doc.word_count
            version.extraction_method = doc.extraction_method
            version.vault_path = str(version_dir(workshop, mid, "python") / "extracted.md")
            version.error = None
            material.extraction_status = "done"
            # final/ is written only when the user picks a version; re-promote
            # only if this method is already the chosen final.
            if version.is_final:
                await finalize_version(session, workshop, material, version)
            await session.commit()
            log.info("python-extracted material %s: %d pages", material_id, len(doc.pages))
            return {"status": "done", "pages": len(doc.pages)}
        except Exception as exc:  # noqa: BLE001
            log.exception("python extraction failed for material %s", material_id)
            version.status = "error"
            version.error = f"{type(exc).__name__}: {exc}"
            material.extraction_status = "error"
            material.extraction_error = version.error
            await session.commit()
            return {"status": "error", "error": str(exc)}
