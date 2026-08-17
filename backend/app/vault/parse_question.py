"""Read a question's vault markdown back into the DB — the inverse of `render_question_md`.

Everything in AIEA flows DB -> disk: `write_question_md` has nine call sites and
`render_exam` regenerates `_questions.tex` from the DB on every run. That means an
examiner who edits `question.md` in Obsidian, or fixes a rendered exam by hand, loses
the edit at the next write. This module is the missing direction.

Parsing is deliberately strict about structure and lenient about content: a heading that
is not recognised is left alone rather than guessed at, because silently mis-importing an
answer key is far worse than importing nothing.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from app.db.models import Question

_H2 = re.compile(r"^##\s+(.+?)\s*$", re.M)

#: Heading -> Question column. Keys are lowercased; both languages of the headings
#: `render_question_md` and `render_answer_md` emit are covered.
_PROMPT_SECTIONS = {
    "prompt": "prompt_md",
    "swedish translation": "translation_sv",
}
_ANSWER_SECTIONS = {
    "answer": "answer_md",
    "worked solution": "worked_solution_md",
}

#: Placeholders the renderer writes for empty fields — never import these as content.
_PLACEHOLDERS = {"_(empty)_", "_(none)_", ""}


@dataclass
class ParsedQuestion:
    fields: dict[str, str] = field(default_factory=dict)
    distractors: list[str] = field(default_factory=list)
    unknown_sections: list[str] = field(default_factory=list)


def _strip_frontmatter(text: str) -> str:
    if not text.startswith("---"):
        return text
    end = text.find("\n---", 3)
    return text[end + 4 :] if end != -1 else text


def _sections(text: str) -> dict[str, str]:
    """Split a markdown body into `## heading` -> body."""
    out: dict[str, str] = {}
    matches = list(_H2.finditer(text))
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        out[m.group(1).strip().lower()] = text[m.end() : end].strip()
    return out


def parse_question_md(text: str) -> ParsedQuestion:
    parsed = ParsedQuestion()
    for heading, body in _sections(_strip_frontmatter(text)).items():
        if heading in _PROMPT_SECTIONS:
            if body not in _PLACEHOLDERS:
                parsed.fields[_PROMPT_SECTIONS[heading]] = body
        elif heading == "distractors":
            parsed.distractors = [
                line.lstrip("-* ").strip()
                for line in body.splitlines()
                if line.strip().startswith(("-", "*"))
            ]
        else:
            parsed.unknown_sections.append(heading)
    return parsed


def parse_answer_md(text: str) -> ParsedQuestion:
    parsed = ParsedQuestion()
    for heading, body in _sections(text).items():
        if heading in _ANSWER_SECTIONS:
            if body not in _PLACEHOLDERS:
                parsed.fields[_ANSWER_SECTIONS[heading]] = body
        elif heading == "evaluation":
            # Regenerated from score columns on every write — never import it back, or
            # the italic score line would be re-parsed as evaluation prose and compound.
            continue
        else:
            parsed.unknown_sections.append(heading)
    return parsed


def read_question_folder(folder: Path) -> ParsedQuestion:
    """Parse `question.md` + `answer.md` from one question folder."""
    merged = ParsedQuestion()
    qfile = folder / "question.md"
    if qfile.is_file():
        parsed = parse_question_md(qfile.read_text(encoding="utf-8", errors="replace"))
        merged.fields.update(parsed.fields)
        merged.distractors = parsed.distractors
        merged.unknown_sections += parsed.unknown_sections
    afile = folder / "answer.md"
    if afile.is_file():
        parsed = parse_answer_md(afile.read_text(encoding="utf-8", errors="replace"))
        merged.fields.update(parsed.fields)
        merged.unknown_sections += parsed.unknown_sections
    return merged


def diff_against(q: Question, parsed: ParsedQuestion) -> dict[str, dict[str, str]]:
    """What would change if `parsed` were applied to `q`. Empty means already in sync."""
    out: dict[str, dict[str, str]] = {}
    for name, incoming in parsed.fields.items():
        current = (getattr(q, name, "") or "").strip()
        if incoming.strip() != current:
            out[name] = {
                "before": current,
                "after": incoming.strip(),
                "before_chars": str(len(current)),
                "after_chars": str(len(incoming.strip())),
            }
    return out


def apply_parsed(q: Question, parsed: ParsedQuestion) -> list[str]:
    """Write parsed fields onto the row. Returns the names of the columns changed."""
    changed: list[str] = []
    for name, incoming in parsed.fields.items():
        current = (getattr(q, name, "") or "").strip()
        if incoming.strip() != current:
            setattr(q, name, incoming.strip())
            changed.append(name)
    if parsed.distractors and parsed.distractors != (q.distractors or []):
        q.distractors = parsed.distractors
        changed.append("distractors")
    return changed
