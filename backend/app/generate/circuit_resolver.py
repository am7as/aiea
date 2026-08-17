"""Deterministic circuit-figure resolver — worker-only.

The generation model is unreliable at *drawing* circuits (it hand-writes
schemdraw that collides labels and dangles branches), but it is perfectly
reliable at the much narrower task of *reading* a question and naming the
topology + values. So when a question's figure was hand-drawn (kind=schemdraw),
this module makes one constrained call — "which template + what values?" — and
re-renders the figure from the matching deterministic template, overwriting the
messy one. If no template fits (genuinely exotic circuit), it returns None and
the original schemdraw figure is kept.
"""
from __future__ import annotations

import json
import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.events import ChatMessage, GenParams
from app.ai.jsonparse import extract_object
from app.ai.router import resolve
from app.generate.circuit_templates import TEMPLATES

log = logging.getLogger(__name__)

_SYSTEM = r"""You map an exam question to a deterministic circuit-drawing template.
You do NOT draw anything. You read the question and output ONE JSON object:

{"template": "<name or null>", "params": { ... }}

Choose `template` from this catalog ONLY (or null if the circuit is not one of
these standard topologies):

- "voltage_divider"  — one source, two resistors in series, output tap between them.
  params: u_in, r1, r2, vout_label, given_currents
- "parallel_network" — one source (optionally through a series R_out) feeding N
  resistors hanging in parallel off a node/rail (KVL-node, KCL, Thevenin source
  network, power-in-each-resistor, simple series-parallel).
  params: u_in, r_series, branches=[{label, value, current?}], given_currents
- "two_source" — TWO sources sharing one middle resistor (superposition, two mesh).
  params: u1, u2, r1, r2, r3, given_currents
- "series_loop" — ONE closed loop of series elements (KVL single loop).
  params: src_label, src_value, ac(bool), elements=[{type:'R'|'L'|'C', label, value, current?}]
- "rlc_series" — series R(-L)(-C) driven by an AC source (impedance/resonance).
  params: src_label, r, l, c, ac(bool), given_currents
- "zener_regulator" — series Rs into a node, Zener to ground, optional load Rl.
  params: u_in, rs, uz, rl, given_currents
- "op_amp" — ideal op-amp amplifier. params: config('inverting'|'non_inverting'), rin, rf, vin_label, vout_label
- "transformer" — transformer with a load. params: u_in, n1, n2, rl
- "wheatstone_bridge" — 4-resistor bridge with a galvanometer. params: u_in, r1, r2, r3, r4, show_meter

RULES
- Read the numeric values straight from the question (e.g. "R_1 = 1 kΩ" -> r1: "1\\,k\\Omega" or 1000). Pass numbers as numbers where possible; if a value is unknown/symbolic pass the label string (e.g. "R_x").
- `given_currents`: list ONLY currents the question states as KNOWN. A current the student must FIND (or assume a direction for) must NOT be listed — so the figure never reveals the answer.
- If the circuit is a multi-stage ladder, a non-standard switch/meter arrangement, a transistor amplifier, a rectifier, or anything not in the catalog: return {"template": null}.
- Output ONLY the JSON object. No prose, no code fences."""


async def resolve_circuit_figure(
    db: AsyncSession, prompt_md: str, answer_md: str | None = None
) -> tuple[str, dict] | None:
    """Return (template_name, params) for a question's circuit, or None."""
    resolution = await resolve(db, "question-generation")
    if resolution is None:
        return None
    user = (
        "QUESTION:\n" + (prompt_md or "")[:3000]
        + "\n\nANSWER (for context only):\n" + (answer_md or "")[:1500]
        + "\n\nReturn the circuit template JSON."
    )
    try:
        result = await resolution.provider.complete(
            [ChatMessage(role="user", content=user)],
            model=resolution.model,
            system=_SYSTEM,
            params=GenParams(temperature=0.0, max_tokens=3000),
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("circuit-resolver call failed: %s", exc)
        return None
    try:
        data = extract_object(result.text)
    except Exception as exc:  # noqa: BLE001
        log.warning("circuit-resolver returned unparseable JSON: %s", exc)
        return None
    tmpl = data.get("template")
    if not tmpl or not isinstance(tmpl, str) or tmpl not in TEMPLATES:
        return None
    params = data.get("params")
    return tmpl, params if isinstance(params, dict) else {}
