"""Vision self-correction for rendered question figures — worker-only.

The question-generation model writes a schemdraw / matplotlib spec one-shot and
never sees the result, so labels routinely collide (value text over a component,
a current arrow striking through a value, a source value printed on top of the
ground symbol, …). This module closes that loop: render → show the PNG to a
vision model → get a corrected spec → re-render. Up to a couple of iterations.

It is deliberately conservative: a corrected spec is accepted only if it renders
successfully. Any failure keeps the previous good PNG, so the loop can never make
a figure worse.
"""
from __future__ import annotations

import base64
import logging
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.events import ChatMessage, GenParams
from app.ai.jsonparse import extract_object
from app.ai.providers.agent import AgentProvider
from app.ai.router import resolve
from app.generate.figures import render_figure

log = logging.getLogger(__name__)

_MAX_ITERS = 2

_SYSTEM = r"""You are a technical-figure proofreader for exam figures: circuit
schematics, plots, and digital timing diagrams.

You are shown a rendered PNG plus the snippet that produced it. The snippet is one
of three kinds and your corrected_spec MUST stay the SAME kind and format:
- schemdraw: Python binding `drawing = schemdraw.Drawing()`.
- matplotlib: Python building the current figure; the helper module `aiea_fig`
  is already injected (e.g. aiea_fig.filter_response(...), aiea_fig.bode(...)) —
  call it directly, do NOT write `import aiea_fig`.
- timing: a JSON object with "signals" (each {name, wave} using only '0','1','.').

Keep the intended circuit / plot / sequence and all numeric values, but FIX these
defects:

LABEL / READABILITY (schemdraw circuits):
1. Value/label text overlapping a component, another label, a node dot, or a
   current arrow.
2. A vertical resistor/source value floating at the node — must be loc='left' or
   loc='right'; horizontal elements loc='top'/'bottom'.
3. A current arrow crossing its own value label — put them on opposite sides.
4. A source value colliding with the ground symbol — drop the ground lower.
Fixes: flip loc, add ofst=(dx,dy), raise drawing.config(unit=...) spacing. Do NOT
change the circuit topology, components, polarities, or current directions.

PHYSICS / CORRECTNESS (matplotlib plots):
5. A filter MAGNITUDE response drawn as STRAIGHT line segments is WRONG — real
   filters roll off as a smooth curve. Replace the whole snippet with:
     aiea_fig.filter_response(fc, kind='lowpass', order=1, f_range=(0, fmax),
                              f_unit='Hz', title='...')
   pick fc/kind to match the intended band edge (the -3 dB / 0.707 point).
6. Missing axis-unit labels, or the answer numerically annotated on a read-off graph.

LOGIC / CORRECTNESS (timing diagrams):
7. A binary counter where a Q bit goes high and NEVER returns low (no rollover) is
   WRONG. Each Qk toggles at half the rate of Qk-1 and the count wraps modulo
   2**bits, so every bit returns to 0 after rollover. Recompute the wave strings
   so they wrap correctly (all the same length, only '0'/'1'/'.').

Return ONLY a JSON object — no prose, no code fences:
{
  "ok": <true if the figure has NO defects and needs no change>,
  "issues": ["short description of each defect", "..."],
  "corrected_spec": "<the FULL corrected snippet in the SAME format as the input; empty string when ok=true>"
}

The corrected_spec must be COMPLETE and self-contained, the same kind as the input."""


def _png_b64(path: Path) -> str | None:
    try:
        return base64.b64encode(path.read_bytes()).decode("ascii")
    except OSError:
        return None


async def refine_figure(
    db: AsyncSession,
    kind: str,
    spec_str: str,
    png_path: Path,
) -> str | None:
    """Vision-correct one rendered figure in place.

    Returns the final spec string actually on disk (possibly corrected), or
    None when no refinement happened (no route, non-correctable kind, or the
    figure was already clean). The PNG at `png_path` is overwritten with the
    best render.
    """
    # All three figure kinds get a vision pass: schemdraw for label collisions,
    # matplotlib for physics defects (straight-line filter), timing for logic
    # defects (counter that doesn't roll over). The model returns ok=true for a
    # clean figure, so a correct one is left untouched.
    if kind not in ("schemdraw", "matplotlib", "timing"):
        return None

    resolution = await resolve(db, "figure-refinement")
    if resolution is None:
        return None
    # The vision loop only helps with a fast, image-capable provider. Skip when
    # it can't deliver that, so we never burn a slow CLI timeout per figure:
    #  - Agent (shim /agent) providers are image-blind.
    #  - Shim-backed subscription chat (host :4023) runs a CLI per call → times
    #    out (HTTP 502) and is image-blind through the bridge anyway.
    #  - Any provider that declares no vision support.
    provider = resolution.provider
    base_url = getattr(provider, "base_url", "") or ""
    if isinstance(provider, AgentProvider) or ":4023" in base_url:
        log.info("figure-refinement provider can't do fast vision (agent/shim) — skipping")
        return None
    if not getattr(provider, "supports_vision", True):
        log.info("figure-refinement provider is text-only — skipping")
        return None

    current_spec = spec_str
    for _ in range(_MAX_ITERS):
        b64 = _png_b64(png_path)
        if b64 is None:
            return None
        user = (
            f"Figure kind: {kind}\n\n"
            "## Current snippet\n\n```python\n" + current_spec + "\n```\n\n"
            "Inspect the attached rendered PNG. Report label defects and, if "
            "any exist, return a corrected snippet."
        )
        try:
            result = await resolution.provider.complete(
                [ChatMessage(role="user", content=user, images=[b64])],
                model=resolution.model,
                system=_SYSTEM,
                params=GenParams(
                    temperature=0.0,
                    max_tokens=max(resolution.params.max_tokens, 2048),
                ),
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("figure-refinement provider call failed: %s", exc)
            return None

        try:
            data = extract_object(result.text)
        except Exception as exc:  # noqa: BLE001
            log.warning("figure-refinement returned unparseable JSON: %s", exc)
            return current_spec
        if not isinstance(data, dict) or data.get("ok") is True:
            return current_spec
        corrected = str(data.get("corrected_spec") or "").strip()
        if not corrected or corrected == current_spec:
            return current_spec

        # Validate the correction renders before committing to it. Render to a
        # temp sibling; only swap in on success so a bad correction can't break
        # an already-good figure.
        tmp = png_path.with_suffix(".refine.png")
        try:
            render_figure(kind, corrected, tmp)
        except Exception as exc:  # noqa: BLE001
            log.warning("figure-refinement corrected spec failed to render: %s", exc)
            tmp.unlink(missing_ok=True)
            return current_spec
        tmp.replace(png_path)
        current_spec = corrected
        if data.get("issues"):
            log.info("figure-refinement applied fixes: %s", data.get("issues"))

    return current_spec
