"""Render a generated-question figure from a text spec to a PNG — worker-only.

Five kinds, mirroring `backend/skills/question-figures`:

- ``circuitikz`` — raw CircuiTikZ body → standalone tectonic compile → PNG (300 dpi).
                  Preferred for new circuit figures: matches the published-exam style.
- ``timing``    — JSON spec → a digital timing / waveform diagram (matplotlib).
- ``matplotlib`` — a Python snippet building the current figure → a plot.
- ``schemdraw`` — a Python snippet building ``drawing`` → a circuit schematic. (Legacy.)
- ``circuit``   — JSON ``{"template", "params"}`` → one of nine deterministic templates. (Legacy.)

For every kind the **source spec is written next to the PNG** (``fig1.tex``,
``fig1.py``, ``fig1.json``, …) so the examiner can edit a figure by hand and
re-render it with the same renderer without round-tripping through the LLM.

Tabular data is never rendered here — it stays a Markdown table in the question.
matplotlib / schemdraw / tectonic are imported lazily — heavy, worker-only. The
snippet specs are ``exec``-ed: acceptable here because AIEA is single-user and
localhost, and the spec author is the question-generation model, not an outside
user.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

FIGURE_KINDS = ("circuitikz", "timing", "schemdraw", "matplotlib", "circuit")

# Map kind → source-file extension written next to the rendered PNG.
# `fig1.png` ↔ `fig1.tex` for circuitikz, `fig1.py` for matplotlib, etc.
_SOURCE_EXT: dict[str, str] = {
    "circuitikz": ".tex",
    "matplotlib": ".py",
    "timing":     ".json",
    "schemdraw":  ".schemdraw.py",
    "circuit":    ".template.json",
}

# tectonic ships in the worker pixi env; prefer PATH but fall back to the known
# install location so the renderer keeps working even if PATH was scrubbed.
_TECTONIC = shutil.which("tectonic") or "/workspace/.pixi/envs/worker/bin/tectonic"


# Multi-letter subscripts written bare (e.g. `U_emf`, `R_th`) render literally
# in matplotlib (no italics, no sub). Rewrite them to math mode `${U}_{emf}$`
# inside schemdraw label strings before exec'ing the snippet. Single-letter +
# single-digit (`R_1`) is also normalised, since the doc shows it.
_BARE_SUBSCRIPT = re.compile(
    r"(?<![\w$\\])([A-Za-z])_([A-Za-z][A-Za-z0-9]*|[0-9]+)(?![\w}])"
)


def _math_subscript(match: re.Match[str]) -> str:
    head, tail = match.group(1), match.group(2)
    return f"${head}_{{{tail}}}$"


def _fix_subscripts(spec_text: str) -> str:
    """Rewrite bare `X_word` patterns inside Python string literals to LaTeX
    `$X_{word}$`. Leaves identifiers (variable names) alone — only single- or
    double-quoted strings are touched."""
    parts: list[str] = []
    pos = 0
    pattern = re.compile(r"('([^'\\]|\\.)*'|\"([^\"\\]|\\.)*\")")
    for m in pattern.finditer(spec_text):
        parts.append(spec_text[pos:m.start()])
        literal = m.group(0)
        quote = literal[0]
        body = literal[1:-1]
        # Skip if the literal is already an f-string-style math expression
        # or contains `$`/`\` (likely already LaTeX).
        if "$" in body:
            parts.append(literal)
        else:
            parts.append(quote + _BARE_SUBSCRIPT.sub(_math_subscript, body) + quote)
        pos = m.end()
    parts.append(spec_text[pos:])
    return "".join(parts)


def _render_timing(spec_text: str, out: Path, dpi: int) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    spec = json.loads(spec_text)
    signals = spec["signals"]
    title = spec.get("title", "")

    n = spec.get("slots")
    for s in signals:
        w = s.get("wave")
        if w:
            n = len(w) if n is None else max(n, len(w))
    n = n or 8

    rows = len(signals)
    hi, gap = 0.7, 1.4
    fig, ax = plt.subplots(figsize=(max(4.0, n * 0.6), max(1.2, rows * 0.85)))

    for k in range(n + 1):
        ax.axvline(k, color="0.85", lw=0.8, zorder=0)

    for i, s in enumerate(signals):
        ybase = (rows - 1 - i) * gap
        ax.text(-0.4, ybase + hi / 2, s["name"], ha="right", va="center", fontsize=11)
        wave = s.get("wave")
        if not wave or s.get("blank"):
            ax.plot([0, n], [ybase + hi / 2] * 2, color="0.6", lw=1, ls=":")
            ax.text(n / 2, ybase + hi / 2 + 0.18, "(to be completed)",
                    ha="center", fontsize=8, style="italic", color="0.55")
            continue
        levels, prev = [], "0"
        for c in wave:
            c = prev if c == "." else c
            levels.append(c)
            prev = c
        xs, ys = [], []
        for k, c in enumerate(levels):
            y = ybase + (hi if c == "1" else 0.0)
            xs += [k, k + 1]
            ys += [y, y]
        ax.plot(xs, ys, color="black", lw=2, solid_capstyle="butt")
        for k in range(1, len(levels)):
            y0 = ybase + (hi if levels[k - 1] == "1" else 0.0)
            y1 = ybase + (hi if levels[k] == "1" else 0.0)
            if y0 != y1:
                ax.plot([k, k], [y0, y1], color="black", lw=2)

    ax.set_xlim(-2.0, n + 0.2)
    ax.set_ylim(-0.5, rows * gap)
    ax.set_xticks(range(n + 1))
    ax.set_xticklabels([])
    ax.set_yticks([])
    for sp in ax.spines.values():
        sp.set_visible(False)
    if title:
        ax.set_title(title)
    plt.savefig(out, dpi=dpi, bbox_inches="tight")
    plt.close("all")


# Element/keyword names the generation model emits that don't exist in
# schemdraw 0.22. Rewritten on the raw snippet before exec so a wrong name no
# longer crashes the whole figure. Keep this list tight — only confirmed misses.
_SCHEMDRAW_RENAMES = {
    "DiodeZener": "Zener",      # elm.DiodeZener -> elm.Zener
    "ZenerDiode": "Zener",
    "RVar": "ResistorVar",      # elm.RVar -> elm.ResistorVar
    "VariableResistor": "ResistorVar",
    "Ammeter": "MeterA",
}
_ICPIN_CLK_TRUE = re.compile(r"\bclk\s*=\s*True\b")
_ICPIN_CLK_OTHER = re.compile(r",?\s*\bclk\s*=\s*[\w'\".]+")


def _fix_schemdraw_api(spec_text: str) -> str:
    """Rewrite known-bad schemdraw API the model emits so figures stop crashing.

    - Nonexistent element names (`DiodeZener` -> `Zener`).
    - `IcPin(clk=True)` -> `IcPin(decoration='clock')`; any other `clk=` kwarg
      (no such parameter on IcPin in 0.22) is dropped.
    """
    text = spec_text
    for bad, good in _SCHEMDRAW_RENAMES.items():
        text = re.sub(rf"\b{bad}\b", good, text)
    # Flip-flops live in elm, not logic, and the class is DFlipFlop/JKFlipFlop —
    # rewrite module + name together so a wrong prefix can't survive.
    text = re.sub(r"\b(?:logic|elm)\.FlipFlopD\b", "elm.DFlipFlop", text)
    text = re.sub(r"\b(?:logic|elm)\.FlipFlopJK\b", "elm.JKFlipFlop", text)
    text = _ICPIN_CLK_TRUE.sub("decoration='clock'", text)
    text = _ICPIN_CLK_OTHER.sub("", text)
    return text


def _render_schemdraw(spec_text: str, out: Path, dpi: int) -> None:
    import schemdraw
    import schemdraw.elements as elm
    import schemdraw.logic as logic

    fixed = _fix_subscripts(_fix_schemdraw_api(spec_text))
    ns: dict = {"schemdraw": schemdraw, "elm": elm, "logic": logic}
    exec(compile(fixed, "<schemdraw-spec>", "exec"), ns)  # noqa: S102
    drawing = ns.get("drawing")
    if not isinstance(drawing, schemdraw.Drawing):
        raise ValueError("schemdraw spec must bind `drawing` to a schemdraw.Drawing()")
    drawing.save(str(out), dpi=dpi)


def _render_matplotlib(spec_text: str, out: Path, dpi: int) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    from app.generate import figure_helpers as aiea_fig

    # `aiea_fig` is injected into the namespace, but a model (or the vision
    # refiner) often writes `import aiea_fig` at the top of its snippet. Register
    # the alias so that import resolves instead of raising ModuleNotFoundError.
    import sys

    sys.modules.setdefault("aiea_fig", aiea_fig)

    plt.close("all")
    plt.figure()
    ns: dict = {"plt": plt, "np": np, "aiea_fig": aiea_fig}
    exec(compile(spec_text, "<matplotlib-spec>", "exec"), ns)  # noqa: S102
    plt.savefig(str(out), dpi=dpi, bbox_inches="tight")
    plt.close("all")


def _render_circuit(spec_text: str, out: Path, dpi: int) -> None:
    """Deterministic circuit template: spec is ``{"template": ..., "params": {...}}``."""
    from app.generate.circuit_templates import render_template

    try:
        spec = json.loads(spec_text)
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"circuit spec is not valid JSON ({exc}): {spec_text[:200]!r}") from exc
    if not isinstance(spec, dict) or "template" not in spec:
        raise ValueError(f"circuit spec must be an object with a 'template' key: {spec_text[:200]!r}")
    drawing = render_template(str(spec["template"]), spec.get("params") or {})
    drawing.save(str(out), dpi=dpi)


# Standalone CircuiTikZ preamble used to wrap a raw `\begin{circuitikz} … \end{circuitikz}` body.
_CIRCUITIKZ_PREAMBLE = (
    "\\documentclass[border=6pt]{standalone}\n"
    "\\usepackage[american]{circuitikz}\n"
    "\\begin{document}\n"
)
_CIRCUITIKZ_POSTAMBLE = "\n\\end{document}\n"


# CircuiTikZ splits `to[...]` options on commas at brace level 0 and on the first
# `=`, so an unbraced label like `l=$C=10\,\mu F$` is torn apart by both its own `=`
# and the comma in `\,`. Braces are the documented fix; models emit them unreliably.
_CTIKZ_LABEL = re.compile(r"(?<![A-Za-z{])([lavif])([<>_^]{0,2})=(\$(?:[^$\\]|\\.)*\$)")


def _brace_circuitikz_labels(body: str) -> str:
    return _CTIKZ_LABEL.sub(r"\1\2={\3}", body)


def _render_circuitikz(spec_text: str, out: Path, dpi: int) -> None:
    """Render raw CircuiTikZ to PNG: tectonic compile of a standalone doc → pymupdf rasterise.

    The spec may be either a full standalone document (contains ``\\documentclass``)
    or just a ``\\begin{circuitikz} … \\end{circuitikz}`` body, in which case it
    is wrapped in the standard preamble (border=6pt, american circuitikz).
    """
    import fitz  # pymupdf — worker dep

    body = _brace_circuitikz_labels(spec_text.strip())
    full = body if "\\documentclass" in body else _CIRCUITIKZ_PREAMBLE + body + _CIRCUITIKZ_POSTAMBLE

    with tempfile.TemporaryDirectory(prefix="aiea_circuitikz_") as td:
        td_path = Path(td)
        tex_path = td_path / "fig.tex"
        tex_path.write_text(full, encoding="utf-8")
        proc = subprocess.run(
            [_TECTONIC, str(tex_path)],
            cwd=td, capture_output=True, text=True, timeout=120,
        )
        if proc.returncode != 0:
            tail = "\n".join((proc.stderr or proc.stdout or "").splitlines()[-15:])
            raise RuntimeError(f"tectonic failed (exit {proc.returncode}):\n{tail}")
        pdf_path = td_path / "fig.pdf"
        if not pdf_path.is_file():
            raise RuntimeError(f"tectonic ran clean but produced no PDF at {pdf_path}")
        doc = fitz.open(str(pdf_path))
        try:
            doc[0].get_pixmap(dpi=dpi).save(str(out))
        finally:
            doc.close()


_RENDERERS = {
    "circuitikz": _render_circuitikz,
    "timing": _render_timing,
    "schemdraw": _render_schemdraw,
    "matplotlib": _render_matplotlib,
    "circuit": _render_circuit,
}


def render_figure(kind: str, spec: str, out_path: Path, dpi: int = 300) -> Path:
    """Render a figure spec to ``out_path`` and persist the source spec next to it.

    For each PNG ``fig1.png`` the source is written to ``fig1.<ext>`` (e.g.
    ``fig1.tex`` for ``circuitikz``, ``fig1.py`` for ``matplotlib``) so the
    examiner can hand-edit the figure and re-render with the same renderer.
    """
    renderer = _RENDERERS.get(kind)
    if renderer is None:
        raise ValueError(f"unknown figure kind {kind!r} — one of {FIGURE_KINDS}")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    ext = _SOURCE_EXT.get(kind, ".txt")
    src_path = out_path.with_suffix(ext)
    if kind == "circuitikz":
        spec = _brace_circuitikz_labels(spec)
    try:
        src_path.write_text(spec, encoding="utf-8")
    except Exception:  # noqa: BLE001
        # Source persistence is best-effort — never block rendering on it.
        pass
    renderer(spec, out_path, dpi)
    return out_path
