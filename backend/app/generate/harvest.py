"""Harvest individual questions out of an extracted exam / exercise sheet.

Resolves the `question-harvesting` task, feeds the material's final extracted
markdown to the model, and turns the returned questions into Question rows
with origin="harvested". Worker-side — the api only enqueues it.

Beyond the bare AI call, this module:
  * Strips leading exercise labels (`**Problem 4.2**`, `**Fråga 5**`, …) out of
    the body and stashes them in `source_ref` so question.md prose starts with
    the actual question.
  * Copies any `![…](attachments/page-NNN-MM.png)` figure references the model
    preserved into the question's `figures/` folder and rewrites the markdown.
  * Captures Swedish translations into `Question.translation_sv` when the
    source is bilingual SE/EN.
  * Sets `source_material_ids` + `source_pages` for back-traceability.
  * Skips harvesting when a sibling material (same stem, different extension —
    e.g. tenta202508.pdf vs tenta202508.tex) has already been harvested for
    this course, avoiding duplicate rows.
"""
from __future__ import annotations

import logging
import re
import shutil
import uuid
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.events import ChatMessage, GenParams
from app.ai.jsonparse import extract_array
from app.ai.router import resolve
from app.db.models import Course, Material, Question
from app.vault.questions import question_figures_dir, write_question_md
from app.vault.writer import final_dir, version_dir

log = logging.getLogger(__name__)

_HARVEST_CAP = 60_000
_VALID_KINDS = {"mcq", "short", "essay", "problem", "code", "true_false"}

_OUTPUT_SPEC = """## Task

The text below is an extracted exam or exercise sheet (may be bilingual SE/EN).
Identify every distinct question / exercise it contains and return them as a
strict JSON array — no prose, no code fences, no commentary.

Each element is one question object with exactly these keys:

{
  "source_label": "<exercise number/title, e.g. 'Problem 4.2', 'Extra Assignment 8.1c', 'Fråga 5'. Empty string if none.>",
  "page": <1-indexed page number where the question begins, integer or null>,
  "prompt_md": "<question body in markdown (ENGLISH version only when bilingual). LaTeX as $...$.>",
  "prompt_md_sv": "<Swedish translation when the source is bilingual SE/EN; empty string otherwise>",
  "answer_md": "<answer / worked solution if the sheet provides one, else empty string>",
  "category": "<short topic label, or null>",
  "kind": "mcq | short | essay | problem | code | true_false"
}

## Rules (recap of the question-harvesting skill — read it before answering)

1. Transcribe faithfully. Math, units, numbers, variable names — copy exactly.
2. Source labels (`Problem 4.2`, `Fråga 5`, `Extra Assignment 8.1c`) go in
   `source_label`. They MUST NOT appear in `prompt_md`. Drop `[5 p]` / `[5 marks]`
   point markers from the body too.
3. Preserve every `![Figure ...](attachments/page-NNN-MM.png)` image reference
   that belongs to your question. They are real PNGs on disk; dropping them
   loses the figure forever.
4. Bilingual source → split EN into `prompt_md`, SE into `prompt_md_sv`.
   Monolingual source → leave `prompt_md_sv` as "".
5. Sub-parts (a), (b), (c) inside one exercise stay together inside one
   `prompt_md`, with `**(a)**`/`**(b)**` headers. Different exercise base
   numbers → separate questions.
6. Capture the starting page from `## Page N` headers in the extract.
7. Return ONLY the JSON array.
"""

# Match leading-label patterns the model might still leave in the body. Two
# forms covered:
#  - bold:   **Problem 4.2 in the Book** [5 p]
#  - heading: ## Problem 9.10 in the Book
# Both end at the first newline. Label keywords are English + Swedish.
_LABEL_KEYWORD = r"(?:problem|exercise|extra\ assignment|extra\ uppgift|uppgift|fr[åa]ga|question|task)"

_LEADING_LABEL = re.compile(
    rf"""^\s*
        (?:
            \#{{1,6}}\s+(?P<heading>{_LABEL_KEYWORD}[^\n]{{0,160}})\s*(?:\n+|$)
          |
            \*\*\s*(?P<bold>{_LABEL_KEYWORD}[^\*\n]{{0,160}})\s*\*\*
            \.?                                # optional trailing dot
            (?:\s*\[[^\]\n]+\])?              # optional [5 p] / [5 marks]
            \s*                                # spaces / newlines before the body
        )
    """,
    re.IGNORECASE | re.VERBOSE,
)

# Drop point markers anywhere on the first line: "[5 p]", "[2 marks]", "(3 pts)".
_INLINE_POINTS = re.compile(r"\s*[\[(]\s*\d+\s*(?:p|pts?|poäng|marks?)\s*[\])]\s*", re.IGNORECASE)

# An attachment image reference inside the body.
_ATTACHMENT_REF = re.compile(r"!\[([^\]]*)\]\(attachments/([^)\s]+)\)")


def _read_extracted(workshop: Path, material_id: uuid.UUID) -> tuple[str, Path | None]:
    """Read a material's final extracted markdown and locate its attachments dir.

    Returns (text, attachments_dir_or_None). The attachments dir is the sibling
    `attachments/` of whichever extracted.md we used; PNGs referenced in the
    body live there.
    """
    for f in (
        final_dir(workshop, material_id) / "extracted.md",
        version_dir(workshop, material_id, "ai") / "extracted.md",
    ):
        if f.exists():
            text = f.read_text(encoding="utf-8")
            if text.startswith("---"):
                end = text.find("\n---", 3)
                if end != -1:
                    text = text[end + 4 :]
            if text.strip():
                attach = f.parent / "attachments"
                return text.strip(), (attach if attach.is_dir() else None)
    return "", None


def _strip_leading_label(body: str) -> tuple[str, str]:
    """Remove a leading **Problem X.Y** / **Fråga N** label from the body.

    Returns (clean_body, extracted_label). When no label is found, label is "".
    Idempotent — safe to call on text that has no label.
    """
    m = _LEADING_LABEL.match(body)
    if not m:
        return body, ""
    raw = m.group("heading") or m.group("bold") or ""
    label = re.sub(r"\s+", " ", raw).strip().rstrip(".")
    body = body[m.end():].lstrip()
    return body, label


def _strip_points_markers(body: str) -> str:
    """Drop `[5 p]` / `(2 marks)` style point annotations from the first line."""
    if "\n" in body:
        first, rest = body.split("\n", 1)
    else:
        first, rest = body, ""
    first = _INLINE_POINTS.sub(" ", first).strip()
    return first + ("\n" + rest if rest else "")


def _copy_figures(body: str, attachments_dir: Path | None, target_dir: Path) -> str:
    """Copy referenced attachment PNGs into target_dir/ and rewrite refs.

    Replaces `![alt](attachments/page-006-02.png)` → `![alt](figures/page-006-02.png)`
    and copies the PNG. Missing source files are left as broken refs in markdown
    but a warning is logged so they show up clearly.
    """
    if attachments_dir is None:
        # Drop attachment refs entirely if we have no source dir — they'd render
        # as broken images otherwise.
        return _ATTACHMENT_REF.sub("", body)
    target_dir.mkdir(parents=True, exist_ok=True)
    copied: set[str] = set()

    def _swap(m: re.Match[str]) -> str:
        alt, name = m.group(1), m.group(2)
        src = attachments_dir / name
        dst = target_dir / name
        if not src.is_file():
            log.warning("harvest: attachment missing on disk: %s", src)
            return ""
        if name not in copied:
            try:
                shutil.copy2(src, dst)
                copied.add(name)
            except OSError as exc:
                log.warning("harvest: failed to copy %s → %s: %s", src, dst, exc)
                return ""
        return f"![{alt}](figures/{name})"

    return _ATTACHMENT_REF.sub(_swap, body)


async def _sibling_already_harvested(
    db: AsyncSession, material: Material
) -> Material | None:
    """If a sibling material (same stem, different ext) is already harvested
    for this course, return it. Used to skip .pdf↔.tex pair duplication."""
    name = material.original_filename or ""
    stem, dot, ext = name.rpartition(".")
    if not dot:
        return None
    sibling_exts = {"pdf": "tex", "tex": "pdf"}
    other_ext = sibling_exts.get(ext.lower())
    if not other_ext:
        return None
    sibling_name = f"{stem}.{other_ext}"
    sibling = (
        await db.execute(
            select(Material).where(
                Material.course_id == material.course_id,
                Material.original_filename == sibling_name,
            )
        )
    ).scalar_one_or_none()
    if sibling is None:
        return None
    # Has the sibling produced harvested questions yet? Check by filename in
    # source_ref since source_material_ids may not have been set on older rows.
    count = (
        await db.execute(
            select(func.count())
            .select_from(Question)
            .where(
                Question.course_id == material.course_id,
                Question.origin == "harvested",
                Question.source_ref.like(f"{sibling_name}%"),
            )
        )
    ).scalar_one()
    return sibling if count and count > 0 else None


async def harvest_questions(db: AsyncSession, material_id: uuid.UUID) -> list[uuid.UUID]:
    """Extract questions from one material's extracted markdown into Question rows."""
    material = await db.get(Material, material_id)
    if material is None:
        raise ValueError("material not found")
    course = await db.get(Course, material.course_id)
    if course is None or not course.workshop_path:
        raise ValueError("course workshop_path is not configured")
    workshop = Path(course.workshop_path)
    brain = Path(course.brain_path) if course.brain_path else None

    sibling = await _sibling_already_harvested(db, material)
    if sibling is not None:
        log.info(
            "harvest skipped: sibling %s already harvested (same stem as %s)",
            sibling.original_filename,
            material.original_filename,
        )
        return []

    corpus, attachments_dir = _read_extracted(workshop, material_id)
    if not corpus:
        corpus = (material.extracted_text or "").strip()
    if not corpus:
        raise ValueError("material has no extracted text — extract it first")

    resolution = await resolve(db, "question-harvesting")
    if resolution is None:
        raise ValueError("no AI route for question-harvesting and no default route")

    system = _OUTPUT_SPEC
    if resolution.system_prompt:
        system += "\n\n---\n\n" + resolution.system_prompt

    user = (
        "Extract every question from this exam / exercise sheet.\n\n"
        f"=== {material.title or material.original_filename} ===\n\n"
        + corpus[:_HARVEST_CAP]
    )

    result = await resolution.provider.complete(
        [ChatMessage(role="user", content=user)],
        model=resolution.model,
        system=system,
        params=GenParams(
            temperature=resolution.params.temperature,
            max_tokens=max(resolution.params.max_tokens, 4096),
        ),
    )

    items = extract_array(result.text)
    created: list[uuid.UUID] = []
    src_name = material.original_filename or "unknown"
    for it in items:
        prompt_md = str(it.get("prompt_md") or "").strip()
        if not prompt_md:
            continue
        kind = str(it.get("kind") or "short").strip().lower()
        if kind not in _VALID_KINDS:
            kind = "short"

        # Post-process: pull labels out of the body that the model leaked
        # despite the prompt, and drop trailing point markers.
        prompt_md, leaked_label = _strip_leading_label(prompt_md)
        prompt_md = _strip_points_markers(prompt_md)
        answer_md = str(it.get("answer_md") or "").strip()
        answer_md, _ = _strip_leading_label(answer_md)

        # Reconcile model-supplied label vs the leaked one — prefer model label.
        source_label = str(it.get("source_label") or "").strip() or leaked_label

        # Pages — accept int or list-of-int. The model is asked for the start
        # page; we store it as a single-element list to match the schema.
        page = it.get("page")
        source_pages: list[int] = []
        if isinstance(page, int):
            source_pages = [page]
        elif isinstance(page, list):
            source_pages = [int(p) for p in page if isinstance(p, int)]

        # Bilingual split.
        translation_sv = str(it.get("prompt_md_sv") or "").strip() or None

        q = Question(
            course_id=material.course_id,
            kind=kind,
            status="generated",
            prompt_md=prompt_md,
            answer_md=answer_md,
            category=(str(it["category"]).strip() if it.get("category") else None),
            origin="harvested",
            created_by=f"harvest:{src_name}",
            source_ref=(f"{src_name} — {source_label}" if source_label else src_name),
            source_material_ids=[str(material.id)],
            source_pages=source_pages,
            translation_sv=translation_sv,
            vault_path="",
        )
        db.add(q)
        await db.flush()

        # Copy referenced figures into the question's figures/ folder and
        # rewrite the markdown refs from attachments/… → figures/…
        fdir = question_figures_dir(workshop, q, brain)
        q.prompt_md = _copy_figures(q.prompt_md, attachments_dir, fdir)
        if q.answer_md:
            q.answer_md = _copy_figures(q.answer_md, attachments_dir, fdir)
        if q.translation_sv:
            q.translation_sv = _copy_figures(q.translation_sv, attachments_dir, fdir)

        q.vault_path = str(write_question_md(workshop, q, brain))
        created.append(q.id)

    await db.commit()
    log.info("harvested %d questions from material %s", len(created), material_id)
    return created
