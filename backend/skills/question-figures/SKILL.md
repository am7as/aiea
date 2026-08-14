---
name: question-figures
description: How a generated exam question carries real figures — timing diagrams, circuits, plots — as rendered images, and tables as Markdown. Used by the question generator. Points at the domain sub-skills (circuit-drawing, digital-logic, timing-diagram, transistor-circuits, response-plots) for the actual drawing rules.
---

# Figures in generated questions

A generated exam question is not text-only. Where the subject needs a diagram — and
digital logic, circuits, transistor stages and signals always do — the question must
carry **real figures**. You do not draw them: you emit a **text spec**, and the pipeline
renders it to an image. A spec is precise, deterministic, examiner-editable, and re-
renders into the exported exam.

## When a figure is required

- "Complete / draw the timing diagram" — the question must contain the circuit and a
  **blank** timing template; the answer key carries the filled-in diagram.
- "Given the circuit below" — the schematic must be drawn, not only described in prose.
- Any question whose data is a waveform, a schematic, a phasor set, or a plot
  (load line, Bode, transient).
- A question may use several figures at once — that is normal and encouraged.

## How to deliver a figure

In the question's JSON object, add a `figures` array. Each entry:

```json
{"id": "fig1", "kind": "circuitikz", "spec": "<the spec string>"}
```

For every kind the renderer also writes the **source spec next to the PNG**
(`fig1.tex` for circuitikz, `fig1.py` for matplotlib, `fig1.json` for timing, …)
so an examiner can hand-edit and re-render without round-tripping the LLM.

Then reference it from `prompt_md`, `worked_solution_md` or `answer_md` with a placeholder
line on its own: `[[FIG:fig1]]`. The pipeline renders each spec into the question's
`figures/` folder and replaces the placeholder with the image. A figure used only in the
solution (e.g. the *filled* timing diagram) is referenced only from `worked_solution_md` /
`answer_md`, never from `prompt_md`.

## The figure kinds

| Need | `kind` | Sub-skill that governs the spec |
|---|---|---|
| **Any electrical / analog circuit — PRIMARY for new generation** | **`circuitikz`** | **circuit-drawing** (CircuiTikZ section) |
| Standard topology with a known deterministic template (legacy fallback) | `circuit` | this section |
| Digital timing / waveform | `timing` | **timing-diagram** |
| Logic circuit (gates, flip-flops) | `circuitikz` or `schemdraw` | **digital-logic** |
| BJT / MOSFET / op-amp stage | `circuitikz` | **transistor-circuits** + **circuit-drawing** |
| Bode plot, transient, load line, phasor | `matplotlib` | **response-plots** |
| **Tabular data** (truth, state, K-map) | *none — Markdown table inline* | — |

**For circuits, prefer `circuitikz`** — it compiles a standalone CircuiTikZ document with
`tectonic` and rasterises to PNG at 300 dpi, matching the published-exam style of the SSY300
past papers. The `circuit` (templated) and `schemdraw` kinds remain available but produce
visibly weaker figures than `circuitikz` and should only be used when no equivalent CircuiTikZ
spec is reasonable.

**For any standard electrical topology, use `kind: "circuit"` with a template —
NOT hand-written schemdraw.** Hand-written schemdraw routinely dangles branches
(open circuits), parks values on junction dots, and draws current arrows across
components. A template is laid out deterministically and is always correct. Only
fall back to raw `schemdraw` when no template fits the topology.

Tables are always inline Markdown tables — never an image.

## Spec format per kind

- **circuitikz** (PREFERRED for any circuit) — a raw CircuiTikZ body, i.e. a single
  `\begin{circuitikz}[…] … \end{circuitikz}` block. The renderer wraps it in the
  standard standalone preamble (`\documentclass[border=6pt]{standalone}` +
  `\usepackage[american]{circuitikz}` + `\begin{document}` / `\end{document}`),
  compiles with `tectonic`, and rasterises the resulting PDF at 300 dpi. The full
  source is saved to `fig<N>.tex` next to `fig<N>.png` so the examiner can edit it
  and re-render.

  Conventions that keep figures clean (from the published SSY300 set):
  - Wrap every label value in braces: `l={$R_1=9\,\Omega$}` — a bare `=` or `,` in
    the value breaks the option parser.
  - Voltage sources: `to[V, l_={$U_1=12\,\mathrm{V}$}, invert]` puts the `+` at the
    end of the drawing direction; flip with/without `invert` to put + at top or bottom.
  - Current arrows: `i={$i_1$}` annotates a current along the component in the
    drawing direction.
  - Wheatstone bridges: draw as a diamond with upright `\node` labels at arm
    midpoints (NOT `l=` on the 45° arms — those rotate). Bridge output is a
    voltmeter `to[voltmeter, l_={$U_o$}]`, not a galvanometer.
  - American-style symbols (zigzag resistors, +/- circle sources) are enabled by
    the preamble's `[american]` option — match the SSY300 past-exam style.

  Example body (a two-source DC mesh):

  ```latex
  \begin{circuitikz}[line width=0.9pt]
    \draw (0,0) to[V, l={$U_1=12\,\mathrm{V}$}, invert] (0,3);
    \draw (0,3) to[R, l={$R_1=9\,\Omega$}, i={$i_1$}] (3,3);
    \draw (3,3) to[R, l_={$R_2=4\,\Omega$}, i={$i_2$}] (3,0);
    \draw (0,0) -- (3,0);
  \end{circuitikz}
  ```

- **circuit** (legacy templated) — a JSON string naming a template
  and its values: `{"template": "<name>", "params": {...}}`. You supply only
  numbers/labels; the template draws a guaranteed-correct, fully-closed circuit.
  Values may be numeric (rendered with units) or a symbolic label string (e.g.
  `"R_1"`) when the value is unknown. Available templates and params:

  | template | params (all optional, sensible defaults) |
  |---|---|
  | `voltage_divider` | `u_in`, `r1`, `r2`, `vout_label`, `given_currents` |
  | `parallel_network` | `u_in`, `r_series`, `branches` (list of `{label, value, current?}`), `given_currents` — source through optional series R into N parallel resistor branches. Use for KVL/KCL-node, Thevenin-source, series-parallel problems. |
  | `zener_regulator` | `u_in`, `rs`, `uz`, `rl` (omit/None for no load), `given_currents` |
  | `rlc_series` | `src_label`, `r`, `l` (None to omit), `c` (None to omit), `ac` (bool), `given_currents` |
  | `op_amp` | `config` ('inverting'/'non_inverting'), `rin`, `rf`, `vin_label`, `vout_label` |
  | `transformer` | `u_in`, `n1`, `n2` (turns), `rl` (secondary load), labels |
  | `wheatstone_bridge` | `u_in`, `r1`, `r2`, `r3`, `r4` (the unknown), `show_meter` |

  **`given_currents`** lists ONLY the currents the problem states as known (e.g.
  `["i_1", "i_z"]`). A current the student must FIND or assume a direction for is
  NOT listed — the template then omits its arrow, so the figure never reveals the
  answer. Example:
  `{"template": "zener_regulator", "params": {"u_in": 12, "rs": 50, "uz": 5, "rl": 100, "given_currents": ["i_1"]}}`

  **Which template — decide mechanically (raw `schemdraw` is FORBIDDEN for any
  of these):**

  | The circuit is… | Use template |
  |---|---|
  | One source + two resistors, output tap | `voltage_divider` |
  | One source (+ optional series R) feeding several resistors hanging off a node / rail — KVL-node, KCL, series-parallel reduction, Thevenin source-network, power-in-each-resistor | `parallel_network` (put each resistor in `branches`) |
  | TWO sources sharing a middle resistor (superposition, two-mesh) | `two_source` |
  | A single series loop of R/L/C round one mesh | `series_loop` |
  | Zener / shunt-regulator with a series R and a load | `zener_regulator` |
  | Series R-L-C driven by an AC source (impedance/resonance) | `rlc_series` |
  | Op-amp amplifier (inverting or non-inverting) | `op_amp` |
  | Transformer with a load (turns ratio, AC) | `transformer` |
  | Wheatstone bridge / balanced bridge with a galvanometer | `wheatstone_bridge` |

  If a standard resistor/source network does NOT obviously fit one of these,
  reshape it to the closest one (e.g. a 4-resistor ladder IS `parallel_network`
  with 4 `branches`). Only emit a raw `schemdraw` snippet for a genuinely
  non-standard circuit (an unusual switch arrangement, a meter in a specific
  spot, a bridge) that no template can express — and then follow every
  circuit-drawing rule. Hand-written `schemdraw` for a textbook resistor network
  is a defect: it collides labels and dangles branches.
- **timing** — a JSON string:
  `{"title": "...", "signals": [{"name": "CLK", "wave": "10101010"}, ...]}`.
  Wave-character vocabulary is in the timing-diagram sub-skill.
- **schemdraw** — a Python snippet. `schemdraw`, `elm` (`schemdraw.elements`) and `logic`
  (`schemdraw.logic`) are pre-imported; the snippet must bind `drawing` to a
  `schemdraw.Drawing()` with elements added. Component / topology rules are in the
  circuit-drawing, digital-logic and transistor-circuits sub-skills.
- **matplotlib** — a Python snippet. `plt`, `np`, and the helper module `aiea_fig`
  (with `bode`, `phasor`, `load_line`, `transient`) are pre-imported; build the current
  figure. Do not call `plt.show()` or `plt.savefig()`. Plot conventions are in the
  response-plots sub-skill.

## Universal rules (apply to every figure)

1. **Loops close.** Every component has both terminals connected. No dangling node dots,
   no half-finished branches.
2. **Reference node is explicit** in any circuit with more than one source or more than
   one loop. Use a ground triangle (`elm.Ground()` for chassis ground or
   `elm.GroundSignal()` for signal ground).
3. **Polarity is correct.** Sources that oppose each other in the same loop (a back-EMF
   opposing a supply) must be drawn with opposite polarity. Polarity dots on transformer
   windings must match the prose.
4. **Multi-letter subscripts use math mode.** Write `$U_{emf}$`, `$i_{out}$`, `$R_{th}$` —
   never the bare `U_emf`. Schemdraw passes the string through to matplotlib, which
   renders the LaTeX. For schemdraw labels, wrap the whole subscripted token in `$…$`.
5. **Component values inline when given.** If the prompt fixes `R_1 = 9 Ω`, the figure
   shows `$R_1 = 9\,\Omega$` next to the resistor — not just `$R_1$`. If the value is to
   be solved for, show only the symbol.
6. **Reference directions in the figure.** When the prompt names a current (e.g. "the
   current $i_1$ flowing downward"), the figure must carry an arrow on that branch in
   that direction. Use `.label('$i_1$', loc='top')` plus a current arrow element.
7. **One graphic style per question.** Don't mix `value-on-symbol` and `symbol-only`
   labelling within the same problem.
8. **Self-contained.** Every figure the solver needs is in the question itself. The
   blank template the student completes goes in `prompt_md`; the solved / filled figure
   goes only in the solution.

## Choosing the right sub-skill

Before emitting a figure spec, look at the question's domain and follow the matching
sub-skill verbatim:

- **Resistors, sources, RC/RL/RLC networks, Thévenin / Norton** → `circuit-drawing`
- **Logic gates, flip-flops, counters, registers, MUX / DEMUX** → `digital-logic`
- **Waveforms, "complete the timing diagram", clocked sequences** → `timing-diagram`
- **BJT / MOSFET / JFET stages, op-amp circuits, biasing networks** → `transistor-circuits`
  (always read `circuit-drawing` too)
- **Bode plot, transient response, load line, phasor diagram, Nyquist plot, sensor
  curve, motor torque-speed curve** → `response-plots`

If a domain sub-skill conflicts with this top-level skill, the sub-skill wins — it is
more specific.
