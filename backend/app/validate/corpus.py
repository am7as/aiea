"""Per-course corpus index, tiered by where a material sits in the four-folder model.

The whole point of the tiering is that "is this term taught?" cannot be answered by a
model — every term a generator invents is *plausible*. It can only be answered by
counting the term in what the course actually hands out. `Material.collection` already
carries that, so no per-course configuration is needed.

Worker- and api-safe: pure stdlib + SQLAlchemy, no heavy parsers.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.course import Course, Material
from app.vault.writer import final_dir

Tier = Literal["taught", "formula", "pastexam", "textbook", "other"]
Verdict = Literal["taught", "formula", "pastexam", "textbook", "absent"]

#: Where a material's `collection` puts it. `lectures` + `exercises` are what the
#: course actually teaches; `book` is available to the student but never taught from.
_COLLECTION_TIER: dict[str, Tier] = {
    "lectures": "taught",
    "exercises": "taught",
    "exams": "pastexam",
    "book": "textbook",
    "exam-template": "formula",
    "other": "other",
}

#: Examiners file loosely — on the course this was built against, the solutions manual
#: and the textbook exercise book both sat in `other`, which would have let every
#: textbook-only term pass as merely "absent". So collection is a default, and these
#: name hints override it. Kept generic: edition markers and "solutions manual" are
#: universal book signals, not course-specific ones.
_FORMULA_HINTS = ("formelsamling", "formelblad", "formula", "formulary", "formelsammlung")

_TEXTBOOK_HINTS = (
    "solutions_manual", "solutions manual", "solution_manual", "solution manual",
    "lösningsmanual", "losningsmanual", "textbook", "errata", "instructor",
)

#: e.g. `Exercises_4ed.pdf`, `Alciatore 5th ed`, `_3rd_edition_`
_EDITION_RE = re.compile(r"(?:^|[_\s-])\d+\s*(?:ed|nd|rd|th)\b|edition", re.I)

#: Order matters — the first tier with a hit wins in `classify`.
_VERDICT_ORDER: tuple[Tier, ...] = ("taught", "formula", "pastexam", "textbook")


def strip_frontmatter(text: str) -> str:
    """Drop a leading YAML frontmatter block.

    Four modules re-implement this inline (generator, category_discovery, harvest,
    exam_analyze); this is the shared version.
    """
    if not text.startswith("---"):
        return text
    end = text.find("\n---", 3)
    return text[end + 4 :] if end != -1 else text


def _tier_for(material: Material) -> Tier:
    name = f"{material.subpath} {material.title} {material.original_filename}".lower()
    collection = (material.collection or "other").lower()
    if any(h in name for h in _FORMULA_HINTS):
        return "formula"
    # Only reclassify loosely-filed material; never override an explicit lectures/
    # exercises filing, since that is the examiner stating what they teach from.
    if collection in ("other", ""):
        if any(h in name for h in _TEXTBOOK_HINTS) or _EDITION_RE.search(name):
            return "textbook"
    return _COLLECTION_TIER.get(collection, "other")


def tier_summary(corpus: "Corpus") -> list[tuple[Tier, list[str]]]:
    """Which document landed in which tier — surfaced in the UI so an examiner can
    see and correct the classification instead of trusting it blindly."""
    groups: dict[Tier, list[str]] = {}
    for d in corpus.docs:
        groups.setdefault(d.tier, []).append(d.title)
    order: tuple[Tier, ...] = ("taught", "formula", "pastexam", "textbook", "other")
    return [(t, sorted(groups[t])) for t in order if t in groups]


@dataclass(frozen=True)
class CorpusDoc:
    material_id: uuid.UUID
    title: str
    tier: Tier
    text: str


@dataclass
class Corpus:
    """Every extracted material for one course, grouped by tier."""

    course_id: uuid.UUID
    docs: list[CorpusDoc] = field(default_factory=list)
    _lowered: dict[uuid.UUID, str] = field(default_factory=dict, repr=False)

    def __post_init__(self) -> None:
        if not self._lowered:
            self._lowered = {d.material_id: d.text.lower() for d in self.docs}

    @property
    def is_empty(self) -> bool:
        return not any(d.text.strip() for d in self.docs)

    def counts(self, term: str) -> dict[Tier, int]:
        """Occurrences of `term` per tier, case-insensitive, whole-word where possible."""
        pat = _term_pattern(term)
        out: dict[Tier, int] = {}
        for d in self.docs:
            n = len(pat.findall(self._lowered[d.material_id]))
            if n:
                out[d.tier] = out.get(d.tier, 0) + n
        return out

    def sources(self, term: str, tier: Tier | None = None) -> list[str]:
        """Titles of the documents containing `term`, optionally restricted to a tier."""
        pat = _term_pattern(term)
        return [
            d.title
            for d in self.docs
            if (tier is None or d.tier == tier) and pat.search(self._lowered[d.material_id])
        ]

    def classify(self, term: str) -> tuple[Verdict, dict[Tier, int]]:
        """Verdict for one term plus the evidence that produced it.

        `taught` and `formula` are fine — the student has met the term or carries it
        into the hall. `pastexam` is acceptable precedent. `textbook` means the term
        exists only in a book the course never teaches from, and `absent` means it
        exists nowhere. Both of the latter are defects.
        """
        counts = self.counts(term)
        for tier in _VERDICT_ORDER:
            if counts.get(tier):
                return tier, counts
        return "absent", counts


_PATTERN_CACHE: dict[str, re.Pattern[str]] = {}


def _term_pattern(term: str) -> re.Pattern[str]:
    key = term.lower()
    pat = _PATTERN_CACHE.get(key)
    if pat is None:
        esc = re.escape(key)
        # Whole-word only when the term starts and ends alphanumerically; terms like
        # "tau = L/R" or "dB/decade" must match literally.
        left = r"\b" if key[:1].isalnum() else ""
        right = r"\b" if key[-1:].isalnum() else ""
        pat = re.compile(left + esc + right)
        _PATTERN_CACHE[key] = pat
    return pat


async def load_corpus(db: AsyncSession, course_id: uuid.UUID) -> Corpus:
    """Read every completed extraction for a course into a tiered index."""
    course = await db.get(Course, course_id)
    if course is None:
        raise ValueError("course not found")
    workshop = Path(course.workshop_path) if course.workshop_path else None

    rows = list(
        (
            await db.execute(
                select(Material).where(
                    Material.course_id == course_id,
                    Material.extraction_status == "done",
                )
            )
        )
        .scalars()
        .all()
    )

    docs: list[CorpusDoc] = []
    for m in rows:
        text = ""
        if workshop is not None:
            path = final_dir(workshop, m.id) / "extracted.md"
            if path.is_file():
                try:
                    text = strip_frontmatter(path.read_text(encoding="utf-8", errors="replace"))
                except OSError:
                    text = ""
        if not text:
            text = m.extracted_text or ""
        if not text.strip():
            continue
        docs.append(
            CorpusDoc(
                material_id=m.id,
                title=m.title or m.original_filename or m.subpath,
                tier=_tier_for(m),
                text=text,
            )
        )
    return Corpus(course_id=course_id, docs=docs)


def _read_term_file(brain_path: Path | None, name: str) -> set[str]:
    if brain_path is None:
        return set()
    path = brain_path / "validation" / name
    if not path.is_file():
        return set()
    out: set[str] = set()
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.split("#", 1)[0].strip().strip("-* ").strip("`")
        if line:
            out.add(line.lower())
    return out


def load_allowlist(brain_path: Path | None) -> set[str]:
    """Terms the examiner has accepted, from `<brain>/validation/allow-terms.md`.

    One term per line; `#` comments, list bullets and backticks are stripped. This is
    how a lecturer overrides the corpus without touching code.
    """
    return _read_term_file(brain_path, "allow-terms.md")


def load_denylist(brain_path: Path | None) -> set[str]:
    """Terms the examiner has ruled out, from `<brain>/validation/deny-terms.md`.

    Corpus counts alone cannot separate imported terminology (`load line`) from
    ordinary composition of taught words (`source voltage`) — both are absent from the
    taught material and both are built from taught words. That call is semantic, so
    the deterministic tier only warns. Once an examiner (or the `syllabus-audit`
    reviewer) has ruled on a term, it lands here and blocks from then on.
    """
    return _read_term_file(brain_path, "deny-terms.md")
