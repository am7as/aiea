"""ARQ jobs — render an exam to LaTeX and compile it to PDF.

Worker-side: builds <workshop>/exams/<exam_id>/exam.tex from the exam's
ordered questions, copies their figure PNGs alongside, and shells out to
`tectonic` to produce exam.pdf.
"""
from __future__ import annotations

import logging
import shutil
import subprocess
import uuid
from pathlib import Path

from sqlalchemy import select

from app.db.base import SessionLocal
from app.db.models import Course, Exam, ExamQuestion, Question
from app.export.latex import (
    build_exam_master_tex,
    build_questions_tex,
    read_exam_template,
)
from app.generate.translate import translate_question_sv
from app.validate.store import open_blocking
from app.vault.questions import question_dir, question_figures_dir

log = logging.getLogger(__name__)


_EXAM_ORIGINS = {"reference", "generated"}


def _exam_origin_slug(origin: str | None) -> str:
    o = (origin or "").strip().lower()
    return o if o in _EXAM_ORIGINS else "generated"


def exam_dir(workshop: Path, exam: Exam) -> Path:
    """<workshop>/exams/<origin>/<exam_id>/"""
    return workshop / "exams" / _exam_origin_slug(exam.origin) / str(exam.id)


def _exam_dir(workshop: Path, exam_id: uuid.UUID, origin: str | None = "generated") -> Path:
    return workshop / "exams" / _exam_origin_slug(origin) / str(exam_id)


def _sync_template_files(edir: Path, template: dict, force: bool = False) -> None:
    """Copy .sty / .tex files from the materials template into the exam folder.

    By default, only files that don't already exist locally get copied —
    user edits to per-exam copies are preserved. Pass force=True to clobber
    every template file (used by the "Reset template" path).
    Also rewrites `\\usepackage{../foo}` and `\\input{../foo}` ascending paths
    to bare names since everything lands in the same flat folder.
    """
    import re as _re

    rel_use = _re.compile(r"\\usepackage(\[[^\]]*\])?\{\.\./([^}]+)\}")
    rel_input = _re.compile(r"\\input\{\.\./([^}]+)\}")
    for f in template["dir"].iterdir():
        if not (f.is_file() and f.suffix.lower() in (".sty", ".tex")):
            continue
        dst = edir / f.name
        if dst.is_file() and not force:
            continue
        text = f.read_text(encoding="utf-8", errors="replace")
        text = rel_use.sub(
            lambda m: rf"\usepackage{m.group(1) or ''}{{{m.group(2)}}}",
            text,
        )
        text = rel_input.sub(lambda m: rf"\input{{{m.group(1)}}}", text)
        dst.write_text(text, encoding="utf-8")


async def reset_exam_template(ctx: dict, exam_id: str) -> dict:
    """ARQ task. Force-resync the template files + master exam.tex from
    materials/exam-template/, discarding the exam's local customizations."""
    async with SessionLocal() as session:
        eid = uuid.UUID(exam_id)
        exam = await session.get(Exam, eid)
        if exam is None:
            return {"status": "error", "error": "exam not found"}
        course = await session.get(Course, exam.course_id)
        if course is None or not course.workshop_path:
            return {"status": "error", "error": "course workshop_path is not configured"}
        materials = Path(course.materials_path) if course.materials_path else None
        template = read_exam_template(materials)
        edir = exam_dir(Path(course.workshop_path), exam)
        if not edir.is_dir():
            return {"status": "error", "error": "exam has not been rendered yet"}
        if template is not None:
            _sync_template_files(edir, template, force=True)
        # Reset exam.tex master too — questions get re-rendered on the next
        # render_exam call.
        meta = {
            "examdate": exam.created_at.strftime("%Y-%m-%d") if exam.created_at else exam.title,
            "besokstid": "",
            "visninga": "",
            "visningb": "",
        }
        master = build_exam_master_tex(
            exam.title, exam.instructions_md or "", template=template, meta=meta
        )
        (edir / "exam.tex").write_text(master, encoding="utf-8")
        sol_master = build_exam_master_tex(
            exam.title,
            exam.instructions_md or "",
            template=template,
            meta=meta,
            print_solutions=True,
        )
        (edir / "solution.tex").write_text(sol_master, encoding="utf-8")
        return {"status": "done"}


async def render_exam(ctx: dict, exam_id: str) -> dict:
    """ARQ task. Build exam.tex from the exam's questions + copied figures."""
    async with SessionLocal() as session:
        try:
            eid = uuid.UUID(exam_id)
            exam = await session.get(Exam, eid)
            if exam is None:
                return {"status": "error", "error": "exam not found"}
            course = await session.get(Course, exam.course_id)
            if course is None or not course.workshop_path:
                return {"status": "error", "error": "course workshop_path is not configured"}
            workshop = Path(course.workshop_path)
            brain = Path(course.brain_path) if course.brain_path else None
            materials = (
                Path(course.materials_path) if course.materials_path else None
            )
            template = read_exam_template(materials)

            rows = list(
                (
                    await session.execute(
                        select(ExamQuestion)
                        .where(ExamQuestion.exam_id == eid)
                        .order_by(ExamQuestion.position)
                    )
                )
                .scalars()
                .all()
            )

            edir = exam_dir(workshop, exam)
            # Wipe + recreate the figures/ and questions/ subfolders so a re-
            # render is reproducible. exam.tex and exam.pdf are overwritten
            # in-place. README.md is regenerated.
            figures_root = edir / "figures"
            qbundle_root = edir / "questions"
            for d in (figures_root, qbundle_root):
                if d.exists():
                    shutil.rmtree(d)
                d.mkdir(parents=True, exist_ok=True)
            edir.mkdir(parents=True, exist_ok=True)

            items: list[dict] = []
            bundle_lines: list[str] = []
            for eq in rows:
                question = await session.get(Question, eq.question_id)
                if question is None:
                    continue
                qfig = question_figures_dir(workshop, question, brain)
                dest = figures_root / str(question.id)
                if qfig.is_dir():
                    shutil.copytree(qfig, dest, dirs_exist_ok=True)
                # Also drop the full question folder (question.md / answer.md /
                # feedback.md / figures/) into questions/<pos>-<id>/ so the
                # exam folder is a complete self-contained bundle.
                qsrc = question_dir(workshop, question, brain)
                if qsrc.is_dir():
                    bundle_dst = qbundle_root / f"q{eq.position:02d}-{question.id}"
                    shutil.copytree(qsrc, bundle_dst, dirs_exist_ok=True)
                    bundle_lines.append(
                        f"- **#{eq.position}** ({eq.points} pts · {question.kind}"
                        + (f" · D{question.difficulty}" if question.difficulty else "")
                        + f") — `{bundle_dst.relative_to(edir)}/question.md`"
                    )
                try:
                    sv = await translate_question_sv(session, question.id)
                except Exception as exc:  # noqa: BLE001
                    log.warning("SV translation failed for %s: %s", question.id, exc)
                    sv = ""
                items.append(
                    {
                        "prompt_md": question.prompt_md or "",
                        "prompt_md_sv": sv,
                        "answer_md": question.answer_md or "",
                        "worked_solution_md": question.worked_solution_md or "",
                        "points": eq.points,
                        "figures_dir": f"figures/{question.id}",
                    }
                )

            # Per-exam template copies (idempotent — preserves user edits).
            # Each exam owns its own .sty + instructions.tex once rendered;
            # the next rebuild does NOT clobber them. The user can edit
            # these via the in-app source editor for per-exam customization
            # (examiner line, dates, styling). To force a fresh copy, the
            # render must be invoked with reset_template=True (see below).
            reset_template = bool(ctx.get("reset_template")) if isinstance(ctx, dict) else False
            if template is not None:
                _sync_template_files(edir, template, force=reset_template)

            meta = {
                "examdate": exam.created_at.strftime("%Y-%m-%d") if exam.created_at else exam.title,
                "besokstid": "",
                "visninga": "",
                "visningb": "",
            }
            # exam.tex + solution.tex are master files — written only when
            # missing or when the caller explicitly asks for a reset. User
            # edits survive subsequent rebuilds.
            tex_path = edir / "exam.tex"
            sol_tex_path = edir / "solution.tex"
            if reset_template or not tex_path.is_file():
                master = build_exam_master_tex(
                    exam.title,
                    exam.instructions_md or "",
                    template=template,
                    meta=meta,
                )
                tex_path.write_text(master, encoding="utf-8")
            if reset_template or not sol_tex_path.is_file():
                sol_master = build_exam_master_tex(
                    exam.title,
                    exam.instructions_md or "",
                    template=template,
                    meta=meta,
                    print_solutions=True,
                )
                sol_tex_path.write_text(sol_master, encoding="utf-8")

            # _questions.tex always regenerates — it's the source of the
            # current question set (both exam.tex and solution.tex \input it).
            body = build_questions_tex(items, exam.instructions_md or "", template=template)
            (edir / "_questions.tex").write_text(body, encoding="utf-8")

            # README inside the exam folder for at-a-glance navigation.
            readme = [
                f"# {exam.title}",
                "",
                f"- Origin: **{exam.origin}**",
                f"- Total minutes: {exam.total_minutes}",
                f"- Questions: {len(items)}",
                f"- Total points: {sum(eq.points for eq in rows)}",
                "",
                "## Files",
                "",
                "- `exam.tex` — student exam (LaTeX). `exam.pdf` — compiled.",
                "- `solution.tex` — exam **with worked solutions**. `solution.pdf` — compiled.",
                "- `_questions.tex` — the question bodies (shared by both masters).",
                "- `instructions.tex` — the SSY300 cover/instructions block.",
                "- `examSSY300.sty`, `nmcircuitikz.sty` — the style packages (self-contained here).",
                "- `figures/<question-id>/` — every figure referenced by each question.",
                "- `questions/q<pos>-<id>/` — the full bundle of each question (prompt, answer, feedback, figures).",
                "",
                "## Regenerate (self-contained — needs only this folder)",
                "",
                "```",
                "tectonic exam.tex        # -> exam.pdf  (student paper)",
                "tectonic solution.tex    # -> solution.pdf  (with solutions)",
                "```",
                "Any TeX engine with the `circuitikz`, `exsheets`, `tcolorbox`,",
                "`booktabs`, `adjustbox`, `pgfplots`, `siunitx` packages works.",
                "",
                "## Questions",
                "",
                *bundle_lines,
                "",
            ]
            (edir / "README.md").write_text("\n".join(readme), encoding="utf-8")

            exam.tex_path = str(tex_path)
            await session.commit()
            return {"status": "done", "tex_path": str(tex_path), "questions": len(items)}
        except Exception as exc:  # noqa: BLE001
            log.exception("render_exam failed for exam %s", exam_id)
            return {"status": "error", "error": str(exc)}


def _run_tectonic(exam_dir: Path, tex_filename: str) -> tuple[bool, str]:
    """Run tectonic on a single .tex file. Returns (ok, error_message)."""
    try:
        proc = subprocess.run(
            ["tectonic", tex_filename],
            cwd=str(exam_dir),
            capture_output=True,
            timeout=180,
        )
    except FileNotFoundError:
        return False, "tectonic is not installed in the worker"
    except subprocess.TimeoutExpired:
        return False, f"tectonic timed out after 180s on {tex_filename}"
    if proc.returncode != 0:
        stderr = (proc.stderr or b"").decode("utf-8", errors="replace")
        return False, f"{tex_filename}: {stderr.strip()[-3500:] or 'tectonic failed'}"
    return True, ""


async def compile_exam_pdf(ctx: dict, exam_id: str) -> dict:
    """ARQ task. Compile exam.tex → exam.pdf AND solution.tex → solution.pdf."""
    async with SessionLocal() as session:
        try:
            eid = uuid.UUID(exam_id)
            exam = await session.get(Exam, eid)
            if exam is None:
                return {"status": "error", "error": "exam not found"}
            if not exam.tex_path:
                return {"status": "error", "error": "exam has not been rendered — run render first"}
            tex_path = Path(exam.tex_path)
            if not tex_path.is_file():
                return {"status": "error", "error": f"exam.tex missing on disk: {tex_path}"}
            edir = tex_path.parent

            # The gate. A defective paper must not be able to become a PDF, because a
            # PDF is what gets emailed to the exam department. Overriding is allowed —
            # it is the examiner's paper — but it has to be a deliberate act with a
            # stated reason, recorded on the exam.
            blocking = await open_blocking(session, eid)
            if blocking and not exam.validation_override_reason:
                titles = [f.title for f in blocking[:5]]
                return {
                    "status": "blocked",
                    "findings": len(blocking),
                    "error": (
                        f"{len(blocking)} unresolved blocking finding(s). Fix them, or "
                        "override with a reason on the exam."
                    ),
                    "titles": titles,
                }

            ok, err = _run_tectonic(edir, "exam.tex")
            if not ok:
                return {"status": "error", "error": err}
            pdf_path = edir / "exam.pdf"
            if not pdf_path.is_file():
                return {"status": "error", "error": "tectonic exited 0 but produced no exam.pdf"}
            exam.pdf_path = str(pdf_path)

            # Solutions PDF — compiled when solution.tex exists. Failure is
            # logged but does NOT fail the whole compile (the exam.pdf is
            # the critical artefact; solutions are a nice-to-have).
            solution_tex = edir / "solution.tex"
            solution_warn: str | None = None
            if solution_tex.is_file():
                ok2, err2 = _run_tectonic(edir, "solution.tex")
                if ok2:
                    sol_pdf = edir / "solution.pdf"
                    if sol_pdf.is_file():
                        exam.solution_pdf_path = str(sol_pdf)
                    else:
                        solution_warn = "tectonic exited 0 but produced no solution.pdf"
                else:
                    solution_warn = err2
            else:
                solution_warn = "no solution.tex — re-render to create it"

            exam.status = "rendered"
            await session.commit()

            # Reference exam with a source PDF in materials → auto-trigger
            # the AI reproduction-comparison so the score lands in the row
            # without a second user click. Skip if the source isn't on disk.
            if (
                exam.origin == "reference"
                and exam.source_pdf_path
                and Path(exam.source_pdf_path).is_file()
            ):
                try:
                    from app.queue import enqueue

                    await enqueue("compare_reproduction_job", str(exam.id))
                except Exception as exc:  # noqa: BLE001
                    log.warning("auto compare_reproduction_job enqueue failed: %s", exc)

            result: dict[str, object] = {"status": "done", "pdf_path": str(pdf_path)}
            if exam.solution_pdf_path:
                result["solution_pdf_path"] = exam.solution_pdf_path
            if solution_warn:
                result["solution_warning"] = solution_warn
            return result
        except Exception as exc:  # noqa: BLE001
            log.exception("compile_exam_pdf failed for exam %s", exam_id)
            return {"status": "error", "error": str(exc)}
