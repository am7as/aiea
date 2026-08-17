"""Question generation against extracted course material.

Resolves the `question-generation` task, feeds page-aware material text plus
syllabus context to the model, and turns the result into draft Question rows
and markdown files. Worker-side logic — the api only enqueues it.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.events import ChatMessage, GenParams
from app.ai.jsonparse import extract_array
from app.ai.router import resolve
from app.db.models import Course, Material, Question
from app.generate.circuit_resolver import resolve_circuit_figure
from app.generate.figures import FIGURE_KINDS, render_figure
from app.generate.figure_refine import refine_figure
from app.skills.loader import build_skill_prompt
from app.vault.questions import question_figures_dir, write_question_md
from app.vault.syllabus import read_syllabus
from app.vault.writer import final_dir

log = logging.getLogger(__name__)

_DEFAULT_SKILLS = [
    "question-generation", "bloom-taxonomy", "difficulty-rubric", "question-figures",
    "anti-ai-tone", "exam-tone-and-marks", "scientific-writing",
]
# Sub-skills loaded only when the generator is asked for diagrams. The model
# picks the relevant ones per question — together they teach engineering-
# correct rendering rules across the major domains.
_FIGURE_SUB_SKILLS = [
    "circuit-drawing",
    "digital-logic",
    "timing-diagram",
    "transistor-circuits",
    "response-plots",
]
_FIG_PLACEHOLDER = re.compile(r"\[\[FIG:([^\]]+)\]\]")
_PER_MATERIAL_CAP = 9_000
_TOTAL_CAP = 30_000

_OUTPUT_SPEC = """## Output format

Return ONLY a JSON array — no prose, no explanation, no code fences.
Each element is one question object with these keys:
{
  "kind": "mcq",
  "prompt_md": "the question stem in markdown, LaTeX as $...$",
  "answer_md": "the correct answer / answer key",
  "distractors": ["wrong option", "..."],
  "worked_solution_md": "step-by-step solution, or null",
  "difficulty": 1,
  "bloom": "understand",
  "est_minutes": 3,
  "topics": ["topic name"],
  "elo_ids": ["elo1"],
  "source_material_ids": ["<material id from the materials provided>"],
  "source_pages": [4],
  "figures": []
}

`distractors` must be [] for non-MCQ / non-true_false types.
`worked_solution_md` must be null unless the type is problem or code.
Cite real page numbers that appear in the materials.

`figures`: when the question needs a diagram (timing diagram, circuit, plot),
add figure objects here and reference each with a placeholder line `[[FIG:<id>]]`
inside prompt_md / worked_solution_md / answer_md. Each figure object:
  {"id": "fig1", "kind": "timing|schemdraw|matplotlib", "spec": "<spec>"}
See the question-figures skill for the spec format of each kind. A blank
timing template referenced from prompt_md; the solved figure only from the
solution. Tabular data stays a Markdown table — never a figure. Use [] when
the question needs no figure.

Generate exactly COUNT questions."""


@dataclass
class GenSpec:
    course_id: uuid.UUID
    material_ids: list[uuid.UUID]
    kind: str
    count: int
    difficulty: int | None = None
    bloom: str | None = None
    topics: list[str] | None = None
    chapter_id: str | None = None
    category: str | None = None
    with_diagrams: bool = True


def _as_int(value: object) -> int | None:
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _material_corpus(workshop: Path, m: Material) -> str:
    f = final_dir(workshop, m.id) / "extracted.md"
    text = ""
    if f.exists():
        text = f.read_text(encoding="utf-8")
        if text.startswith("---"):
            end = text.find("\n---", 3)
            if end != -1:
                text = text[end + 4 :]
    if not text.strip():
        text = m.extracted_text or ""
    return text.strip()[:_PER_MATERIAL_CAP]


def _syllabus_context(syllabus: dict | None, chapter_id: str | None) -> str:
    if not syllabus or not syllabus.get("exists"):
        return ""
    chapters = syllabus.get("chapters") or []
    elos = syllabus.get("elos") or []
    lines: list[str] = []
    if chapter_id:
        ch = next((c for c in chapters if str(c.get("id")) == chapter_id), None)
        if ch:
            lines.append(f"Target chapter {ch.get('id')}: {ch.get('title')}")
            wanted = {str(e) for e in (ch.get("elos") or [])}
            for e in elos:
                if str(e.get("id")) in wanted:
                    lines.append(f"  ELO {e.get('id')}: {e.get('text')} (bloom: {e.get('bloom')})")
    if not lines:
        lines.append("Expected learning outcomes — tag each question with the elo_ids it covers:")
        for e in elos:
            lines.append(f"  {e.get('id')}: {e.get('text')}")
    return "\n".join(lines)


def _render_question_figures(
    workshop: Path, q: Question, figures: object, brain: Path | None
) -> tuple[dict[str, str], list[tuple[str, str, Path]]]:
    """Render each figure spec to a PNG.

    Returns (rendered, refinable) where `rendered` maps figure id → markdown
    path, and `refinable` is a list of (kind, spec_str, png_path) for the
    figures that rendered successfully and are candidates for the vision
    self-correction pass.
    """
    if not isinstance(figures, list):
        return {}, []
    fdir = question_figures_dir(workshop, q, brain)
    fdir.mkdir(parents=True, exist_ok=True)
    rendered: dict[str, str] = {}
    refinable: list[tuple[str, str, Path]] = []
    for fig in figures:
        if not isinstance(fig, dict):
            continue
        fid = str(fig.get("id") or "").strip()
        kind = str(fig.get("kind") or "").strip()
        spec = fig.get("spec")
        if not fid or kind not in FIGURE_KINDS or spec is None:
            continue
        spec_str = spec if isinstance(spec, str) else json.dumps(spec)
        png = fdir / f"{fid}.png"
        try:
            render_figure(kind, spec_str, png)
            rendered[fid] = f"figures/{fid}.png"
            refinable.append((kind, spec_str, png))
        except Exception as exc:  # noqa: BLE001
            log.warning(
                "question %s figure %r (%s) failed: %r | spec=%.400s",
                q.id, fid, kind, exc, spec_str,
            )
    return rendered, refinable


def _apply_figure_placeholders(q: Question, rendered: dict[str, str]) -> None:
    """Swap [[FIG:id]] placeholders in the question markdown for image links."""

    def _sub(m: re.Match) -> str:
        rel = rendered.get(m.group(1).strip())
        return f"![figure]({rel})" if rel else ""

    for field in ("prompt_md", "answer_md", "worked_solution_md"):
        val = getattr(q, field, None)
        if val:
            setattr(q, field, _FIG_PLACEHOLDER.sub(_sub, val))


#: Feeding every material into one job is the documented cause of generation
#: timeouts — a job that carries the whole course burns its budget and dies, while a
#: focused one returns in minutes. The UI has no material picker and sends everything,
#: so the narrowing has to happen here.
_MAX_MATERIALS = 4

#: Above this even a deliberate selection is narrowed — past it the job reliably burns
#: its whole budget and dies, so honouring the request would just fail differently.
_DELIBERATE_CEILING = 8

#: Fallback ordering when there is no usage history to learn from: what the course
#: teaches from beats what it merely references.
_COLLECTION_RANK = {"lectures": 0, "exercises": 1, "exam-template": 2, "exams": 3, "book": 4}


async def _select_materials(
    db: AsyncSession, spec: GenSpec, materials: list[Material]
) -> list[Material]:
    """Narrow a *blanket* material selection down to the ones relevant to this chapter.

    The course's own history is the evidence: materials that previously sourced
    questions for this chapter are the ones that actually cover it. That signal is
    derived per course, so this carries to any course without configuration. With no
    history, fall back to preferring taught material over reference material.

    Only a blanket selection is narrowed. An examiner who deliberately picks six
    materials means it, and silently dropping two of them would be worse than the slow
    job this exists to prevent — so a deliberate subset is respected up to the point
    where the job would certainly time out anyway.
    """
    if len(materials) <= _MAX_MATERIALS:
        return materials

    total_ready = (
        await db.execute(
            select(func.count(Material.id)).where(
                Material.course_id == spec.course_id,
                Material.extraction_status == "done",
            )
        )
    ).scalar_one()

    blanket = len(materials) >= total_ready
    if not blanket and len(materials) <= _DELIBERATE_CEILING:
        log.info(
            "generation: honouring a deliberate selection of %d materials (not narrowing)",
            len(materials),
        )
        return materials

    usage: dict[uuid.UUID, int] = {}
    if spec.chapter_id:
        rows = (
            await db.execute(
                select(Question.source_material_ids).where(
                    Question.course_id == spec.course_id,
                    Question.chapter_id == spec.chapter_id,
                )
            )
        ).scalars().all()
        for ids in rows:
            for raw in ids or []:
                try:
                    mid = uuid.UUID(str(raw))
                except (ValueError, AttributeError):
                    continue
                usage[mid] = usage.get(mid, 0) + 1

    def rank(m: Material) -> tuple[int, int, str]:
        return (
            -usage.get(m.id, 0),
            _COLLECTION_RANK.get((m.collection or "").lower(), 9),
            m.title or "",
        )

    chosen = sorted(materials, key=rank)[:_MAX_MATERIALS]
    log.info(
        "generation: narrowed %d materials to %d for chapter %s — %s",
        len(materials),
        len(chosen),
        spec.chapter_id or "(none)",
        ", ".join(f"{m.title}({usage.get(m.id, 0)})" for m in chosen),
    )
    return chosen


async def run_generation(db: AsyncSession, spec: GenSpec) -> list[uuid.UUID]:
    course = await db.get(Course, spec.course_id)
    if course is None:
        raise ValueError("course not found")
    if not course.workshop_path:
        raise ValueError("course workshop_path is not configured")
    workshop = Path(course.workshop_path)
    brain = Path(course.brain_path) if course.brain_path else None

    res = await db.execute(
        select(Material).where(
            Material.course_id == spec.course_id,
            Material.id.in_(spec.material_ids),
            Material.extraction_status == "done",
        )
    )
    materials = list(res.scalars().all())
    if not materials:
        raise ValueError("no extracted materials selected")

    materials = await _select_materials(db, spec, materials)

    resolution = await resolve(db, "question-generation")
    if resolution is None:
        raise ValueError("no AI route for question-generation and no default route")

    skills = list(resolution.active_skills or _DEFAULT_SKILLS)
    if not spec.with_diagrams and "question-figures" in skills:
        skills.remove("question-figures")
    elif spec.with_diagrams:
        # Append domain sub-skills (idempotent — already-present names are skipped).
        for sub in _FIGURE_SUB_SKILLS:
            if sub not in skills:
                skills.append(sub)
    system = build_skill_prompt(skills, brain)
    if resolution.system_prompt:
        system += "\n\n---\n\n" + resolution.system_prompt
    system += "\n\n---\n\n" + _OUTPUT_SPEC.replace("COUNT", str(spec.count))
    system += (
        "\n\n---\n\nWrite every question, answer key and worked solution in English, "
        "regardless of the language of the source material."
    )
    if not spec.with_diagrams:
        system += (
            "\n\n---\n\nThis batch must be solvable from text alone — do NOT emit any "
            "figures. Set \"figures\" to []. Describe any circuit or data fully in words "
            "and Markdown tables."
        )
    else:
        system += (
            "\n\n---\n\nEvery question in this batch MUST include at least one rendered "
            "figure. Use the question-figures skill: emit a `figures` array entry per "
            "question (kind `timing` for waveforms, `schemdraw` for circuits/gates/"
            "flip-flops, `matplotlib` for plots) and reference it from `prompt_md` with "
            "`[[FIG:<id>]]`. A circuit/timing/plot question without a figure is rejected. "
            "Only fall back to text if the topic genuinely has no visual element (rare)."
        )

    blocks: list[str] = []
    total = 0
    for m in materials:
        body = _material_corpus(workshop, m)
        if not body:
            continue
        block = (
            f"# Material: {m.title or m.original_filename}\n"
            f"(id: {m.id}, collection: {m.collection})\n\n{body}"
        )
        blocks.append(block)
        total += len(block)
        if total >= _TOTAL_CAP:
            break
    if not blocks:
        raise ValueError("selected materials have no extracted text")
    corpus = "\n\n".join(blocks)

    syllabus = read_syllabus(brain) if brain else None
    syll_ctx = _syllabus_context(syllabus, spec.chapter_id)

    constraints = [f"Question type: {spec.kind}", f"Number of questions: {spec.count}"]
    if spec.difficulty:
        constraints.append(f"Target difficulty: {spec.difficulty}/5")
    if spec.bloom:
        constraints.append(f"Target Bloom level: {spec.bloom}")
    if spec.topics:
        constraints.append(f"Focus topics: {', '.join(spec.topics)}")

    user = (
        "Generate exam questions strictly from the materials below.\n\n"
        + "\n".join(constraints)
        + "\n\n"
        + (f"Syllabus context:\n{syll_ctx}\n\n" if syll_ctx else "")
        + f"=== MATERIALS ===\n\n{corpus}"
    )

    result = await resolution.provider.complete(
        [ChatMessage(role="user", content=user)],
        model=resolution.model,
        system=system,
        params=GenParams(
            temperature=resolution.params.temperature,
            # figure-bearing generation emits spec blocks per question — needs headroom
            max_tokens=max(resolution.params.max_tokens, 8192),
        ),
    )

    try:
        items = extract_array(result.text)
    except Exception as exc:  # noqa: BLE001
        log.warning("generation JSON parse failed (%s). Raw output:\n%s", exc, result.text[:2500])
        raise
    valid_material_ids = {str(m.id) for m in materials}
    created: list[uuid.UUID] = []
    for it in items:
        prompt_md = str(it.get("prompt_md") or "").strip()
        if not prompt_md:
            continue
        q = Question(
            course_id=spec.course_id,
            kind=str(it.get("kind") or spec.kind),
            status="generated",
            prompt_md=prompt_md,
            answer_md=str(it.get("answer_md") or "").strip(),
            distractors=[str(d) for d in (it.get("distractors") or [])],
            worked_solution_md=(
                str(it["worked_solution_md"]).strip()
                if it.get("worked_solution_md")
                else None
            ),
            difficulty=_as_int(it.get("difficulty")),
            bloom=(str(it["bloom"]) if it.get("bloom") else None),
            est_minutes=_as_int(it.get("est_minutes")),
            topics=[str(t) for t in (it.get("topics") or [])],
            chapter_id=spec.chapter_id,
            category=spec.category
            or (str(it["category"]).strip() if it.get("category") else None),
            elo_ids=[str(e) for e in (it.get("elo_ids") or [])],
            source_material_ids=[
                str(x) for x in (it.get("source_material_ids") or []) if str(x) in valid_material_ids
            ],
            source_pages=[p for p in (it.get("source_pages") or []) if isinstance(p, int)],
            origin="ai-generated",
            created_by=f"ai:{resolution.model}",
            vault_path="",
        )
        db.add(q)
        await db.flush()
        rendered, refinable = await asyncio.to_thread(
            _render_question_figures, workshop, q, it.get("figures"), brain
        )
        # Deterministic circuit resolver: a hand-drawn (schemdraw) circuit is
        # replaced by a clean template render when its topology matches the
        # catalog — the model only had to NAME the topology + values, not draw.
        resolved: set = set()
        for kind, spec_str, png in refinable:
            if kind != "schemdraw":
                continue
            match = await resolve_circuit_figure(db, q.prompt_md, q.answer_md)
            if not match:
                continue
            tmpl, params = match
            try:
                await asyncio.to_thread(
                    render_figure, "circuit",
                    json.dumps({"template": tmpl, "params": params}), png,
                )
                resolved.add(png)
                log.info("circuit-resolver: %s -> template %s", png.name, tmpl)
            except Exception as exc:  # noqa: BLE001
                log.warning("circuit-resolver render failed (%s), keeping original: %s", tmpl, exc)
        # Vision self-correction on figures NOT replaced by a template.
        for kind, spec_str, png in refinable:
            if png in resolved:
                continue
            try:
                await refine_figure(db, kind, spec_str, png)
            except Exception as exc:  # noqa: BLE001
                log.warning("figure refinement skipped for %s: %s", png.name, exc)
        # Always run the substitution — even when `rendered` is empty. This
        # strips literal `[[FIG:id]]` tokens whose figure failed to render
        # instead of saving them as visible text in the prompt.
        _apply_figure_placeholders(q, rendered)
        q.vault_path = str(write_question_md(workshop, q, brain))
        created.append(q.id)

    await db.commit()
    log.info("generated %d questions for course %s", len(created), spec.course_id)
    return created
