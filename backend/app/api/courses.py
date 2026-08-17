from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from pydantic import BaseModel

from app.db.base import get_db
from app.db.models import Course, Exam, Material, Question
from app.schemas.course import CourseCreate, CourseRead, CourseUpdate
from app.vault.bootstrap import (
    bootstrap_course_folders,
    bootstrap_role,
    quick_mode_paths,
)
from app.vault.inspect import inspect_role

router = APIRouter(prefix="/courses", tags=["courses"])


def _counts_subqueries():
    materials_count = (
        select(func.count(Material.id)).where(Material.course_id == Course.id).scalar_subquery()
    )
    questions_count = (
        select(func.count(Question.id)).where(Question.course_id == Course.id).scalar_subquery()
    )
    exams_count = (
        select(func.count(Exam.id)).where(Exam.course_id == Course.id).scalar_subquery()
    )
    return materials_count, questions_count, exams_count


def _row_to_read(row) -> CourseRead:
    course, materials_count, questions_count, exams_count = row
    return CourseRead(
        id=course.id,
        code=course.code,
        title=course.title,
        description_md=course.description_md,
        topics=list(course.topics or []),
        language=course.language,
        materials_path=course.materials_path,
        brain_path=course.brain_path,
        library_path=course.library_path,
        workshop_path=course.workshop_path,
        created_at=course.created_at,
        materials_count=materials_count,
        questions_count=questions_count,
        exams_count=exams_count,
    )


def _resolve_paths(payload: CourseCreate) -> dict[str, Path]:
    if payload.quick_parent:
        parent = Path(payload.quick_parent).expanduser().resolve()
        return quick_mode_paths(parent)
    return {
        "materials_path": Path(payload.materials_path).expanduser().resolve(),  # type: ignore[arg-type]
        "brain_path": Path(payload.brain_path).expanduser().resolve(),  # type: ignore[arg-type]
        "library_path": Path(payload.library_path).expanduser().resolve(),  # type: ignore[arg-type]
        "workshop_path": Path(payload.workshop_path).expanduser().resolve(),  # type: ignore[arg-type]
    }


@router.get("/", response_model=list[CourseRead])
async def list_courses(db: AsyncSession = Depends(get_db)) -> list[CourseRead]:
    materials_count, questions_count, exams_count = _counts_subqueries()
    stmt = select(Course, materials_count, questions_count, exams_count).order_by(
        Course.created_at.desc()
    )
    result = await db.execute(stmt)
    return [_row_to_read(row) for row in result.all()]


@router.post("/", response_model=CourseRead, status_code=status.HTTP_201_CREATED)
async def create_course(
    payload: CourseCreate, db: AsyncSession = Depends(get_db)
) -> CourseRead:
    paths = _resolve_paths(payload)

    course = Course(
        code=payload.code,
        title=payload.title,
        description_md=payload.description_md,
        topics=payload.topics,
        language=payload.language,
        materials_path=str(paths["materials_path"]),
        brain_path=str(paths["brain_path"]),
        library_path=str(paths["library_path"]),
        workshop_path=str(paths["workshop_path"]),
    )
    db.add(course)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A course with code {payload.code!r} already exists",
        ) from exc

    try:
        bootstrap_course_folders(
            course_id=course.id,
            code=course.code,
            materials_path=paths["materials_path"],
            brain_path=paths["brain_path"],
            library_path=paths["library_path"],
            workshop_path=paths["workshop_path"],
        )
    except OSError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not create folder layout: {exc}",
        ) from exc

    await db.refresh(course)
    return CourseRead(
        id=course.id,
        code=course.code,
        title=course.title,
        description_md=course.description_md,
        topics=list(course.topics or []),
        language=course.language,
        materials_path=course.materials_path,
        brain_path=course.brain_path,
        library_path=course.library_path,
        workshop_path=course.workshop_path,
        created_at=course.created_at,
        materials_count=0,
        questions_count=0,
        exams_count=0,
    )


async def _load_course_with_counts(course_id: uuid.UUID, db: AsyncSession) -> CourseRead:
    materials_count, questions_count, exams_count = _counts_subqueries()
    stmt = select(Course, materials_count, questions_count, exams_count).where(
        Course.id == course_id
    )
    row = (await db.execute(stmt)).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    return _row_to_read(row)


@router.get("/{course_id}", response_model=CourseRead)
async def get_course(
    course_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> CourseRead:
    return await _load_course_with_counts(course_id, db)


@router.patch("/{course_id}", response_model=CourseRead)
async def update_course(
    course_id: uuid.UUID,
    payload: CourseUpdate,
    db: AsyncSession = Depends(get_db),
) -> CourseRead:
    course = await db.get(Course, course_id)
    if course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(course, key, value)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A course with code {data.get('code')!r} already exists",
        ) from exc
    return await _load_course_with_counts(course_id, db)


@router.delete("/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_course(
    course_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> None:
    result = await db.execute(delete(Course).where(Course.id == course_id))
    if result.rowcount == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")


@router.get("/{course_id}/contents")
async def get_course_contents(
    course_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> dict:
    course = await db.get(Course, course_id)
    if course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    snapshots = {
        "materials": inspect_role("materials", course.materials_path),
        "brain":     inspect_role("brain", course.brain_path),
        "library":   inspect_role("library", course.library_path),
        "workshop":  inspect_role("workshop", course.workshop_path),
    }
    return {
        role: {
            "path": s.path,
            "exists": s.exists,
            "sections": [
                {
                    "name": sec.name,
                    "count": sec.count,
                    "files": [
                        {"name": f.name, "relpath": f.relpath, "size": f.size, "mtime": f.mtime, "ext": f.ext}
                        for f in sec.files
                    ],
                }
                for sec in s.sections
            ],
        }
        for role, s in snapshots.items()
    }


class BootstrapBody(BaseModel):
    role: str | None = None  # one of materials|brain|library|workshop, or None for all


@router.post("/{course_id}/bootstrap", response_model=CourseRead)
async def bootstrap_course_layout(
    course_id: uuid.UUID,
    payload: BootstrapBody | None = None,
    db: AsyncSession = Depends(get_db),
) -> CourseRead:
    """Re-create the canonical subfolders inside one role's path, or all four."""
    course = await db.get(Course, course_id)
    if course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    role = payload.role if payload else None

    role_to_path = {
        "materials": course.materials_path,
        "brain": course.brain_path,
        "library": course.library_path,
        "workshop": course.workshop_path,
    }
    targets = [role] if role else list(role_to_path.keys())
    for r in targets:
        if r not in role_to_path:
            raise HTTPException(status_code=400, detail=f"unknown role: {r}")
        rp = role_to_path[r]
        if not rp:
            raise HTTPException(status_code=400, detail=f"{r}_path is not set")
        try:
            bootstrap_role(r, Path(rp), course.id, course.code)
        except OSError as exc:
            raise HTTPException(status_code=400, detail=f"Could not scaffold {r}: {exc}") from exc
    return await _load_course_with_counts(course_id, db)


class QuickSetupBody(BaseModel):
    parent: str
    scaffold: bool = True  # False = connect to existing; True = create/merge canonical layout


@router.post("/{course_id}/setup-from-parent", response_model=CourseRead)
async def setup_from_parent(
    course_id: uuid.UUID,
    payload: QuickSetupBody,
    db: AsyncSession = Depends(get_db),
) -> CourseRead:
    """Point the course at <parent>/{materials,brain,library,workshop}.

    scaffold=True  → bootstrap the canonical layout (creates missing dirs, idempotent).
    scaffold=False → set paths only; do not create or modify anything on disk.
    """
    course = await db.get(Course, course_id)
    if course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    if not payload.parent.strip():
        raise HTTPException(status_code=400, detail="parent is required")
    parent_path = Path(payload.parent).expanduser().resolve()
    paths = quick_mode_paths(parent_path)
    course.materials_path = str(paths["materials_path"])
    course.brain_path = str(paths["brain_path"])
    course.library_path = str(paths["library_path"])
    course.workshop_path = str(paths["workshop_path"])
    await db.flush()

    if payload.scaffold:
        try:
            bootstrap_course_folders(
                course_id=course.id,
                code=course.code,
                materials_path=paths["materials_path"],
                brain_path=paths["brain_path"],
                library_path=paths["library_path"],
                workshop_path=paths["workshop_path"],
            )
        except OSError as exc:
            await db.rollback()
            raise HTTPException(status_code=400, detail=f"Could not scaffold: {exc}") from exc
    return await _load_course_with_counts(course_id, db)


@router.patch("/{course_id}/paths", response_model=CourseRead)
async def update_course_paths(
    course_id: uuid.UUID,
    payload: dict,
    db: AsyncSession = Depends(get_db),
) -> CourseRead:
    """Update any of the four folder paths.

    scaffold=True (default) → re-bootstrap the canonical subfolders inside any changed path.
    scaffold=False          → connect-only; set paths without creating/touching anything on disk.
    """
    course = await db.get(Course, course_id)
    if course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")

    scaffold = bool(payload.pop("scaffold", True))
    path_fields = {"materials_path", "brain_path", "library_path", "workshop_path"}
    changed_roles: list[str] = []
    for key, value in payload.items():
        if key in path_fields and isinstance(value, str) and value.strip():
            resolved = Path(value).expanduser().resolve()
            setattr(course, key, str(resolved))
            changed_roles.append(key.replace("_path", ""))
        elif key not in path_fields:
            setattr(course, key, value)
    await db.flush()

    if changed_roles and scaffold:
        try:
            for role in changed_roles:
                root_attr = f"{role}_path"
                root_str = getattr(course, root_attr)
                if root_str:
                    bootstrap_role(role, Path(root_str), course.id, course.code)
        except OSError as exc:
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Could not (re-)bootstrap folder layout: {exc}",
            ) from exc

    return await _load_course_with_counts(course_id, db)


# ─── Exam plan ──────────────────────────────────────────────────────────────


class ExamPlanCategory(BaseModel):
    chapter_id: str | None = None
    name: str
    target: int = 0


class ExamPlanBody(BaseModel):
    total_questions: int = 20
    total_minutes: int = 120
    categories: list[ExamPlanCategory] = []
    notes: str = ""


async def _exam_plan_payload(course: Course, db: AsyncSession) -> dict:
    from app.vault.exam_plan import read_exam_plan

    plan = read_exam_plan(Path(course.brain_path)) if course.brain_path else {
        "exists": False, "total_questions": 20, "total_minutes": 120,
        "categories": [], "notes": "",
    }
    # Per-(chapter,category) live counts from the DB.
    rows = await db.execute(
        select(Question.chapter_id, Question.category, func.count())
        .where(Question.course_id == course.id)
        .group_by(Question.chapter_id, Question.category)
    )
    have: dict[tuple[str, str], int] = {}
    for ch, cat, n in rows.all():
        have[((ch or ""), (cat or "uncategorized"))] = n

    # Carry forward what's stored in the plan; missing chapter_id stays None.
    seeded: list[dict] = [
        {
            "chapter_id": c.get("chapter_id"),
            "name": c["name"],
            "target": c.get("target", 0),
        }
        for c in plan["categories"]
    ]
    seeded_keys = {(c["chapter_id"] or "", c["name"]) for c in seeded}

    # Add every (chapter, category) pair that exists in the DB. Chapters with
    # no questions yet are not seeded — the user adds them explicitly via "+
    # Category" once they know the topic they want to target.
    for (cid, cat) in have:
        if (cid, cat) not in seeded_keys:
            seeded.append({"chapter_id": cid or None, "name": cat, "target": 0})
            seeded_keys.add((cid, cat))

    return {
        "exists": plan["exists"],
        "total_questions": plan["total_questions"],
        "total_minutes": plan["total_minutes"],
        "notes": plan["notes"],
        "categories": [
            {
                **c,
                "have": have.get(((c["chapter_id"] or ""), c["name"]), 0),
            }
            for c in seeded
        ],
    }


@router.get("/{course_id}/exam-plan")
async def get_exam_plan(course_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> dict:
    """The exam blueprint — categories with target vs. live 'have' counts."""
    course = await db.get(Course, course_id)
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found")
    return await _exam_plan_payload(course, db)


@router.put("/{course_id}/exam-plan")
async def put_exam_plan(
    course_id: uuid.UUID, body: ExamPlanBody, db: AsyncSession = Depends(get_db)
) -> dict:
    """Save the exam blueprint to <brain>/exam-plan.md."""
    from app.vault.exam_plan import write_exam_plan

    course = await db.get(Course, course_id)
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found")
    if not course.brain_path:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "course brain_path is not configured")
    write_exam_plan(Path(course.brain_path), body.model_dump())
    return await _exam_plan_payload(course, db)
