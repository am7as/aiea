from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from fastapi.responses import FileResponse, PlainTextResponse
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import get_db
from app.db.models import Course, ExtractionVersion, Material
from app.queue import abort_job, enqueue
from app.schemas.material import (
    COLLECTIONS,
    ExtractionVersionRead,
    MaterialBatch,
    MaterialRead,
    MaterialVersionBrief,
    MaterialVersionsRead,
    ScanCollection,
    ScanFileEntry,
    ScanResult,
)
import frontmatter

from app.vault.extraction import finalize_version, get_version, list_versions, upsert_version
from app.vault.scanner import scan_materials
from app.vault.writer import comparison_dir, final_dir, save_upload_into_materials, version_dir

router = APIRouter(prefix="/materials", tags=["materials"])


def _to_read(m: Material, versions: list[ExtractionVersion] = ()) -> MaterialRead:
    meta = m.meta or {}
    return MaterialRead(
        id=m.id,
        course_id=m.course_id,
        collection=m.collection,
        subpath=m.subpath,
        title=m.title,
        original_filename=m.original_filename,
        pages=m.pages,
        extraction_method=m.extraction_method,
        extraction_status=m.extraction_status,
        extraction_error=m.extraction_error,
        word_count=meta.get("word_count") if isinstance(meta, dict) else None,
        uploaded_at=m.uploaded_at,
        versions=[
            MaterialVersionBrief(
                method=v.method, status=v.status, is_final=v.is_final, eval_score=v.eval_score
            )
            for v in versions
        ],
        comparison=meta.get("comparison") if isinstance(meta, dict) else None,
    )


@router.get("/", response_model=list[MaterialRead])
async def list_materials(
    course_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[MaterialRead]:
    stmt = select(Material).order_by(Material.uploaded_at.desc())
    if course_id is not None:
        stmt = stmt.where(Material.course_id == course_id)
    rows = (await db.execute(stmt)).scalars().all()
    mids = [m.id for m in rows]
    vrows = (
        (
            await db.execute(
                select(ExtractionVersion).where(ExtractionVersion.material_id.in_(mids))
            )
        )
        .scalars()
        .all()
        if mids
        else []
    )
    by_material: dict[uuid.UUID, list[ExtractionVersion]] = {}
    for v in vrows:
        by_material.setdefault(v.material_id, []).append(v)
    return [_to_read(m, by_material.get(m.id, [])) for m in rows]


@router.get("/extraction-summary")
async def extraction_summary(
    course_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> dict:
    """Course-wide extraction state — counts for the panel's overview bar."""
    materials = list(
        (await db.execute(select(Material).where(Material.course_id == course_id)))
        .scalars()
        .all()
    )
    material_ids = [m.id for m in materials]
    compared = sum(
        1 for m in materials if isinstance((m.meta or {}).get("comparison"), dict)
    )
    versions = (
        (
            await db.execute(
                select(ExtractionVersion).where(ExtractionVersion.material_id.in_(material_ids))
            )
        )
        .scalars()
        .all()
        if material_ids
        else []
    )
    by_material: dict[uuid.UUID, list[ExtractionVersion]] = {}
    for v in versions:
        by_material.setdefault(v.material_id, []).append(v)

    def _bucket() -> dict[str, int]:
        return {"done": 0, "running": 0, "error": 0}

    python, ai = _bucket(), _bucket()
    evaluated = final_set = no_extraction = 0
    for mid in material_ids:
        vs = by_material.get(mid, [])
        if not vs:
            no_extraction += 1
        if any(v.is_final for v in vs):
            final_set += 1
        if any(v.eval_score is not None for v in vs):
            evaluated += 1
        for v in vs:
            bucket = python if v.method == "python" else ai
            if v.status == "done":
                bucket["done"] += 1
            elif v.status == "error":
                bucket["error"] += 1
            else:  # pending | running
                bucket["running"] += 1

    return {
        "materials": len(material_ids),
        "python": python,
        "ai": ai,
        "evaluated": evaluated,
        "compared": compared,
        "final_set": final_set,
        "no_extraction": no_extraction,
    }


@router.post(
    "/upload",
    response_model=MaterialRead,
    status_code=status.HTTP_202_ACCEPTED,
)
async def upload_material(
    course_id: uuid.UUID = Form(...),
    collection: str = Form(...),
    title: str = Form(""),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
) -> MaterialRead:
    if collection not in COLLECTIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown collection {collection!r}. Allowed: {sorted(COLLECTIONS)}.",
        )
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing filename on upload.",
        )

    course = await db.get(Course, course_id)
    if course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    if not course.materials_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Course has no materials_path configured.",
        )

    payload = await file.read()
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Empty file upload.",
        )

    _, subpath = save_upload_into_materials(
        materials_path=Path(course.materials_path),
        collection=collection,
        filename=file.filename,
        payload=payload,
    )

    material = Material(
        course_id=course.id,
        collection=collection,
        subpath=subpath,
        title=title or file.filename,
        original_filename=file.filename,
        extraction_status="pending",
        meta={
            "byte_size": len(payload),
            "content_type": file.content_type or "",
        },
    )
    db.add(material)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A material at {subpath!r} already exists for this course.",
        ) from exc
    await db.commit()

    await enqueue("ingest_material", str(material.id))
    return _to_read(material)


@router.post(
    "/scan",
    response_model=ScanResult,
    status_code=status.HTTP_200_OK,
)
async def scan_course_materials(
    course_id: uuid.UUID,
    auto_ingest: bool = False,
    db: AsyncSession = Depends(get_db),
) -> ScanResult:
    course = await db.get(Course, course_id)
    if course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    if not course.materials_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Course has no materials_path configured.",
        )
    materials_root = Path(course.materials_path)
    if not materials_root.exists():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Materials folder does not exist: {materials_root}",
        )

    discovered = scan_materials(materials_root)

    existing_rows = (
        await db.execute(select(Material).where(Material.course_id == course_id))
    ).scalars().all()
    by_subpath: dict[str, Material] = {m.subpath: m for m in existing_rows}

    new_ids: list[uuid.UUID] = []
    for entry in discovered:
        if entry.subpath in by_subpath:
            continue
        m = Material(
            course_id=course.id,
            collection=entry.collection,
            subpath=entry.subpath,
            title=entry.filename,
            original_filename=entry.filename,
            extraction_status="pending",
            meta={"byte_size": entry.size},
        )
        db.add(m)
        await db.flush()
        by_subpath[entry.subpath] = m
        new_ids.append(m.id)
    await db.commit()

    if auto_ingest:
        for mid in new_ids:
            await enqueue("ingest_material", str(mid))

    by_collection: dict[str, list[ScanFileEntry]] = {}
    for entry in discovered:
        m = by_subpath[entry.subpath]
        by_collection.setdefault(entry.collection, []).append(
            ScanFileEntry(
                collection=entry.collection,
                subpath=entry.subpath,
                filename=entry.filename,
                size=entry.size,
                suffix=entry.suffix,
                material_id=m.id,
                extraction_status=m.extraction_status,
                pages=m.pages,
            )
        )

    return ScanResult(
        materials_path=str(materials_root),
        collections=[
            ScanCollection(name=name, files=files) for name, files in sorted(by_collection.items())
        ],
        total_files=len(discovered),
        registered=len(by_subpath),
        new_registered=len(new_ids),
    )


@router.post("/ingest-pending", status_code=status.HTTP_202_ACCEPTED)
async def ingest_pending(
    course_id: uuid.UUID,
    include_errors: bool = True,
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    """Enqueue extraction for every not-yet-extracted material in a course."""
    course = await db.get(Course, course_id)
    if course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    wanted = {"pending", "error"} if include_errors else {"pending"}
    rows = (
        await db.execute(select(Material).where(Material.course_id == course_id))
    ).scalars().all()
    targets = [m for m in rows if m.extraction_status in wanted]
    for m in targets:
        m.extraction_status = "pending"
        m.extraction_error = None
    await db.commit()
    for m in targets:
        await enqueue("ingest_material", str(m.id))
    return {"enqueued": len(targets)}


@router.post(
    "/{material_id}/ingest",
    status_code=status.HTTP_202_ACCEPTED,
)
async def trigger_ingest(
    material_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> dict[str, str]:
    material = await db.get(Material, material_id)
    if material is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material not found")
    await _enqueue_extract(material, "python", "ingest_material", db)
    return {"status": "enqueued", "material_id": str(material_id)}


async def _enqueue_extract(
    material: Material, method: str, job_name: str, db: AsyncSession
) -> None:
    """Create the pending version row + store the ARQ job id before enqueuing,
    so a still-queued job is visible and stoppable, not just running ones."""
    version = await upsert_version(db, material.id, method)
    version.status = "pending"
    version.error = None
    material.extraction_status = "pending"
    material.extraction_error = None
    await db.commit()
    job_id = await enqueue(job_name, str(material.id))
    if job_id:
        version.job_id = job_id
        await db.commit()


@router.get("/{material_id}/figures/{name}")
async def get_extraction_figure(
    material_id: uuid.UUID,
    name: str,
    method: str = "ai",
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    """Serve a cropped figure PNG from a material's extraction attachments."""
    if "/" in name or "\\" in name or ".." in name or not name.endswith(".png"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "bad figure name")
    material = await db.get(Material, material_id)
    if material is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Material not found")
    course = await db.get(Course, material.course_id)
    if course is None or not course.workshop_path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "course workshop not configured")
    workshop = Path(course.workshop_path)
    method = "python" if method in ("py", "python") else method
    candidates = [
        version_dir(workshop, material_id, method) / "attachments" / name,
        final_dir(workshop, material_id) / "attachments" / name,
        version_dir(workshop, material_id, "ai") / "attachments" / name,
    ]
    for path in candidates:
        if path.is_file():
            return FileResponse(path, media_type="image/png")
    raise HTTPException(status.HTTP_404_NOT_FOUND, "figure not found")


@router.post("/{material_id}/extract-ai", status_code=status.HTTP_202_ACCEPTED)
async def trigger_ai_extract(
    material_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> dict[str, str]:
    """AI-extract a material (re-extracts regardless of current status)."""
    material = await db.get(Material, material_id)
    if material is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material not found")
    await _enqueue_extract(material, "ai", "ai_extract_material", db)
    return {"status": "enqueued", "material_id": str(material_id)}


@router.post("/extract-ai-batch", status_code=status.HTTP_202_ACCEPTED)
async def trigger_ai_extract_batch(
    payload: MaterialBatch,
    overwrite: bool = False,
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    """AI-extract selected materials. overwrite=false skips ones already done."""
    rows = (
        await db.execute(select(Material).where(Material.id.in_(payload.material_ids)))
    ).scalars().all()
    enqueued = 0
    for m in rows:
        if not overwrite:
            v = await get_version(db, m.id, "ai")
            if v is not None and v.status == "done":
                continue
        await _enqueue_extract(m, "ai", "ai_extract_material", db)
        enqueued += 1
    return {"enqueued": enqueued, "skipped": len(rows) - enqueued}


@router.post("/ingest-batch", status_code=status.HTTP_202_ACCEPTED)
async def trigger_ingest_batch(
    payload: MaterialBatch,
    overwrite: bool = False,
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    """Python-extract selected materials. overwrite=false skips ones already done."""
    rows = (
        await db.execute(select(Material).where(Material.id.in_(payload.material_ids)))
    ).scalars().all()
    enqueued = 0
    for m in rows:
        if not overwrite:
            v = await get_version(db, m.id, "python")
            if v is not None and v.status == "done":
                continue
        await _enqueue_extract(m, "python", "ingest_material", db)
        enqueued += 1
    return {"enqueued": enqueued, "skipped": len(rows) - enqueued}
    return {"enqueued": len(rows)}


@router.post("/compare-batch", status_code=status.HTTP_202_ACCEPTED)
async def compare_batch(
    payload: MaterialBatch,
    overwrite: bool = False,
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    """Compare python vs ai extraction. overwrite=false skips already-compared."""
    enqueued = 0
    for mid in payload.material_ids:
        if not overwrite:
            m = await db.get(Material, mid)
            if m is not None and isinstance((m.meta or {}).get("comparison"), dict):
                continue
        await enqueue("compare_extraction", str(mid))
        enqueued += 1
    return {"enqueued": enqueued, "skipped": len(payload.material_ids) - enqueued}


@router.post("/evaluate-batch", status_code=status.HTTP_202_ACCEPTED)
async def evaluate_batch(
    payload: MaterialBatch,
    overwrite: bool = False,
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    """Evaluate versions against the source. overwrite=false skips already-scored."""
    enqueued = 0
    for mid in payload.material_ids:
        if not overwrite:
            versions = await list_versions(db, mid)
            if versions and any(v.eval_score is not None for v in versions):
                continue
        await enqueue("evaluate_extraction", str(mid))
        enqueued += 1
    return {"enqueued": enqueued, "skipped": len(payload.material_ids) - enqueued}


@router.post("/set-final-batch", status_code=status.HTTP_200_OK)
async def set_final_batch(
    method: str, payload: MaterialBatch, db: AsyncSession = Depends(get_db)
) -> dict[str, int]:
    """Mark the given method's version final for each selected material."""
    if method not in ("python", "ai"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="method must be python or ai")
    finalized = 0
    for mid in payload.material_ids:
        material = await db.get(Material, mid)
        if material is None:
            continue
        course = await db.get(Course, material.course_id)
        if course is None or not course.workshop_path:
            continue
        version = await get_version(db, mid, method)
        if version is None or version.status != "done":
            continue
        await finalize_version(db, Path(course.workshop_path), material, version)
        finalized += 1
    await db.commit()
    return {"finalized": finalized}


@router.post("/extract-stop", status_code=status.HTTP_200_OK)
async def stop_extraction(
    payload: MaterialBatch, db: AsyncSession = Depends(get_db)
) -> dict[str, int]:
    """Abort in-flight / queued extraction jobs for the given materials."""
    rows = (
        await db.execute(
            select(ExtractionVersion).where(
                ExtractionVersion.material_id.in_(payload.material_ids),
                ExtractionVersion.status.in_(["pending", "running"]),
            )
        )
    ).scalars().all()
    for v in rows:
        if v.job_id:
            await abort_job(v.job_id)
        v.status = "error"
        v.error = "stopped by user"
    for mid in {v.material_id for v in rows}:
        m = await db.get(Material, mid)
        if m is not None and m.extraction_status == "running":
            m.extraction_status = "error"
            m.extraction_error = "stopped by user"
    await db.commit()
    return {"stopped": len(rows)}


@router.post("/check-extracted", status_code=status.HTTP_200_OK)
async def check_extracted(
    course_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> dict[str, int]:
    """Flag any extraction version whose extracted.md was deleted from disk."""
    course = await db.get(Course, course_id)
    if course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    material_ids = (
        await db.execute(select(Material.id).where(Material.course_id == course_id))
    ).scalars().all()
    versions = (
        await db.execute(
            select(ExtractionVersion).where(ExtractionVersion.material_id.in_(material_ids))
        )
    ).scalars().all()
    missing = 0
    for v in versions:
        if v.status == "done" and v.vault_path and not Path(v.vault_path).exists():
            v.status = "error"
            v.error = "extracted file is missing on disk"
            missing += 1
    await db.commit()
    return {"checked": len(versions), "missing": missing}


@router.post("/verify-extractions", status_code=status.HTTP_200_OK)
async def verify_extractions(
    course_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> dict[str, int]:
    """Reconcile version status with disk — an extracted.md that exists marks
    its version done; one that is gone marks it error. Recovers statuses that
    were clobbered by a re-run or a stop."""
    course = await db.get(Course, course_id)
    if course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    if not course.workshop_path:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No workshop_path")
    workshop = Path(course.workshop_path)
    materials = (
        await db.execute(select(Material).where(Material.course_id == course_id))
    ).scalars().all()
    reconciled = 0
    for m in materials:
        for method in ("python", "ai"):
            f = version_dir(workshop, m.id, method) / "extracted.md"
            version = await get_version(db, m.id, method)
            if f.exists() and f.stat().st_size > 40:
                if version is None:
                    version = await upsert_version(db, m.id, method)
                if version.status != "done" or version.vault_path != str(f):
                    meta: dict = {}
                    try:
                        meta = frontmatter.loads(f.read_text(encoding="utf-8")).metadata or {}
                    except Exception:  # noqa: BLE001
                        meta = {}
                    version.status = "done"
                    version.error = None
                    version.vault_path = str(f)
                    if isinstance(meta.get("pages"), int):
                        version.pages = meta["pages"]
                    if isinstance(meta.get("word_count"), int):
                        version.word_count = meta["word_count"]
                    if isinstance(meta.get("extraction_method"), str):
                        version.extraction_method = meta["extraction_method"][:64]
                    reconciled += 1
            elif version is not None and version.status in ("done", "running", "pending"):
                was = version.status
                version.status = "error"
                version.error = (
                    "extracted file is missing on disk"
                    if was == "done"
                    else "extraction did not finish — re-run"
                )
                reconciled += 1
    await db.commit()
    return {"reconciled": reconciled}


@router.post("/prune-missing", status_code=status.HTTP_200_OK)
async def prune_missing(
    course_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> dict[str, object]:
    """Remove Material rows whose source file no longer exists on disk."""
    course = await db.get(Course, course_id)
    if course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    if not course.materials_path:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No materials_path")
    root = Path(course.materials_path)
    rows = (
        await db.execute(select(Material).where(Material.course_id == course_id))
    ).scalars().all()
    pruned: list[str] = []
    for m in rows:
        if not (root / m.subpath).exists():
            pruned.append(m.subpath)
            await db.delete(m)
    await db.commit()
    return {"pruned": len(pruned), "subpaths": pruned}


def _read_text(path: str | None, cap: int = 40_000) -> str | None:
    if not path:
        return None
    p = Path(path)
    if not p.exists():
        return None
    try:
        return p.read_text(encoding="utf-8")[:cap]
    except OSError:
        return None


async def _versions_payload(material: Material, db: AsyncSession) -> MaterialVersionsRead:
    versions = await list_versions(db, material.id)
    course = await db.get(Course, material.course_id)
    workshop = Path(course.workshop_path) if course and course.workshop_path else None
    py = next((v for v in versions if v.method == "python"), None)
    ai = next((v for v in versions if v.method == "ai"), None)
    comp_report = eval_report = None
    comp_path = eval_path = None
    if workshop is not None:
        cdir = comparison_dir(workshop, material.id)
        comp_path = str(cdir / "comparison.md")
        eval_path = str(cdir / "evaluation.md")
        comp_report = _read_text(comp_path)
        eval_report = _read_text(eval_path)
    comparison = (material.meta or {}).get("comparison")
    return MaterialVersionsRead(
        material_id=material.id,
        versions=[ExtractionVersionRead.model_validate(v) for v in versions],
        comparison=comparison if isinstance(comparison, dict) else None,
        python_text=_read_text(py.vault_path) if py else None,
        ai_text=_read_text(ai.vault_path) if ai else None,
        comparison_report=comp_report,
        evaluation_report=eval_report,
        python_path=py.vault_path if py else None,
        ai_path=ai.vault_path if ai else None,
        comparison_path=comp_path,
        evaluation_path=eval_path,
    )


@router.get("/{material_id}/versions", response_model=MaterialVersionsRead)
async def get_material_versions(
    material_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> MaterialVersionsRead:
    material = await db.get(Material, material_id)
    if material is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material not found")
    return await _versions_payload(material, db)


@router.post("/{material_id}/versions/{method}/set-final", response_model=MaterialVersionsRead)
async def set_final_version(
    material_id: uuid.UUID, method: str, db: AsyncSession = Depends(get_db)
) -> MaterialVersionsRead:
    """Mark a version final — downstream (syllabus, questions) then reads it."""
    material = await db.get(Material, material_id)
    if material is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material not found")
    course = await db.get(Course, material.course_id)
    if course is None or not course.workshop_path:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="course workshop_path not set")
    version = await get_version(db, material_id, method)
    if version is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"no {method} version")
    if version.status != "done":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="version is not a completed extraction"
        )
    await finalize_version(db, Path(course.workshop_path), material, version)
    await db.commit()
    return await _versions_payload(material, db)


@router.get("/{material_id}", response_model=MaterialRead)
async def get_material(
    material_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> MaterialRead:
    material = await db.get(Material, material_id)
    if material is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material not found")
    return _to_read(material)


@router.get("/{material_id}/text", response_class=PlainTextResponse)
async def get_material_text(
    material_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> Response:
    material = await db.get(Material, material_id)
    if material is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material not found")
    return PlainTextResponse(material.extracted_text or "")


@router.delete("/{material_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_material(
    material_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> None:
    result = await db.execute(delete(Material).where(Material.id == material_id))
    if result.rowcount == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material not found")
