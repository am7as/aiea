"""Render a question figure from a text spec to a PNG.

Usage:
    render_figure.py timing     <spec.json> <out.png> [dpi]
    render_figure.py schemdraw  <spec.py>   <out.png> [dpi]
    render_figure.py matplotlib <spec.py>   <out.png> [dpi]

  timing      A digital timing / waveform diagram. The spec is JSON:
                {"title": "optional",
                 "signals": [
                    {"name": "CLK", "wave": "10101010"},
                    {"name": "Q",   "wave": "0.11..00"},
                    {"name": "Z",   "blank": true}        ]}
              "wave" is one char per time slot: '1' high, '0' low, '.' hold
              previous. All wave strings should have equal length = the slot
              count N. A row with "blank": true (or no "wave") is drawn as a
              dotted to-be-completed template row — use it for questions that
              ask the student to fill in a waveform.

  schemdraw   The spec is a Python snippet for a circuit / logic schematic.
              Pre-imported: `schemdraw`, `elm` (schemdraw.elements),
              `logic` (schemdraw.logic). The snippet MUST bind a variable
              `drawing` to a schemdraw.Drawing() with elements added, e.g.:
                drawing = schemdraw.Drawing()
                drawing += elm.Resistor().label('R1')

  matplotlib  The spec is a Python snippet for a plot / graph. Pre-imported:
              `plt` (matplotlib.pyplot), `np` (numpy). Build the current
              figure with plt.plot / plt.bar / etc. Do NOT call plt.show()
              or plt.savefig() — this tool saves for you.

Tables are NOT rendered here — put tabular data in a Markdown table instead.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def render_timing(spec_text: str, out: Path, dpi: int) -> None:
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


def render_schemdraw(spec_text: str, out: Path, dpi: int) -> None:
    import schemdraw
    import schemdraw.elements as elm
    import schemdraw.logic as logic

    ns: dict = {"schemdraw": schemdraw, "elm": elm, "logic": logic}
    exec(compile(spec_text, "<schemdraw-spec>", "exec"), ns)
    drawing = ns.get("drawing")
    if not isinstance(drawing, schemdraw.Drawing):
        raise SystemExit("schemdraw spec must bind `drawing` to a schemdraw.Drawing()")
    drawing.save(str(out), dpi=dpi)


def render_matplotlib(spec_text: str, out: Path, dpi: int) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    plt.close("all")
    plt.figure()
    ns: dict = {"plt": plt, "np": np}
    exec(compile(spec_text, "<matplotlib-spec>", "exec"), ns)
    plt.savefig(str(out), dpi=dpi, bbox_inches="tight")
    plt.close("all")


RENDERERS = {
    "timing": render_timing,
    "schemdraw": render_schemdraw,
    "matplotlib": render_matplotlib,
}


def main() -> None:
    if len(sys.argv) not in (4, 5) or sys.argv[1] not in RENDERERS:
        print(__doc__)
        sys.exit(1)

    kind = sys.argv[1]
    spec = Path(sys.argv[2])
    out = Path(sys.argv[3])
    dpi = int(sys.argv[4]) if len(sys.argv) == 5 else 200

    if not spec.is_file():
        print(f"error: spec file not found: {spec}")
        sys.exit(1)

    out.parent.mkdir(parents=True, exist_ok=True)
    RENDERERS[kind](spec.read_text(), out, dpi)
    print(f"saved {out}  ({out.stat().st_size} bytes, {kind}, dpi {dpi})")


if __name__ == "__main__":
    main()
