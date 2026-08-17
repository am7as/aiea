"""One-shot migration to the folder-per-question vault layout.

Walks all known on-disk shapes and moves them to the current target:

    workshop/questions/<origin>/<category>/<id>/{question.md, answer.md,
                                                 feedback.md, figures/}

where <origin> is `harvested` or `ai-generated`. Recognises three prior shapes:
  1. flat:        questions/<cat>/<id>.md + questions/<cat>/figures/<id>/
  2. folder v1:   questions/<cat>/<id>/{question.md, figures/}
  3. target:      questions/<origin>/<cat>/<id>/{...}  (skipped)

Run inside the api / worker container:
    docker compose -f infra/docker-compose.yml exec api \
        pixi run python -m app.scripts.migrate_question_layout

Idempotent. Also rewrites legacy figure references in markdown
(`figures/<id>/foo.png` → `figures/foo.png`).
"""
from __future__ import annotations

import asyncio
import logging
import re
import shutil
import uuid
from pathlib import Path

from sqlalchemy import select

from app.db.base import SessionLocal
from app.db.models import Course, Question
from app.vault.questions import (
    category_slug,
    origin_slug,
    question_dir,
    questions_dir,
    write_question_md,
)

log = logging.getLogger("migrate_question_layout")


def _rewrite_legacy_figures(text: str | None, question_id: str) -> str | None:
    """Drop the `<id>/` segment from figure paths so the new layout resolves."""
    if not text:
        return text
    return re.sub(
        rf"(\]\(\s*figures)/{re.escape(question_id)}/", r"\1/", text
    )


async def _migrate_course(course: Course) -> dict[str, int]:
    if not course.workshop_path:
        return {"moved": 0, "skipped": 0}
    workshop = Path(course.workshop_path)
    qroot = questions_dir(workshop)
    if not qroot.is_dir():
        return {"moved": 0, "skipped": 0}

    moved = 0
    skipped = 0
    brain = Path(course.brain_path) if course.brain_path else None
    async with SessionLocal() as session:
        rows = list(
            (
                await session.execute(
                    select(Question).where(Question.course_id == course.id)
                )
            )
            .scalars()
            .all()
        )

        for q in rows:
            cat = category_slug(q.category)
            origin = origin_slug(q.origin)
            qid = str(q.id)

            qdir = question_dir(workshop, q, brain)
            # Legacy locations we might find this question's bundle in.
            #  v0 — flat:   questions/<cat>/<id>.md + questions/<cat>/figures/<id>/
            #  v1 — folder: questions/<cat>/<id>/{question.md, figures/}
            #  v2 — origin: questions/<origin>/<cat>/<id>/{...}  (no chapter)
            flat_md = qroot / cat / f"{qid}.md"
            flat_figs = qroot / cat / "figures" / qid
            folder_v1 = qroot / cat / qid
            folder_v2 = qroot / origin / cat / qid

            already_target = (qdir / "question.md").is_file()
            has_flat_md = flat_md.is_file()
            has_flat_figs = flat_figs.is_dir()
            has_folder_v1 = (folder_v1 / "question.md").is_file()
            has_folder_v2 = (
                folder_v2 != qdir and (folder_v2 / "question.md").is_file()
            )

            if not (
                has_flat_md
                or has_flat_figs
                or has_folder_v1
                or has_folder_v2
                or already_target
            ):
                skipped += 1
                continue

            qdir.mkdir(parents=True, exist_ok=True)

            for src_folder in (folder_v2, folder_v1):
                if not src_folder.is_dir() or src_folder == qdir:
                    continue
                for src in src_folder.rglob("*"):
                    if src.is_file():
                        rel = src.relative_to(src_folder)
                        dest = qdir / rel
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        if not dest.exists():
                            shutil.move(str(src), str(dest))
                shutil.rmtree(src_folder, ignore_errors=True)

            if has_flat_figs:
                target_figs = qdir / "figures"
                target_figs.mkdir(exist_ok=True)
                for png in flat_figs.glob("*.png"):
                    dest = target_figs / png.name
                    if not dest.exists():
                        shutil.move(str(png), str(dest))
                shutil.rmtree(flat_figs, ignore_errors=True)

            # Rewrite figure paths inside the DB row's markdown fields.
            for field in (
                "prompt_md",
                "answer_md",
                "worked_solution_md",
                "evaluation_md",
                "feedback_md",
                "translation_sv",
            ):
                if not hasattr(q, field):
                    continue
                new = _rewrite_legacy_figures(getattr(q, field), qid)
                if new is not None and new != getattr(q, field):
                    setattr(q, field, new)

            q.vault_path = str(qdir / "question.md")
            write_question_md(workshop, q, brain)

            if has_flat_md:
                try:
                    flat_md.unlink(missing_ok=True)
                except OSError:
                    pass
            moved += 1

        await session.commit()

        # Cleanup pass: empty legacy holders at every level.
        for child in qroot.iterdir():
            if not child.is_dir() or child.name in {"harvested", "generated"}:
                continue
            holder = child / "figures"
            if holder.is_dir() and not any(holder.iterdir()):
                try:
                    holder.rmdir()
                except OSError:
                    pass
            if not any(child.iterdir()):
                try:
                    child.rmdir()
                except OSError:
                    pass

    return {"moved": moved, "skipped": skipped}


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    async with SessionLocal() as session:
        courses = list((await session.execute(select(Course))).scalars().all())
    total_moved = 0
    total_skipped = 0
    for c in courses:
        if not c.workshop_path:
            log.info("skip course %s (no workshop_path)", c.code or c.id)
            continue
        result = await _migrate_course(c)
        total_moved += result["moved"]
        total_skipped += result["skipped"]
        log.info(
            "course %s: moved=%d, no-on-disk=%d",
            c.code or c.id, result["moved"], result["skipped"],
        )
    log.info("done. total moved=%d, untouched=%d", total_moved, total_skipped)


if __name__ == "__main__":
    asyncio.run(main())
