"""Regression tests for the deterministic validation rules.

Every case below is taken from a defect that survived two manual review passes and
shipped in a finished SSY300 paper. The `_clean` variants are the corrected text, and
they must produce no blocking finding — precision matters as much as recall here,
because a gate that cries wolf gets overridden by reflex.

Deliberately DB-free: the rules take a `QuestionView` and a `Corpus`, both of which can
be built by hand, so these run in milliseconds with no fixtures.
"""

from __future__ import annotations

import uuid

import pytest

from app.validate.corpus import Corpus, CorpusDoc
from app.validate.rules import QuestionView, RuleContext, run_question_rules


def _corpus(**tiers: str) -> Corpus:
    """Build a corpus from `tier="text"` kwargs."""
    docs = [
        CorpusDoc(material_id=uuid.uuid4(), title=f"{tier}.pdf", tier=tier, text=text)  # type: ignore[arg-type]
        for tier, text in tiers.items()
    ]
    return Corpus(course_id=uuid.uuid4(), docs=docs)


def _ctx(corpus: Corpus | None = None, deny: set[str] | None = None) -> RuleContext:
    return RuleContext(corpus=corpus, allowlist=set(), denylist=deny or set())


def _view(**kw) -> QuestionView:
    kw.setdefault("id", uuid.uuid4())
    return QuestionView(**kw)


def _ids(findings, severity=None):
    return {f.rule_id for f in findings if severity is None or f.severity == severity}


def _blocking(findings):
    return [f for f in findings if f.severity == "blocking"]


# ── latex.escaped-control ─────────────────────────────────────────────────────
# OCT-Q3: `$\to$` reached the database as `$<TAB>o$` because something expanded the
# backslash-t as a string escape. It printed as an italic letter twelve times.


def test_escaped_control_character_is_blocking():
    view = _view(answer_md="AC1 $\to$ D1 $\to$ DC+".replace("\\to", "\to"))
    findings = run_question_rules(view, _ctx())
    assert "latex.escaped-control" in _ids(findings, "blocking")


def test_escaped_control_is_auto_fixable():
    view = _view(answer_md="AC1 $\to$ D1")
    found = [f for f in run_question_rules(view, _ctx()) if f.rule_id == "latex.escaped-control"]
    assert found and found[0].auto_fixable
    assert found[0].evidence["control"] == "t"


def test_correct_arrow_is_clean():
    view = _view(answer_md=r"AC1 $\to$ D1 $\to$ DC+ $\to$ $R_L$")
    assert not _blocking(run_question_rules(view, _ctx()))


# ── structure.part-mismatch ───────────────────────────────────────────────────
# OCT-Q5: the answer key answered a part (d) the question never asked.


def test_key_answering_an_unasked_part_is_blocking():
    view = _view(
        prompt_md="**(a)** Write X. [1 mark]\n**(b)** Truth table. [1 mark]\n**(c)** State X. [1 mark]",
        answer_md="**(a)** X = AP + BP\n**(b)** table\n**(c)** A or B\n**(d)** NAND form",
    )
    findings = run_question_rules(view, _ctx())
    assert "structure.part-mismatch" in _ids(findings, "blocking")


def test_matching_parts_are_clean():
    view = _view(
        prompt_md="**(a)** Write X. [1 mark]\n**(b)** Truth table. [1 mark]",
        answer_md="**(a)** X = AP + BP\n**(b)** table",
    )
    assert "structure.part-mismatch" not in _ids(run_question_rules(view, _ctx()))


# ── symbols.undefined ─────────────────────────────────────────────────────────
# OCT-Q4: the question defined `B` for the friction coefficient; the key computed
# throughout with `c`, which appears nowhere in the question.


def test_key_using_an_undefined_lowercase_symbol_is_blocking():
    view = _view(
        prompt_md=r"a friction load $M_l = B\,\omega$ with $B = 0.008$",
        answer_md=r"$M_s(1 - \omega/\omega_{max}) = c\,\omega$ so $c\,\omega_{max} = 1.07$ and $M = c\,\omega$",
    )
    assert "symbols.undefined" in _ids(run_question_rules(view, _ctx()), "blocking")


def test_key_using_the_questions_own_symbol_is_clean():
    view = _view(
        prompt_md=r"a friction load $M_l = B\,\omega$ with $B = 0.008$",
        answer_md=r"$M_s(1 - \omega/\omega_{max}) = B\,\omega$ so $B\,\omega_{max} = 1.07$ and $M = B\,\omega$",
    )
    assert "symbols.undefined" not in _ids(run_question_rules(view, _ctx()), "blocking")


def test_derived_subscript_notation_does_not_block():
    """`P_{R_1}` for the power in R_1 invents nothing — both parts are anchored in the
    question. Flagging this was the single biggest source of false positives."""
    view = _view(
        prompt_md=r"resistors $R_1 = 3\,\Omega$ and $R_2 = 4\,\Omega$",
        answer_md=r"$P_{R_1} = 48$ W, $P_{R_2} = 4$ W, $P_{R_1} + P_{R_2} = 52$ W",
    )
    assert "symbols.undefined" not in _ids(run_question_rules(view, _ctx()), "blocking")


def test_si_units_are_not_symbols():
    """`\\mathrm{A}`, `W` and `V` are units, not undefined variables."""
    view = _view(
        prompt_md=r"the current $i_1$",
        answer_md=r"$i_1 = 4\,\mathrm{A}$, $P = 72\,\mathrm{W}$, $U = 18\,\mathrm{V}$, "
        r"$x = 1\,\mathrm{A}$, $y = 2\,\mathrm{W}$",
    )
    assert "symbols.undefined" not in _ids(run_question_rules(view, _ctx()), "blocking")


def test_accent_does_not_manufacture_a_symbol():
    """`\\hat{u}_o` must read as `u_o`; parsed naively it strands a phantom `o`."""
    view = _view(
        prompt_md=r"the output $u_o(t)$ and input $u_s(t)$",
        answer_md=r"$\hat{u}_o = 1.96$ V, $\hat{u}_o = 1.96$ V, $\hat{u}_s = 10$ V",
    )
    assert "symbols.undefined" not in _ids(run_question_rules(view, _ctx()), "blocking")


# ── structure.marks ───────────────────────────────────────────────────────────
# OCT-Q1: header said [5 p], sub-marks summed to 5, but the in-text total said 8.


def test_intext_total_contradicting_the_header_is_blocking():
    view = _view(
        prompt_md="**EN**: q\n(a) x [1 mark]\n(b) y [2 marks]\n(c) z [2 marks]\n[Total: 8 marks]",
        points=5,
    )
    findings = run_question_rules(view, _ctx())
    assert "structure.marks" in _ids(findings, "blocking")


def test_submarks_not_summing_to_points_is_blocking():
    view = _view(prompt_md="**EN**: q\n(a) x [1 mark]\n(b) y [2 marks]", points=6)
    assert "structure.marks" in _ids(run_question_rules(view, _ctx()), "blocking")


def test_consistent_marks_are_clean():
    view = _view(
        prompt_md="**EN**: q\n(a) x [1 mark]\n(b) y [2 marks]\n(c) z [2 marks]\n[Total: 5 marks]",
        points=5,
    )
    assert "structure.marks" not in _ids(run_question_rules(view, _ctx()))


# ── bilingual.asymmetry ───────────────────────────────────────────────────────
# OCT-Q4: the EN stem carried [Total: 6 marks]; the SE stem had no total at all.


def test_total_in_one_language_only_is_flagged():
    view = _view(
        prompt_md=(
            "**SE**: fråga\n(a) x [1 poäng]\n(b) y [2 poäng]\n"
            "**EN**: question\n(a) x [1 mark]\n(b) y [2 marks]\n[Total: 3 marks]"
        ),
        points=3,
    )
    assert "bilingual.asymmetry" in _ids(run_question_rules(view, _ctx()))


# ── terminology ───────────────────────────────────────────────────────────────


def test_denied_term_blocks():
    """Once an examiner has ruled a term out, it blocks — including when it is baked
    into a figure source rather than the prose."""
    view = _view(
        prompt_md="Use the linear motor characteristic.",
        figure_sources={"fig2.py": "ax.set_title('operating point with viscous load')"},
    )
    findings = run_question_rules(view, _ctx(_corpus(taught="motor torque speed"), deny={"viscous load"}))
    assert "terminology.denied" in _ids(findings, "blocking")


def test_textbook_only_term_warns_but_does_not_block():
    """Counting cannot separate imported terminology from ordinary composition, so the
    deterministic tier must not block on it — the reviewer rules on it instead."""
    corpus = _corpus(taught="motor torque and speed characteristic", textbook="the load line method")
    view = _view(prompt_md="Using the load line, determine the operating point.")
    findings = run_question_rules(view, _ctx(corpus))
    assert "terminology.untaught" in _ids(findings, "warning")
    assert "terminology.untaught" not in _ids(findings, "blocking")


def test_taught_terminology_is_silent():
    corpus = _corpus(taught="the torque speed characteristic of a PMDC motor")
    view = _view(prompt_md="Use the torque speed characteristic.")
    findings = run_question_rules(view, _ctx(corpus))
    assert "terminology.untaught" not in _ids(findings)


def test_ordinary_prose_is_not_reported_as_terminology():
    """`branch holds series` and `bottom reference rail` are prose. Reporting them is
    what made the first version of this rule unusable (101 findings on one question)."""
    corpus = _corpus(taught="resistor branch current node voltage source")
    view = _view(
        prompt_md=(
            "The left branch holds U1 with its positive terminal at the top, and the "
            "shared middle branch holds R3 in series with U2, whose positive terminal "
            "sits on the bottom reference rail."
        )
    )
    findings = run_question_rules(view, _ctx(corpus))
    assert not _blocking(findings)
    assert len(_ids(findings, "warning")) == 0


# ── the whole-question precision check ────────────────────────────────────────


def test_a_clean_question_produces_no_blocking_finding():
    """The corrected form of AUG-Q1: consistent marks, symbols defined, no denied
    terminology, arrows intact."""
    view = _view(
        prompt_md=(
            "**SE**: Analysera kretsen.\n(a) Bestäm strömmarna. [3 poäng]\n"
            "(b) Beräkna effekten. [1 poäng]\n(c) Visa balansen. [2 poäng]\n"
            "[Totalt: 6 poäng]\n"
            "**EN**: Analyse the circuit. The resistors are $R_1 = 3\\,\\Omega$ and "
            "$R_2 = 4\\,\\Omega$, and the currents $i_1$, $i_2$ are marked.\n"
            "(a) Determine the currents. [3 marks]\n(b) Calculate the power. [1 mark]\n"
            "(c) Show the balance. [2 marks]\n[Total: 6 marks]"
        ),
        answer_md=r"(a) $i_1 = 4$ A, $i_2 = 1$ A. (b) $P_{R_1} = 48\,\mathrm{W}$. (c) equal.",
        points=6,
    )
    corpus = _corpus(taught="circuit resistor current power branch analyse determine calculate")
    assert not _blocking(run_question_rules(view, _ctx(corpus)))


@pytest.mark.parametrize(
    "rule_id",
    [
        "latex.escaped-control",
        "structure.part-mismatch",
        "symbols.undefined",
        "structure.marks",
    ],
)
def test_every_blocking_rule_has_a_regression_case(rule_id):
    """Guards against a rule being silently dropped from QUESTION_RULES."""
    from app.validate.rules import QUESTION_RULES

    names = {r.__name__ for r in QUESTION_RULES}
    expected = {
        "latex.escaped-control": "rule_escaped_control_char",
        "structure.part-mismatch": "rule_part_mismatch",
        "symbols.undefined": "rule_symbols_undefined",
        "structure.marks": "rule_marks",
    }[rule_id]
    assert expected in names


# ── intrinsic_marks ───────────────────────────────────────────────────────────
# build-auto stamped the blueprint's points onto every question regardless of the
# sub-marks the question declared for itself, so a 5-point slot could carry a
# question whose parts summed to 14. The validator blocked it; this is the source fix.


def test_intrinsic_marks_reads_the_english_half():
    from app.validate.rules import intrinsic_marks

    prompt = (
        "**SE**: fråga\n(a) x [1 poäng]\n(b) y [2 poäng]\n"
        "**EN**: question\n(a) x [3 marks]\n(b) y [4 marks]"
    )
    assert intrinsic_marks(prompt) == 7


def test_intrinsic_marks_is_none_when_the_question_declares_nothing():
    from app.validate.rules import intrinsic_marks

    assert intrinsic_marks("A question with no sub-part marks at all.") is None


def test_intrinsic_marks_handles_a_monolingual_question():
    from app.validate.rules import intrinsic_marks

    assert intrinsic_marks("(a) x [2 marks]\n(b) y [3 marks]") == 5


def test_single_word_denied_term_is_caught():
    """The deny list is matched literally, not via phrase extraction — extraction only
    yields 2-3 word phrases, which silently exempted every single-word ruling."""
    view = _view(prompt_md="Apply superposition to the resistor network below.")
    findings = run_question_rules(view, _ctx(_corpus(taught="resistor network"), deny={"superposition"}))
    assert "terminology.denied" in _ids(findings, "blocking")


def test_denied_term_is_reported_once_per_source_not_per_phrase():
    view = _view(prompt_md="superposition and superposition again, superposition.")
    findings = run_question_rules(view, _ctx(_corpus(taught="x"), deny={"superposition"}))
    assert len([f for f in findings if f.rule_id == "terminology.denied"]) == 1
