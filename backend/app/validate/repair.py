"""Repair defects the validator found.

Two paths, deliberately separated by whether the fix has a single correct answer:

* **deterministic** — `$o$` -> `$\\to$`, an in-text total that contradicts its header.
  Applied directly, with the before/after recorded on the finding so it can be undone.
* **judgement** — rewording an untaught term, moving a leaked answer out of a stem.
  Sent to the `question-repair` task and returned as a *proposal*. Never auto-applied,
  because a plausible rewrite that changes what the question asks is worse than the
  defect it replaces.

Everything writes through `write_question_md`, so the DB and the vault copy never drift.
"""

from __future__ import annotations

import logging
import re
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.events import ChatMessage, GenParams
from app.ai.jsonparse import extract_object
from app.ai.router import resolve
from app.db.models import Course, Question
from app.db.models.exam import ValidationFinding
from app.skills.loader import build_skill_prompt
from app.vault.questions import write_question_md

log = logging.getLogger(__name__)

#: Fields a repair may touch, in the order they are shown to a reviewer.
_FIELDS = ("prompt_md", "answer_md", "worked_solution_md", "translation_sv")


@dataclass
class RepairResult:
    applied: bool = False
    proposal: dict[str, str] = field(default_factory=dict)
    change_summary: str = ""
    blocked_reason: str = ""
    diff: str = ""


def _short_diff(field_name: str, before: str, after: str, radius: int = 60) -> str:
    """A compact, human-checkable record of what changed."""
    if before == after:
        return ""
    i = 0
    while i < min(len(before), len(after)) and before[i] == after[i]:
        i += 1
    j = 0
    while (
        j < min(len(before), len(after)) - i
        and before[len(before) - 1 - j] == after[len(after) - 1 - j]
    ):
        j += 1
    start = max(0, i - radius)
    return (
        f"{field_name}:\n"
        f"  - …{before[start : len(before) - j + radius]}…\n"
        f"  + …{after[start : len(after) - j + radius]}…"
    )


# ── deterministic repairs ─────────────────────────────────────────────────────


def _fix_mangled_math(q: Question, finding: ValidationFinding) -> dict[str, str]:
    token = str(finding.evidence.get("token") or "")
    if not token:
        return {}
    # Tolerate whitespace inside the span: the mangling that produces these often leaves
    # the eaten escape behind as a literal tab or space.
    pattern = re.compile(rf"\$\s*{re.escape(token)}\s*\$")
    out: dict[str, str] = {}
    for name in _FIELDS:
        current = getattr(q, name) or ""
        fixed = pattern.sub(f"$\\\\{token}$", current)
        if fixed != current:
            out[name] = fixed
    return out


#: control character -> the escape letter it consumed (mirrors rules._CONTROL_TO_ESCAPE)
_CONTROL_TO_ESCAPE = {"\t": "t", "\x08": "b", "\x0c": "f", "\x0b": "v", "\x07": "a"}


def _fix_escaped_control(q: Question, finding: ValidationFinding) -> dict[str, str]:
    """Put back the backslash the escape-expansion ate.

    Exact rather than inferred: a literal tab inside math was `\\t`, so re-emitting
    `\\t` and rejoining the following letters restores the original command.
    """
    letter = str(finding.evidence.get("control") or "")
    ch = next((c for c, l in _CONTROL_TO_ESCAPE.items() if l == letter), None)
    if ch is None:
        return {}
    out: dict[str, str] = {}
    for name in _FIELDS:
        current = getattr(q, name) or ""
        if ch not in current:
            continue
        # Only touch occurrences inside math, so a tab used for layout survives.
        def _repl(m: re.Match[str]) -> str:
            body = m.group(0)
            return body.replace(ch, f"\\{letter}") if ch in body else body

        fixed = re.sub(r"\$\$.+?\$\$|\$.+?\$", _repl, current, flags=re.S)
        if fixed != current:
            out[name] = fixed
    return out


def _fix_intext_total(q: Question, finding: ValidationFinding) -> dict[str, str]:
    """Make a printed total agree with the header it contradicts."""
    lang = str(finding.evidence.get("lang") or "EN")
    wrong = finding.evidence.get("total")
    right = finding.evidence.get("points")
    if not isinstance(wrong, int) or not isinstance(right, int):
        return {}
    word = "marks?" if lang == "EN" else "poäng"
    label = "Total" if lang == "EN" else "Totalt"
    pattern = re.compile(rf"({label}:\s*){wrong}(\s*{word})", re.I)
    current = q.prompt_md or ""
    fixed = pattern.sub(rf"\g<1>{right}\g<2>", current)
    return {"prompt_md": fixed} if fixed != current else {}


#: rule_id -> deterministic repair. Anything not listed here needs judgement.
_DETERMINISTIC = {
    "latex.escaped-control": _fix_escaped_control,
    "latex.mangled-math": _fix_mangled_math,
    "structure.marks": _fix_intext_total,
}


def can_auto_fix(finding: ValidationFinding) -> bool:
    return finding.rule_id in _DETERMINISTIC and bool(finding.auto_fixable)


# ── judgement repairs ─────────────────────────────────────────────────────────


async def _propose(db: AsyncSession, q: Question, finding: ValidationFinding) -> RepairResult:
    course = await db.get(Course, q.course_id)
    if course is None or not course.workshop_path:
        raise ValueError("course workshop_path is not configured")
    brain = Path(course.brain_path) if course.brain_path else None

    resolution = await resolve(db, "question-repair")
    if resolution is None:
        raise ValueError("no AI route for question-repair and no default route")

    system = build_skill_prompt(["question-repair"], brain)
    if not system:
        raise ValueError("runtime skill 'question-repair' not found")
    tone = build_skill_prompt(["anti-ai-tone"], brain)
    if tone:
        system += "\n\n---\n\n" + tone
    if resolution.system_prompt:
        system += "\n\n---\n\n" + resolution.system_prompt

    replacement = str((finding.evidence or {}).get("replacement") or "")
    parts = [
        "## The defect to fix",
        "",
        f"Rule: `{finding.rule_id}` ({finding.severity})",
        f"Title: {finding.title}",
        "",
        finding.detail_md or "",
    ]
    if replacement:
        parts += ["", f"The course's own wording for this is: **{replacement}**"]
    parts += ["", "## Question", "", q.prompt_md or ""]
    if q.translation_sv:
        parts += ["", "## Translation", "", q.translation_sv]
    parts += ["", "## Answer key", "", q.answer_md or "_(none)_"]
    if q.worked_solution_md:
        parts += ["", "## Worked solution", "", q.worked_solution_md]

    result = await resolution.provider.complete(
        [ChatMessage(role="user", content="\n".join(parts))],
        model=resolution.model,
        system=system,
        params=GenParams(
            temperature=resolution.params.temperature,
            max_tokens=max(resolution.params.max_tokens, 4096),
        ),
    )
    data = extract_object(result.text)

    proposal = {
        name: str(data.get(name) or "").strip()
        for name in _FIELDS
        if str(data.get(name) or "").strip()
    }
    return RepairResult(
        applied=False,
        proposal=proposal,
        change_summary=str(data.get("change_summary") or "").strip(),
        blocked_reason=str(data.get("blocked_reason") or "").strip(),
    )


# ── entry point ───────────────────────────────────────────────────────────────


async def repair_finding(
    db: AsyncSession, finding_id: uuid.UUID, *, apply_proposal: bool = False
) -> RepairResult:
    """Fix one finding.

    Deterministic rules are applied immediately. Everything else returns a proposal,
    unless `apply_proposal` is set — which is what the UI's "accept" button does after
    a human has read the diff.
    """
    finding = await db.get(ValidationFinding, finding_id)
    if finding is None:
        raise ValueError("finding not found")
    if finding.question_id is None:
        raise ValueError("this finding is not attached to a question")
    q = await db.get(Question, finding.question_id)
    if q is None:
        raise ValueError("question not found")
    course = await db.get(Course, q.course_id)
    if course is None or not course.workshop_path:
        raise ValueError("course workshop_path is not configured")

    changes: dict[str, str] = {}
    result = RepairResult()

    if can_auto_fix(finding):
        changes = _DETERMINISTIC[finding.rule_id](q, finding)
        result.change_summary = f"deterministic fix for {finding.rule_id}"
        if not changes:
            result.blocked_reason = "the pattern this rule repairs was not found in the text"
            return result
    else:
        result = await _propose(db, q, finding)
        if result.blocked_reason:
            finding.resolution_note = result.blocked_reason
            await db.commit()
            return result
        if not apply_proposal:
            return result  # proposal only — a human accepts it
        changes = dict(result.proposal)

    diffs = []
    for name, after in changes.items():
        before = getattr(q, name) or ""
        diffs.append(_short_diff(name, before, after))
        setattr(q, name, after)

    workshop = Path(course.workshop_path)
    brain = Path(course.brain_path) if course.brain_path else None
    q.vault_path = str(write_question_md(workshop, q, brain))

    finding.status = "fixed"
    finding.fix_diff = "\n".join(d for d in diffs if d)[:8000]
    if result.change_summary:
        finding.resolution_note = result.change_summary
    await db.commit()

    result.applied = True
    result.diff = finding.fix_diff
    log.info("repaired finding %s (%s) on question %s", finding_id, finding.rule_id, q.id)
    return result
