"""Deterministic validation rules. No AI call, no network, reproducible.

Every rule here exists because it caught a real defect in a shipped exam. The
comment on each names the defect it would have stopped.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Literal

from app.validate.corpus import Corpus

Severity = Literal["blocking", "warning", "note"]


@dataclass(frozen=True)
class Finding:
    rule_id: str
    severity: Severity
    title: str
    detail_md: str
    evidence: dict = field(default_factory=dict)
    question_id: uuid.UUID | None = None
    auto_fixable: bool = False


@dataclass
class QuestionView:
    """Everything a rule needs about one question, decoupled from the ORM."""

    id: uuid.UUID
    prompt_md: str = ""
    answer_md: str = ""
    worked_solution_md: str = ""
    translation_sv: str = ""
    points: int | None = None
    figure_dir: Path | None = None
    #: figure source files (`.tex`, `.py`) keyed by filename — their baked-in text
    #: is invisible to any check that only reads the markdown.
    figure_sources: dict[str, str] = field(default_factory=dict)

    @property
    def key_text(self) -> str:
        return f"{self.answer_md}\n{self.worked_solution_md}"

    @property
    def all_text(self) -> str:
        return f"{self.prompt_md}\n{self.translation_sv}\n{self.key_text}"


# ── shared lexical helpers ────────────────────────────────────────────────────

_MATH_SPAN = re.compile(r"\$\$(.+?)\$\$|\$(.+?)\$", re.S)
_PART_LETTER = re.compile(r"(?:\\textbf\{)?\(([a-h])\)")
_SUBMARK = re.compile(r"\[(\d+)\s*(?:marks?|poäng|p)\]", re.I)
_TOTAL_EN = re.compile(r"\[?\s*Total:\s*(\d+)\s*marks?\s*\]?", re.I)
_TOTAL_SV = re.compile(r"\[?\s*Totalt:\s*(\d+)\s*poäng\s*\]?", re.I)
_INCLUDEGRAPHICS = re.compile(r"\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}")
_MD_IMAGE = re.compile(r"!\[[^\]]*\]\(([^)\s]+)\)")

#: LaTeX command names that, if their backslash is lost, become a bare word inside
#: math. `\to` -> `to` is how OCT-Q3's twelve arrows became italic letters.
_COMMAND_WORDS = {
    "to", "rightarrow", "leftarrow", "Rightarrow", "Leftarrow", "mapsto",
    "times", "cdot", "approx", "equiv", "neq", "ne", "leq", "le", "geq", "ge",
    "pm", "mp", "infty", "partial", "nabla", "sum", "prod", "int", "sqrt",
    "alpha", "beta", "gamma", "delta", "epsilon", "theta", "lambda", "mu",
    "pi", "rho", "sigma", "tau", "phi", "omega", "Omega", "Delta", "Phi",
    "text", "mathrm", "frac", "dfrac", "quad", "qquad", "angle", "degree",
}

_STOP = {
    # articles, prepositions, conjunctions
    "the", "a", "an", "of", "in", "on", "at", "to", "for", "with", "and", "or",
    "is", "are", "be", "as", "by", "from", "that", "this", "these", "those",
    "it", "its", "which", "when", "where", "how", "what", "each", "all", "both",
    "you", "your", "we", "they", "not", "no", "if", "then", "than", "so", "into",
    "there", "here", "any", "one", "two", "three", "four", "five", "per", "its",
    # modal / instruction verbs that pepper exam prose
    "can", "may", "must", "will", "shall", "should", "would", "give", "given",
    "gives", "show", "shows", "state", "find", "determine", "calculate", "sketch",
    "write", "express", "draw", "mark", "marks", "assume", "consider", "analyse",
    "analyze", "verify", "check", "hold", "holds", "held", "sit", "sits", "sitting",
    "take", "taken", "takes", "let", "have", "has", "had", "made", "make", "makes",
    "run", "runs", "drive", "drives", "driven", "feed", "fed", "carry", "carries",
    "appear", "appears", "become", "becomes", "remain", "remains", "start", "starts",
    "produce", "produces", "contain", "contains", "follow", "follows", "read", "reads",
    "obtain", "measure", "measured", "connect", "connected", "apply", "applied",
    # exam furniture
    "using", "use", "used", "below", "above", "shown", "figure", "figures",
    "value", "values", "answer", "answers", "question", "working", "all", "only",
    "png", "jpg", "img", "point", "points", "part", "parts", "total", "totalt",
    "same", "such", "other", "every", "also", "well", "over", "under", "during",
    "down", "through", "across", "along", "between", "within", "without", "about",
    "complete", "corresponding", "respective", "respectively", "following", "again",
    "left", "right", "upper", "lower", "first", "second", "third", "next", "last",
    "whole", "entire", "exact", "exactly", "approximately", "least", "most", "more",
    # Swedish equivalents
    "och", "som", "med", "för", "den", "det", "att", "är", "en", "ett", "på",
    "till", "vid", "av", "samt", "alla", "från", "genom", "har", "kan", "ska",
    "visa", "ange", "bestäm", "beräkna", "skissa", "skriv", "rita", "sedan",
    "nedan", "ovan", "varje", "vilken", "vilket", "eller", "inte", "både",
}

#: Free variables and constants so ubiquitous that their appearing only in the key is
#: no evidence of anything. Deliberately does NOT include letters an author might
#: press into service as a named coefficient (`c`, `u`, `b`) — that is the case worth
#: catching, and it is how OCT-Q4's key silently renamed `B` to `c`.
_SYMBOL_STOP = {"x", "y", "z", "t", "n", "i", "j", "k", "e", "d", "f", "s", "m", "g"}

#: Standard quantity symbols. An author may bring these in without defining them
#: (`P` for power, `Z` for impedance); a *lowercase* letter pressed into service as
#: a named coefficient is the case worth blocking on.
_STANDARD_QUANTITIES = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ")

#: SI units and unit-like tokens. These arrive as `\mathrm{A}` / `\text{ W}` and are
#: not symbols at all; treating them as such flagged Amperes, Watts and Volts as
#: undefined on almost every question.
_UNIT_TOKENS = {
    "A", "V", "W", "J", "N", "C", "F", "H", "S", "T", "K", "Hz", "kHz", "MHz",
    "GHz", "rad", "rpm", "krpm", "deg", "min", "kg", "mm", "cm", "km", "mA",
    "kV", "mV", "kW", "mW", "nF", "pF", "uF", "mH", "uH", "Nm", "Wb", "dB",
    "Omega", "ohm", "s", "ms", "us", "ns", "g", "m",
}

#: Groups whose contents are typeset text, not mathematics.
_TEXT_GROUP = re.compile(r"\\(?:mathrm|text|textrm|mathbf|operatorname)\s*\{[^{}]*\}")

#: Accents wrap the symbol they decorate, so `\hat{u}_o` must be read as `u_o`. Left
#: intact, the tokeniser reads `hat` as the base and strands `_o` as a symbol of its
#: own — which is exactly how a phantom `o` appeared on a question that has none.
_ACCENT = re.compile(r"\\(?:hat|bar|vec|tilde|dot|ddot|widehat|widetilde|overline)\s*\{([^{}]*)\}")


def _strip_math(text: str) -> str:
    return _MATH_SPAN.sub(" ", text)


def _math_spans(text: str) -> list[str]:
    return [(a or b or "") for a, b in _MATH_SPAN.findall(text)]


def _part_letters(text: str) -> set[str]:
    return {m.lower() for m in _PART_LETTER.findall(text)}


def intrinsic_marks(prompt_md: str) -> int | None:
    """The marks a question declares for itself, from its own sub-part labels.

    A question authored with `(a) … [3 marks]` `(b) … [2 marks]` is worth 5, whatever
    an exam blueprint later stamps on it. Assembling a paper without reconciling the
    two is how a `[5 p]` header ends up over sub-marks that sum to 14.
    """
    _, en = _split_languages(prompt_md)
    subs = [int(x) for x in _SUBMARK.findall(en or prompt_md)]
    return sum(subs) if subs else None


def _split_languages(prompt: str) -> tuple[str, str]:
    """Return (swedish, english) halves of a bilingual prompt, else ('', prompt)."""
    marker = re.search(r"\*\*EN\*\*:|\\textbf\{EN\}:", prompt)
    if not marker:
        return "", prompt
    return prompt[: marker.start()], prompt[marker.start() :]


# ── rules ─────────────────────────────────────────────────────────────────────


def rule_mangled_math(q: QuestionView, ctx: "RuleContext") -> list[Finding]:
    """A math span holding a bare LaTeX command name, or a repeated one-letter span
    used as a separator. Caught OCT-Q3's `AC1 $o$ D1 $o$ DC+ ...` (12 arrows)."""
    out: list[Finding] = []
    for label, text in (("prompt", q.prompt_md), ("key", q.key_text), ("sv", q.translation_sv)):
        if not text:
            continue
        hits: dict[str, int] = {}
        for span in _math_spans(text):
            token = span.strip()
            if token in _COMMAND_WORDS:
                hits[token] = hits.get(token, 0) + 1
        # A short lowercase span repeated 3+ times on one line is a separator, not a
        # variable — variables are not written three times in a row between words.
        for line in text.splitlines():
            per_line: dict[str, int] = {}
            for span in _math_spans(line):
                token = span.strip()
                if len(token) <= 2 and token.isalpha() and token.islower():
                    per_line[token] = per_line.get(token, 0) + 1
            for token, n in per_line.items():
                if n >= 3 and not _defines_symbol(text, token):
                    hits[token] = max(hits.get(token, 0), n)
        for token, n in hits.items():
            fix = f"\\{token}" if token in _COMMAND_WORDS else None
            out.append(
                Finding(
                    rule_id="latex.mangled-math",
                    severity="blocking",
                    title=f"`${token}$` in the {label} looks like a LaTeX command that lost its backslash",
                    detail_md=(
                        f"`${token}$` occurs {n}× in the {label}. It renders as an italic "
                        f"letter, not as a symbol."
                        + (f" Almost certainly `${fix}$`." if fix else "")
                    ),
                    evidence={"token": token, "count": n, "field": label},
                    question_id=q.id,
                    auto_fixable=fix is not None,
                )
            )
    return out


#: A control character standing where a LaTeX command should be is the fingerprint of a
#: string that went through an escape-expanding layer: `\to` becomes TAB + "o", `\nu`
#: becomes LF + "u". Newline and carriage return are excluded — they occur legitimately
#: inside display math, and the others never do.
_CONTROL_TO_ESCAPE = {
    "\t": "t",
    "\x08": "b",
    "\x0c": "f",
    "\x0b": "v",
    "\x07": "a",
}


def rule_escaped_control_char(q: QuestionView, ctx: "RuleContext") -> list[Finding]:
    """A LaTeX escape that was expanded as a string escape.

    This is what actually happened to OCT-Q3's arrows: `$\\to$` reached the database as
    `$<TAB>o$`, so it printed as an italic `o`. Naming the mechanism matters, because
    the repair is then exact — put the control character back as its escape letter —
    rather than a guess about which command was intended.
    """
    out: list[Finding] = []
    for label, text in (("prompt", q.prompt_md), ("key", q.key_text), ("sv", q.translation_sv)):
        if not text:
            continue
        # One finding per (field, control character) — not per span. The same mangling
        # usually hits every arrow in a list, and reporting twelve findings for one
        # defect buries everything else in the report.
        seen: dict[str, list[str]] = {}
        for span in _math_spans(text):
            for ch, letter in _CONTROL_TO_ESCAPE.items():
                if ch in span:
                    seen.setdefault(letter, []).append(span)
        for letter, spans in seen.items():
            ch = next(c for c, l in _CONTROL_TO_ESCAPE.items() if l == letter)
            rest = spans[0].split(ch, 1)[1].strip()
            guess = f"\\{letter}{rest.split()[0]}" if rest else f"\\{letter}"
            plural = f" ({len(spans)} occurrences)" if len(spans) > 1 else ""
            out.append(
                Finding(
                    rule_id="latex.escaped-control",
                    severity="blocking",
                    title=(
                        f"A control character sits inside math in the {label}{plural} — "
                        f"a LaTeX escape was expanded as a string escape"
                    ),
                    detail_md=(
                        f"The span `{spans[0][:40]!r}` contains a literal "
                        f"{'tab' if ch == chr(9) else repr(ch)}. It was almost "
                        f"certainly `{guess}` before something interpreted the "
                        f"backslash-{letter} as an escape sequence. It prints as an "
                        "italic letter, not as the symbol."
                    ),
                    evidence={
                        "field": label,
                        "control": letter,
                        "span": spans[0][:80],
                        "occurrences": len(spans),
                    },
                    question_id=q.id,
                    auto_fixable=True,
                )
            )
    return out


def rule_unbalanced_math(q: QuestionView, ctx: "RuleContext") -> list[Finding]:
    """Odd number of `$` or unbalanced braces — the paper will not compile, or will
    swallow the rest of the question into math mode."""
    out: list[Finding] = []
    for label, text in (("prompt", q.prompt_md), ("key", q.key_text), ("sv", q.translation_sv)):
        if not text:
            continue
        without_display = text.replace("$$", "")
        if without_display.count("$") % 2:
            out.append(
                Finding(
                    rule_id="latex.unbalanced",
                    severity="blocking",
                    title=f"Odd number of `$` in the {label}",
                    detail_md="An unclosed math span swallows the following text into math mode.",
                    evidence={"field": label},
                    question_id=q.id,
                )
            )
        if text.count("{") != text.count("}"):
            out.append(
                Finding(
                    rule_id="latex.unbalanced",
                    severity="blocking",
                    title=f"Unbalanced braces in the {label}",
                    detail_md=f"`{{` × {text.count('{')} vs `}}` × {text.count('}')}.",
                    evidence={"field": label},
                    question_id=q.id,
                )
            )
    return out


def rule_part_mismatch(q: QuestionView, ctx: "RuleContext") -> list[Finding]:
    """Part letters in the key that the question never asks, or vice versa.
    Caught OCT-Q5, whose key answered a (d) the question did not contain."""
    asked = _part_letters(q.prompt_md)
    answered = _part_letters(q.key_text)
    out: list[Finding] = []
    if not asked:
        return out
    orphan = sorted(answered - asked)
    if orphan:
        letters = ", ".join(f"({x})" for x in orphan)
        out.append(
            Finding(
                rule_id="structure.part-mismatch",
                severity="blocking",
                title=f"The answer key answers {letters}, which the question does not ask",
                detail_md=(
                    f"Question asks {', '.join(f'({x})' for x in sorted(asked))}; "
                    f"key answers {', '.join(f'({x})' for x in sorted(answered))}. "
                    "Either add the part to the question or delete it from the key."
                ),
                evidence={"asked": sorted(asked), "answered": sorted(answered)},
                question_id=q.id,
            )
        )
    missing = sorted(asked - answered)
    if missing and answered:
        letters = ", ".join(f"({x})" for x in missing)
        out.append(
            Finding(
                rule_id="structure.part-mismatch",
                severity="warning",
                title=f"No answer for {letters}",
                detail_md="The key does not visibly address every part the question asks.",
                evidence={"missing": missing},
                question_id=q.id,
            )
        )
    return out


def rule_marks(q: QuestionView, ctx: "RuleContext") -> list[Finding]:
    """Sub-marks must sum to the question's points, and any in-text total must agree,
    in both languages. Caught OCT-Q1's `(Total: 8 marks)` under a `[5 p]` header."""
    out: list[Finding] = []
    sv_half, en_half = _split_languages(q.prompt_md)
    halves = [("EN", en_half)] + ([("SE", sv_half)] if sv_half.strip() else [])

    for lang, half in halves:
        subs = [int(x) for x in _SUBMARK.findall(half)]
        totals = [int(x) for x in (_TOTAL_EN if lang == "EN" else _TOTAL_SV).findall(half)]
        if q.points is not None and subs and sum(subs) != q.points:
            out.append(
                Finding(
                    rule_id="structure.marks",
                    severity="blocking",
                    title=f"{lang} sub-marks sum to {sum(subs)} but the question is worth {q.points}",
                    detail_md=f"Sub-marks found: {subs}.",
                    evidence={"lang": lang, "subs": subs, "points": q.points},
                    question_id=q.id,
                )
            )
        for total in totals:
            if q.points is not None and total != q.points:
                out.append(
                    Finding(
                        rule_id="structure.marks",
                        severity="blocking",
                        title=f"{lang} in-text total says {total}, header says {q.points}",
                        detail_md="The printed total contradicts the question header.",
                        evidence={"lang": lang, "total": total, "points": q.points},
                        question_id=q.id,
                        auto_fixable=True,
                    )
                )
    return out


def rule_bilingual_symmetry(q: QuestionView, ctx: "RuleContext") -> list[Finding]:
    """The two languages must ask the same thing. Caught OCT-Q4, whose EN stem carried
    `[Total: 6 marks]` while the SE stem had no total at all."""
    sv_half, en_half = _split_languages(q.prompt_md)
    if not sv_half.strip():
        return []
    out: list[Finding] = []
    sv_parts, en_parts = _part_letters(sv_half), _part_letters(en_half)
    if sv_parts != en_parts:
        out.append(
            Finding(
                rule_id="bilingual.asymmetry",
                severity="warning",
                title="The two languages do not list the same parts",
                detail_md=f"SE: {sorted(sv_parts)} · EN: {sorted(en_parts)}.",
                evidence={"se": sorted(sv_parts), "en": sorted(en_parts)},
                question_id=q.id,
            )
        )
    sv_total = bool(_TOTAL_SV.search(sv_half))
    en_total = bool(_TOTAL_EN.search(en_half))
    if sv_total != en_total:
        has, lacks = ("EN", "SE") if en_total else ("SE", "EN")
        out.append(
            Finding(
                rule_id="bilingual.asymmetry",
                severity="warning",
                title=f"{has} prints a total but {lacks} does not",
                detail_md="Both languages should state the same total.",
                evidence={"has": has, "lacks": lacks},
                question_id=q.id,
                auto_fixable=True,
            )
        )
    sv_subs = [int(x) for x in _SUBMARK.findall(sv_half)]
    en_subs = [int(x) for x in _SUBMARK.findall(en_half)]
    if sv_subs != en_subs:
        out.append(
            Finding(
                rule_id="bilingual.asymmetry",
                severity="warning",
                title="Sub-marks differ between the languages",
                detail_md=f"SE: {sv_subs} · EN: {en_subs}.",
                evidence={"se": sv_subs, "en": en_subs},
                question_id=q.id,
            )
        )
    return out


def rule_figures_missing(q: QuestionView, ctx: "RuleContext") -> list[Finding]:
    """Every referenced image must exist on disk."""
    if q.figure_dir is None:
        return []
    refs = set(_MD_IMAGE.findall(q.all_text)) | set(_INCLUDEGRAPHICS.findall(q.all_text))
    out: list[Finding] = []
    for ref in sorted(refs):
        name = ref.split("/")[-1]
        if not (q.figure_dir / name).is_file():
            out.append(
                Finding(
                    rule_id="figures.missing",
                    severity="blocking",
                    title=f"Referenced figure `{name}` does not exist",
                    detail_md=f"`{ref}` is referenced but `{q.figure_dir / name}` is missing.",
                    evidence={"ref": ref},
                    question_id=q.id,
                )
            )
    return out


def rule_figures_orphan(q: QuestionView, ctx: "RuleContext") -> list[Finding]:
    """A PNG nothing references. Harmless in print, but it is usually a stale figure
    that contradicts the current wording."""
    if q.figure_dir is None or not q.figure_dir.is_dir():
        return []
    refs = {r.split("/")[-1] for r in _MD_IMAGE.findall(q.all_text)}
    refs |= {r.split("/")[-1] for r in _INCLUDEGRAPHICS.findall(q.all_text)}
    out: list[Finding] = []
    for png in sorted(q.figure_dir.glob("*.png")):
        if png.name not in refs:
            out.append(
                Finding(
                    rule_id="figures.orphan",
                    severity="note",
                    title=f"`{png.name}` is not referenced by this question",
                    detail_md="Stale figures usually contradict the current wording — delete or reference it.",
                    evidence={"file": png.name},
                    question_id=q.id,
                )
            )
    return out


def _defines_symbol(text: str, symbol: str) -> bool:
    """Does the text introduce `symbol`, i.e. `$B = ...$` or `$B$ = friction`?"""
    esc = re.escape(symbol)
    return bool(re.search(rf"{esc}\s*(?:=|\\?=)", text) or re.search(rf"\${esc}\$\s*[=:]", text))


_SYMBOL_TOKEN = re.compile(r"\\?([A-Za-z]{1,12})(?:_\{([^}]{1,12})\}|_([A-Za-z0-9]))?")


def _symbols(text: str) -> set[str]:
    out: set[str] = set()
    for span in _math_spans(text):
        # Units are typeset as text; strip those groups before looking for symbols.
        span = _TEXT_GROUP.sub(" ", span)
        # Unwrap accents so the decorated symbol, not the accent command, is read.
        for _ in range(3):
            span, n = _ACCENT.subn(r"\1", span)
            if not n:
                break
        for m in _SYMBOL_TOKEN.finditer(span):
            base, sub_b, sub_c = m.group(1), m.group(2), m.group(3)
            if base in _COMMAND_WORDS and not (sub_b or sub_c):
                continue
            if base in _UNIT_TOKENS and not (sub_b or sub_c):
                continue
            if base.lower() in {"mathrm", "text", "frac", "dfrac", "cdot", "times", "left", "right"}:
                continue
            sub = sub_b or sub_c or ""
            out.add(f"{base}_{sub}" if sub else base)
    return out


def rule_symbols_undefined(q: QuestionView, ctx: "RuleContext") -> list[Finding]:
    """A symbol the key leans on but the question never introduces. Caught OCT-Q4's
    key computing with `c` where the question defines `B`.

    Derived notation is normal and must not fire: a key that writes `P_{R_1}` for the
    power in `R_1` has invented nothing, because the *base* letter and the subscript
    are both anchored in the question. So the test is on the base letter, not on the
    full symbol, and a base that never appears in the question at all is the signal.
    """
    if not q.prompt_md or not q.key_text:
        return []
    prompt_syms = _symbols(q.prompt_md) | _symbols(q.translation_sv)
    prompt_bases = {s.split("_")[0] for s in prompt_syms}
    out: list[Finding] = []
    reported: set[str] = set()

    for sym in sorted(_symbols(q.key_text) - prompt_syms):
        base = sym.split("_")[0]
        if base in prompt_bases or base in reported or base in ctx.suppress_symbols:
            continue
        if len(base) > 1 and not base.startswith("\\"):
            continue  # multi-letter words are prose leaking out of a math span
        if base.lower() in _SYMBOL_STOP:
            continue
        if sym.endswith("_") or sym.rstrip().endswith("_"):
            continue  # subscript was a text group (a unit), not a symbol
        uses = len(re.findall(rf"(?<![A-Za-z]){re.escape(base)}(?![A-Za-z])", q.key_text))
        if uses < 3:
            continue
        reported.add(base)
        # An uppercase letter is a standard quantity symbol — a key may introduce `P`
        # for power without ceremony. A *lowercase* letter pressed into service as a
        # named coefficient is the case worth stopping: it is how OCT-Q4's key came to
        # compute with `c` while its question defined `B`.
        invented = base.islower() and "_" not in sym
        out.append(
            Finding(
                rule_id="symbols.undefined",
                severity="blocking" if invented else "warning",
                title=f"The key uses `{sym}`, which the question never defines",
                detail_md=(
                    f"`{base}` appears {uses}× in the answer key but in neither language "
                    "of the question. Either define it in the question or rename it to "
                    "the symbol the question already uses."
                ),
                evidence={"symbol": sym, "base": base, "uses": uses},
                question_id=q.id,
            )
        )
    return out


_PHRASE = re.compile(r"\b([a-zA-ZåäöÅÄÖ][a-zA-ZåäöÅÄÖ\-]{2,})\b")


def _clean_prose(text: str) -> str:
    """Strip math, LaTeX commands and image paths — none of them are prose."""
    text = _MD_IMAGE.sub(" ", text)
    text = _INCLUDEGRAPHICS.sub(" ", text)
    text = _strip_math(text)
    text = re.sub(r"\\[a-zA-Z]+\*?", " ", text)
    return re.sub(r"[{}\[\]|]", " ", text)


def _candidate_phrases(text: str) -> set[str]:
    """Two- and three-word lowercase phrases that could be domain terminology.

    Deliberately conservative: every word must be a content word of >=4 characters.
    `branch holds series` and `bottom reference rail` are prose, not terms, and
    letting them through poisons the whole rule.
    """
    out: set[str] = set()
    for line in _clean_prose(text).splitlines():
        toks = [w.lower() for w in _PHRASE.findall(line)]
        toks = [w for w in toks if len(w) >= 4 and w not in _STOP]
        # Only phrases that were adjacent in the original line survive, so rebuild
        # runs rather than sliding over the filtered list.
        run: list[str] = []
        for w in _PHRASE.findall(line):
            lw = w.lower()
            if len(lw) >= 4 and lw not in _STOP:
                run.append(lw)
            else:
                _emit_runs(run, out)
                run = []
        _emit_runs(run, out)
    return out


def _emit_runs(run: list[str], out: set[str]) -> None:
    for n in (2, 3):
        for i in range(len(run) - n + 1):
            out.add(" ".join(run[i : i + n]))


def rule_terminology(q: QuestionView, ctx: "RuleContext") -> list[Finding]:
    """Terminology the course never teaches.

    Only a corpus grep can make this call — a model finds `load line` and
    `overdrive factor` entirely plausible, because they are standard in the field and
    simply absent from *this* course.

    Precision matters more than recall here, because a false block makes the whole
    gate hated. So the deterministic tier blocks on exactly one, unambiguous signal:
    the phrase is demonstrably real terminology (it occurs in the course's own
    textbook) yet occurs nowhere in the taught material. Phrases absent from
    everything are usually just prose, so they are collected as candidates and handed
    to the `syllabus-audit` reviewer, which can tell terminology from prose.
    """
    if ctx.corpus is None or ctx.corpus.is_empty:
        return []
    out: list[Finding] = []
    seen: set[str] = set()
    candidates: list[str] = []

    sources: list[tuple[str, str]] = [("question", q.prompt_md), ("answer key", q.key_text)]
    sources += [(f"figure `{name}`", src) for name, src in sorted(q.figure_sources.items())]

    # The deny list is an explicit ruling, so it is matched literally against the text
    # rather than filtered through phrase extraction. Extraction only yields two- and
    # three-word phrases, which silently exempted every single-word ruling — a question
    # opening "Apply superposition to the network below" sailed through with
    # `superposition` sitting on the deny list.
    for where, text in sources:
        if not text:
            continue
        lowered = text.lower()
        for term in sorted(ctx.denylist):
            if term in seen or term not in lowered:
                continue
            seen.add(term)
            out.append(
                Finding(
                    rule_id="terminology.denied",
                    severity="blocking",
                    title=f"`{term}` is on this course's deny list ({where})",
                    detail_md=(
                        f"`{term}` has been ruled out for this course in "
                        "`<brain>/validation/deny-terms.md`. Remove it or take it off "
                        "the deny list."
                    ),
                    evidence={"phrase": term, "verdict": "denied", "where": where},
                    question_id=q.id,
                )
            )

    for where, text in sources:
        if not text:
            continue
        for phrase in sorted(_candidate_phrases(text)):
            if phrase in seen or phrase in ctx.allowlist:
                continue
            seen.add(phrase)
            if phrase in ctx.denylist:
                out.append(
                    Finding(
                        rule_id="terminology.denied",
                        severity="blocking",
                        title=f"`{phrase}` is on this course's deny list ({where})",
                        detail_md=(
                            f"`{phrase}` has been ruled out for this course in "
                            "`<brain>/validation/deny-terms.md`. Remove it or take it off "
                            "the deny list."
                        ),
                        evidence={"phrase": phrase, "verdict": "denied", "where": where},
                        question_id=q.id,
                    )
                )
                continue
            verdict, counts = ctx.corpus.classify(phrase)
            if verdict in ("taught", "formula", "pastexam"):
                continue
            if verdict == "textbook":
                where_found = ", ".join(ctx.corpus.sources(phrase, "textbook")[:3])
                out.append(
                    Finding(
                        rule_id="terminology.untaught",
                        severity="warning",
                        title=f"`{phrase}` is textbook-only, not taught ({where})",
                        detail_md=(
                            f"`{phrase}` occurs only in {where_found} — never in the "
                            "lectures, exercise sheets, formula sheet or past exams. That "
                            "may mean imported terminology, or it may just be ordinary "
                            "composition of taught words; the `syllabus-audit` reviewer "
                            "decides. To settle it permanently, add the phrase to "
                            "`<brain>/validation/deny-terms.md` (blocks from then on) or "
                            "`allow-terms.md` (never reported again)."
                        ),
                        evidence={"phrase": phrase, "verdict": verdict, "counts": counts, "where": where},
                        question_id=q.id,
                    )
                )
            elif counts.get("other"):
                out.append(
                    Finding(
                        rule_id="terminology.untaught",
                        severity="warning",
                        title=f"`{phrase}` appears only in non-course material ({where})",
                        detail_md=(
                            f"Found only in {', '.join(ctx.corpus.sources(phrase)[:3])}, which "
                            "is not part of what the course teaches from."
                        ),
                        evidence={"phrase": phrase, "verdict": "other", "counts": counts, "where": where},
                        question_id=q.id,
                    )
                )
            else:
                candidates.append(f"{phrase} ({where})")

    if candidates:
        shown = candidates[:40]
        out.append(
            Finding(
                rule_id="terminology.candidates",
                severity="note",
                title=f"{len(candidates)} phrase(s) occur nowhere in the course material",
                detail_md=(
                    "Most of these are ordinary prose. The `syllabus-audit` reviewer is "
                    "given this list to separate genuine imported terminology from "
                    "everyday wording.\n\n"
                    + "\n".join(f"- `{c}`" for c in shown)
                    + (f"\n- …and {len(candidates) - len(shown)} more" if len(candidates) > len(shown) else "")
                ),
                evidence={"candidates": candidates},
                question_id=q.id,
            )
        )
    return out


def rule_figure_source_present(q: QuestionView, ctx: "RuleContext") -> list[Finding]:
    """Every PNG should keep its source next to it, so the examiner can re-render.
    This invariant is documented in the project rules and is easy to break by hand."""
    if q.figure_dir is None or not q.figure_dir.is_dir():
        return []
    out: list[Finding] = []
    for png in sorted(q.figure_dir.glob("*.png")):
        stem = png.stem
        has_source = any((q.figure_dir / f"{stem}{ext}").is_file() for ext in (".tex", ".py"))
        shared = any(q.figure_dir.glob("*_source.py"))
        if not has_source and not shared:
            out.append(
                Finding(
                    rule_id="figures.no-source",
                    severity="note",
                    title=f"`{png.name}` has no editable source beside it",
                    detail_md="Without a `.tex`/`.py` source the figure cannot be re-rendered.",
                    evidence={"file": png.name},
                    question_id=q.id,
                )
            )
    return out


@dataclass
class RuleContext:
    corpus: Corpus | None = None
    allowlist: set[str] = field(default_factory=set)
    denylist: set[str] = field(default_factory=set)
    #: tokens already reported by an earlier rule, so later rules do not double-report
    #: the same defect (a mangled `$o$` is not also an undefined symbol).
    suppress_symbols: set[str] = field(default_factory=set)


Rule = Callable[[QuestionView, RuleContext], list[Finding]]

#: Order is report order.
QUESTION_RULES: list[Rule] = [
    rule_escaped_control_char,
    rule_mangled_math,
    rule_unbalanced_math,
    rule_part_mismatch,
    rule_marks,
    rule_bilingual_symmetry,
    rule_symbols_undefined,
    rule_terminology,
    rule_figures_missing,
    rule_figures_orphan,
    rule_figure_source_present,
]


def run_question_rules(q: QuestionView, ctx: RuleContext) -> list[Finding]:
    """Run every rule over one question. A rule that raises degrades to a note rather
    than taking the whole report down with it."""
    out: list[Finding] = []
    # Rules run in order and may suppress later ones, so the context is per-question.
    local = RuleContext(
        corpus=ctx.corpus,
        allowlist=ctx.allowlist,
        denylist=ctx.denylist,
        suppress_symbols=set(ctx.suppress_symbols),
    )
    for rule in QUESTION_RULES:
        try:
            found = rule(q, local)
        except Exception as exc:  # noqa: BLE001 — a broken rule must not block the rest
            found = [
                Finding(
                    rule_id="internal.rule-error",
                    severity="note",
                    title=f"Rule {rule.__name__} failed",
                    detail_md=f"`{exc}`",
                    question_id=q.id,
                )
            ]
        for f in found:
            # A mangled `$o$` is one defect, not also an "undefined symbol o".
            if f.rule_id == "latex.mangled-math":
                token = f.evidence.get("token")
                if token:
                    local.suppress_symbols.add(token)
        out.extend(found)
    return out
