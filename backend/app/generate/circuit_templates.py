"""Deterministic circuit templates — worker-only.

The generation model is unreliable at writing schemdraw layout code for anything
beyond a trivial loop: it dangles branches (open circuits), parks value labels on
junction dots, and draws current arrows across components. These templates remove
layout from the model entirely. The model emits a `kind: "circuit"` figure whose
spec is just::

    {"template": "zener_regulator",
     "params": {"u_in": 12, "rs": 50, "uz": 5, "rl": 100, "given_currents": ["i_1"]}}

and a template function below builds a GUARANTEED-closed circuit with correct
label placement. The model supplies values, never geometry, so it physically
cannot produce a dangling branch or a label-on-node.

Conventions every template obeys:
- Source voltage label sits beside the source symbol, never on a node.
- A component value sits on the component body, never parked at a junction dot.
- Current arrows are small inline arrowheads ON the wire (CurrentLabelInline),
  drawn ONLY for currents named in `given_currents` — never for unknowns.
- Every branch returns to the bottom rail; one ground reference.
"""
from __future__ import annotations

from typing import Callable

import schemdraw
import schemdraw.elements as elm

_UNIT = 3.0
_FONT = 13


def _new() -> schemdraw.Drawing:
    d = schemdraw.Drawing()
    d.config(unit=_UNIT, fontsize=_FONT)
    return d


def _is_num(v: object) -> bool:
    if isinstance(v, (int, float)):
        return True
    if isinstance(v, str):
        try:
            float(v)
            return True
        except ValueError:
            return False
    return False


def _num(v: float | str) -> str:
    return f"{float(v):g}"


def _unit_label(label: str, value: float | str | None, unit: str) -> str:
    """`$R_1 = 9\\,\\Omega$` when numeric, just `$R_1$` when symbolic/unknown."""
    if value is None:
        return f"${label}$"
    if _is_num(value):
        return f"${label} = {_num(value)}\\,{unit}$"
    return f"${value}$" if value != label else f"${label}$"


def _ohm(label: str, value: float | str | None) -> str:
    return _unit_label(label, value, r"\Omega")


def _volt(label: str, value: float | str | None) -> str:
    return _unit_label(label, value, r"\mathrm{V}")


def _henry(label: str, value: float | str | None) -> str:
    return _unit_label(label, value, r"\mathrm{H}")


def _farad(label: str, value: float | str | None) -> str:
    return _unit_label(label, value, r"\mathrm{F}")


def _given(given_currents: list[str] | None) -> set[str]:
    return {str(c).strip().lstrip("$").rstrip("$") for c in (given_currents or [])}


def _curr(
    d: schemdraw.Drawing, elem, name: str, given: set[str],
    direction: str = "in", cloc: str | None = None,
) -> None:
    """Add a small inline current arrow on `elem`'s wire — only if `name` is given.
    `cloc` places the current label clear of the component value (use 'bottom' on
    a horizontal element whose value sits on 'top')."""
    key = name.strip().lstrip("$").rstrip("$")
    if not (key and key in given):
        return
    arrow = elm.CurrentLabelInline(direction=direction, ofst=0.5).at(elem)
    d.add(arrow.label(f"${name}$", loc=cloc) if cloc else arrow.label(f"${name}$"))


# ─────────────────────────── templates ───────────────────────────


def voltage_divider(
    *,
    u_in: float | str = "U_s",
    r1: float | str = "R_1",
    r2: float | str = "R_2",
    u_in_label: str = "U_s",
    r1_label: str = "R_1",
    r2_label: str = "R_2",
    vout_label: str | None = "U_{out}",
    given_currents: list[str] | None = None,
    **_ignored: object,
) -> schemdraw.Drawing:
    """Source across a two-resistor divider; output tap between R1 and R2."""
    given = _given(given_currents)
    d = _new()
    src = d.add(elm.SourceV().up().label(_volt(u_in_label, u_in), loc="left"))
    d.add(elm.Line().right().length(_UNIT))
    r1e = d.add(elm.Resistor().down().label(_ohm(r1_label, r1), loc="right"))
    _curr(d, r1e, "i_1", given, "in")
    tap = d.add(elm.Dot())
    if vout_label:
        d.add(elm.Line().right().length(1.4).label(f"${vout_label}$", loc="right"))
    d.add(elm.Resistor().down().at(tap.center).label(_ohm(r2_label, r2), loc="right"))
    d.add(elm.Line().left().tox(src.start))
    d.add(elm.Ground())
    return d


def parallel_network(
    *,
    u_in: float | str = "U_s",
    r_series: float | str | None = None,
    branches: list[dict] | None = None,
    u_in_label: str = "U_s",
    r_series_label: str = "R_{out}",
    given_currents: list[str] | None = None,
    **_ignored: object,
) -> schemdraw.Drawing:
    """Source (optionally through a series R_out) feeding N parallel resistor
    branches that ALL close to the bottom rail. Covers Thevenin / KCL-node
    problems — the case the free-form model kept leaving open."""
    given = _given(given_currents)
    branches = branches or [{"label": "R_1", "value": "R_1"}, {"label": "R_2", "value": "R_2"}]
    d = _new()
    src = d.add(elm.SourceV().up().label(_volt(u_in_label, u_in), loc="left"))
    d.add(elm.Line().right().length(_UNIT * 0.7))
    if r_series is not None:
        rs = d.add(elm.Resistor().right().label(_ohm(r_series_label, r_series), loc="bottom"))
        _curr(d, rs, "i_1", given, "in", cloc="top")
        d.add(elm.Line().right().length(_UNIT * 0.5))
    top0 = d.add(elm.Dot())
    anchors = [top0.center]
    for _ in range(len(branches) - 1):
        d.add(elm.Line().right().length(_UNIT).at(anchors[-1]))
        anchors.append(d.add(elm.Dot()).center)
    bottoms = []
    for anchor, br in zip(anchors, branches):
        lbl = br.get("label", "R")
        re = d.add(elm.Resistor().down().at(anchor).label(_ohm(lbl, br.get("value")), loc="right"))
        if br.get("current"):
            _curr(d, re, br["current"], given, "in")
        bottoms.append(d.add(elm.Dot()).center)
    rail_y = bottoms[-1][1]
    d.add(elm.Line().endpoints(bottoms[-1], (src.start.x, rail_y)))
    d.add(elm.Line().endpoints((src.start.x, rail_y), src.start))
    d.add(elm.Ground().at(src.start))
    return d


def zener_regulator(
    *,
    u_in: float | str = "U_i",
    rs: float | str = "R_s",
    uz: float | str = "U_z",
    rl: float | str | None = "R_L",
    u_in_label: str = "U_i",
    rs_label: str = "R_s",
    uz_label: str = "U_z",
    rl_label: str = "R_L",
    given_currents: list[str] | None = None,
    **_ignored: object,
) -> schemdraw.Drawing:
    """Series Rs into a node, Zener to ground (reverse breakdown), optional load
    RL in parallel with the Zener."""
    given = _given(given_currents)
    d = _new()
    src = d.add(elm.SourceV().up().label(_volt(u_in_label, u_in), loc="left"))
    d.add(elm.Line().right().length(_UNIT * 0.6))
    rse = d.add(elm.Resistor().right().label(_ohm(rs_label, rs), loc="top"))
    _curr(d, rse, "i_1", given, "in", cloc="bottom")
    node = d.add(elm.Dot())
    ze = d.add(elm.Zener().down())
    _curr(d, ze, "i_z", given, "in")
    zbot = d.add(elm.Dot())
    # U_z label beside the Zener body at its vertical midpoint (loc='left' on the
    # element anchors at the rail; a positioned Label is deterministic).
    zmid_y = (node.center[1] + zbot.center[1]) / 2
    d.add(elm.Label().at((node.center[0] - 1.25, zmid_y)).label(_volt(uz_label, uz)))
    rail_y = zbot.center[1]
    if rl is not None:
        d.add(elm.Line().right().length(_UNIT).at(node.center))
        rle = d.add(elm.Resistor().down().label(_ohm(rl_label, rl), loc="right"))
        _curr(d, rle, "i_L", given, "in")
        rbot = d.add(elm.Dot())
        d.add(elm.Line().endpoints(rbot.center, zbot.center))
    d.add(elm.Line().endpoints(zbot.center, (src.start.x, rail_y)))
    d.add(elm.Line().endpoints((src.start.x, rail_y), src.start))
    d.add(elm.Ground().at(src.start))
    return d


def rlc_series(
    *,
    src_label: str = "u_1(t)",
    r: float | str = "R",
    l: float | str | None = "L",
    c: float | str | None = "C",
    r_label: str = "R",
    l_label: str = "L",
    c_label: str = "C",
    ac: bool = True,
    given_currents: list[str] | None = None,
    **_ignored: object,
) -> schemdraw.Drawing:
    """Single-loop series R(-L)(-C) driven by a (sinusoidal) source."""
    given = _given(given_currents)
    d = _new()
    source = elm.SourceSin if ac else elm.SourceV
    src = d.add(source().up().label(f"${src_label}$", loc="left"))
    d.add(elm.Line().right().length(_UNIT * 0.5))
    re = d.add(elm.Resistor().right().label(_ohm(r_label, r), loc="top"))
    _curr(d, re, "i", given, "in", cloc="bottom")
    if l is not None:
        d.add(elm.Inductor().right().label(_henry(l_label, l), loc="top"))
    if c is not None:
        d.add(elm.Capacitor().down().label(_farad(c_label, c), loc="right"))
    else:
        d.add(elm.Line().down().length(_UNIT))
    d.add(elm.Line().left().tox(src.start))
    d.add(elm.Ground().at(src.start))
    return d


def series_loop(
    *,
    src_label: str = "U_s",
    src_value: float | str | None = None,
    ac: bool = False,
    elements: list[dict] | None = None,
    given_currents: list[str] | None = None,
    **_ignored: object,
) -> schemdraw.Drawing:
    """Single closed KVL loop: source + a row of series elements along the top,
    down the right, back along the bottom. `elements` is a list of
    `{type: 'R'|'L'|'C', label, value, current?}`."""
    given = _given(given_currents)
    elements = elements or [{"type": "R", "label": "R_1"}, {"type": "R", "label": "R_2"}]
    comp = {"R": elm.Resistor, "L": elm.Inductor, "C": elm.Capacitor}
    unitfn = {"R": _ohm, "L": _henry, "C": _farad}
    d = _new()
    source = elm.SourceSin if ac else elm.SourceV
    src = d.add(source().up().label(_volt(src_label, src_value), loc="left"))
    d.add(elm.Line().right().length(_UNIT * 0.4))
    for i, el in enumerate(elements):
        t = str(el.get("type", "R")).upper()
        e = d.add(comp.get(t, elm.Resistor)().right().label(
            unitfn.get(t, _ohm)(el.get("label", "R"), el.get("value")), loc="top"))
        if el.get("current"):
            _curr(d, e, el["current"], given, "in", cloc="bottom")
    d.add(elm.Line().down().length(_UNIT))
    d.add(elm.Line().left().tox(src.start))
    d.add(elm.Ground().at(src.start))
    return d


def two_source(
    *,
    u1: float | str = "U_1",
    u2: float | str = "U_2",
    r1: float | str = "R_1",
    r2: float | str = "R_2",
    r3: float | str = "R_3",
    u1_label: str = "U_1",
    u2_label: str = "U_2",
    r1_label: str = "R_1",
    r2_label: str = "R_2",
    r3_label: str = "R_3",
    given_currents: list[str] | None = None,
    **_ignored: object,
) -> schemdraw.Drawing:
    """Two sources sharing a central node through R2 — the classic superposition
    / two-mesh node circuit. U1-R1 into node C, R2 from C to ground, R3-U2 from C
    to the other source. Everything closes to one bottom rail."""
    given = _given(given_currents)
    d = _new()
    src1 = d.add(elm.SourceV().up().label(_volt(u1_label, u1), loc="left"))
    d.add(elm.Line().right().length(_UNIT * 0.4))
    r1e = d.add(elm.Resistor().right().label(_ohm(r1_label, r1), loc="top"))
    _curr(d, r1e, "i_1", given, "in", cloc="bottom")
    nodeC = d.add(elm.Dot())
    r2e = d.add(elm.Resistor().down().label(_ohm(r2_label, r2), loc="left"))
    _curr(d, r2e, "i_2", given, "in")
    cbot = d.add(elm.Dot())
    rail_y = cbot.center[1]
    # right arm: R3 along the top, then U2 down to the bottom rail
    d.add(elm.Line().right().length(_UNIT * 0.4).at(nodeC.center))
    r3e = d.add(elm.Resistor().right().label(_ohm(r3_label, r3), loc="top"))
    _curr(d, r3e, "i_3", given, "in", cloc="bottom")
    src2 = d.add(elm.SourceV().down().reverse().label(_volt(u2_label, u2), loc="right"))
    # close the bottom rail: U2 bottom -> central node bottom -> source 1 bottom
    d.add(elm.Line().endpoints(src2.end, (src2.end.x, rail_y)))
    d.add(elm.Line().endpoints((src2.end.x, rail_y), cbot.center))
    d.add(elm.Line().endpoints(cbot.center, src1.start))
    d.add(elm.Ground().at(src1.start))
    return d


def op_amp(
    *,
    config: str = "inverting",
    rin: float | str = "R_1",
    rf: float | str = "R_f",
    rin_label: str = "R_1",
    rf_label: str = "R_f",
    vin_label: str = "v_{in}",
    vout_label: str = "v_{out}",
    **_ignored: object,
) -> schemdraw.Drawing:
    """Ideal op-amp amplifier — `config='inverting'` or `'non_inverting'`."""
    d = _new()
    d.config(unit=2.4)
    op = d.add(elm.Opamp(leads=True))
    if config == "non_inverting":
        d.add(elm.Line().left().at(op.in2).length(0.8))
        nplus = d.add(elm.Dot(open=True).label(f"${vin_label}$", loc="left"))
        d.add(elm.Line().left().at(op.in1).length(0.5))
        nin = d.add(elm.Dot())
        d.add(elm.Resistor().down().at(nin.center).label(_ohm(rin_label, rin), loc="right"))
        d.add(elm.Ground())
        rfb = d.add(elm.Resistor().right().at(nin.center).label(_ohm(rf_label, rf), loc="bottom"))
        d.add(elm.Line().up().toy(op.out))
        d.add(elm.Line().left().tox(op.out))
        d.add(elm.Line().right().at(op.out).length(0.8).label(f"${vout_label}$", loc="right"))
    else:  # inverting
        d.add(elm.Line().left().at(op.in1).length(0.5))
        nin = d.add(elm.Dot())
        d.add(elm.Resistor().left().at(nin.center).label(_ohm(rin_label, rin), loc="top"))
        d.add(elm.SourceV().down().reverse().label(f"${vin_label}$", loc="left"))
        d.add(elm.Ground())
        d.add(elm.Line().left().at(op.in2).length(0.5))
        d.add(elm.Ground())
        d.add(elm.Resistor().up().at(nin.center).label(_ohm(rf_label, rf), loc="top"))
        d.add(elm.Line().right().tox(op.out))
        d.add(elm.Line().down().toy(op.out))
        d.add(elm.Line().right().at(op.out).length(0.8).label(f"${vout_label}$", loc="right"))
    return d


def transformer(
    *,
    u_in: float | str = "U_1",
    n1: float | str = "N_1",
    n2: float | str = "N_2",
    rl: float | str | None = "R_L",
    u_in_label: str = "U_1",
    rl_label: str = "R_L",
    **_ignored: object,
) -> schemdraw.Drawing:
    """Ideal transformer: source on the primary, load on the secondary,
    turns ratio N1:N2 labelled on the windings."""
    d = _new()
    d.config(unit=2.6)
    src = d.add(elm.SourceSin().up().label(_volt(u_in_label, u_in), loc="left"))
    d.add(elm.Line().right().length(_UNIT * 0.5))
    ratio = f"${_num(n1)}\\!:\\!{_num(n2)}$" if _is_num(n1) else f"${n1}\\!:\\!{n2}$"
    t = d.add(elm.Transformer().right().label(ratio, loc="left"))
    d.add(elm.Line().down().at(t.p2).length(_UNIT))
    d.add(elm.Line().left().tox(src.start))
    d.add(elm.Ground().at(src.start))
    # secondary side: load across s1-s2
    d.add(elm.Line().right().at(t.s1).length(0.6))
    sl = d.add(elm.Resistor().down().label(_ohm(rl_label, rl), loc="right"))
    d.add(elm.Line().left().at(t.s2).length(0.6))
    d.add(elm.Line().down().toy(sl.end))
    return d


def wheatstone_bridge(
    *,
    u_in: float | str = "U_s",
    r1: float | str = "R_1",
    r2: float | str = "R_2",
    r3: float | str = "R_3",
    r4: float | str = "R_x",
    u_in_label: str = "U_s",
    show_meter: bool = True,
    **_ignored: object,
) -> schemdraw.Drawing:
    """Wheatstone bridge: source across one diagonal, galvanometer across the
    other. R1/R2 on the left arm, R3/R4 on the right arm."""
    # Drawn as two parallel voltage dividers (topologically identical to the
    # diamond, far more robust): source on the left A->D; left arm A-R1-B-R2-D;
    # right arm A-R3-C-R4-D; galvanometer between the mid-taps B and C.
    d = _new()
    d.config(unit=2.6)
    src = d.add(elm.SourceV().up().label(_volt(u_in_label, u_in), loc="left"))
    d.add(elm.Line().right().length(_UNIT))
    a = d.add(elm.Dot())                       # top node A
    r1e = d.add(elm.Resistor().down().at(a.center).label(_ohm("R_1", r1), loc="left"))
    b = d.add(elm.Dot())                        # mid-left tap B
    d.add(elm.Resistor().down().label(_ohm("R_2", r2), loc="left"))
    dleft = d.add(elm.Dot())                    # bottom node D (left)
    d.add(elm.Line().right().length(_UNIT).at(a.center))
    a2 = d.add(elm.Dot())                        # top node A (right tap)
    r3e = d.add(elm.Resistor().down().at(a2.center).label(_ohm("R_3", r3), loc="right"))
    c = d.add(elm.Dot())                        # mid-right tap C
    d.add(elm.Resistor().down().label(_ohm("R_x", r4), loc="right"))
    dright = d.add(elm.Dot())                   # bottom node D (right)
    if show_meter:
        d.add(elm.MeterA().endpoints(b.center, c.center).label("G", loc="top"))
    rail_y = dleft.center[1]
    d.add(elm.Line().endpoints(dright.center, dleft.center))
    d.add(elm.Line().endpoints(dleft.center, (src.start[0], rail_y)))
    d.add(elm.Line().endpoints((src.start[0], rail_y), src.start))
    d.add(elm.Ground().at(src.start))
    return d


TEMPLATES: dict[str, Callable[..., schemdraw.Drawing]] = {
    "voltage_divider": voltage_divider,
    "parallel_network": parallel_network,
    "zener_regulator": zener_regulator,
    "rlc_series": rlc_series,
    "series_loop": series_loop,
    "two_source": two_source,
    "op_amp": op_amp,
    "transformer": transformer,
    "wheatstone_bridge": wheatstone_bridge,
}


def render_template(name: str, params: dict) -> schemdraw.Drawing:
    fn = TEMPLATES.get(name)
    if fn is None:
        raise ValueError(
            f"unknown circuit template '{name}' (have: {', '.join(sorted(TEMPLATES))})"
        )
    return fn(**(params or {}))
