from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import get_db
from app.db.models import Course
from app.queue import enqueue
from app.schemas.syllabus import SyllabusBuildResult, SyllabusRead, SyllabusWrite
from app.vault.syllabus import read_syllabus, write_status, write_syllabus

router = APIRouter(prefix="/courses", tags=["syllabus"])


async def _course_brain(course_id: uuid.UUID, db: AsyncSession) -> tuple[Course, Path]:
    course = await db.get(Course, course_id)
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found")
    if not course.brain_path:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "brain_path is not configured for this course")
    return course, Path(course.brain_path)


@router.get("/{course_id}/syllabus", response_model=SyllabusRead)
async def get_syllabus(course_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> SyllabusRead:
    _, brain = await _course_brain(course_id, db)
    return SyllabusRead(**read_syllabus(brain))


@router.put("/{course_id}/syllabus", response_model=SyllabusRead)
async def put_syllabus(
    course_id: uuid.UUID,
    payload: SyllabusWrite,
    db: AsyncSession = Depends(get_db),
) -> SyllabusRead:
    _, brain = await _course_brain(course_id, db)
    write_syllabus(brain, payload.content)
    write_status(brain, "ready")
    return SyllabusRead(**read_syllabus(brain))


@router.post(
    "/{course_id}/syllabus/build",
    response_model=SyllabusBuildResult,
    status_code=status.HTTP_202_ACCEPTED,
)
async def build_syllabus_route(
    course_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> SyllabusBuildResult:
    _, brain = await _course_brain(course_id, db)
    write_status(brain, "building")
    await enqueue("build_syllabus", str(course_id))
    return SyllabusBuildResult(status="building", detail="syllabus build enqueued")


@router.post(
    "/{course_id}/syllabus/discover-categories",
    response_model=SyllabusBuildResult,
    status_code=status.HTTP_202_ACCEPTED,
)
async def discover_categories_route(
    course_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> SyllabusBuildResult:
    """Enqueue per-chapter category discovery; rewrites syllabus.md frontmatter."""
    _, brain = await _course_brain(course_id, db)
    write_status(brain, "building")
    await enqueue("discover_categories_job", str(course_id))
    return SyllabusBuildResult(
        status="building", detail="category discovery enqueued"
    )
