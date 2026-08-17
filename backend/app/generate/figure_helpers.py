"""High-level matplotlib helpers exposed to figure spec snippets as `aiea_fig`.

The model writes a `kind: "matplotlib"` snippet; the renderer pre-imports this module
under the name `aiea_fig` so the model can call:

    aiea_fig.bode(num, den)
    aiea_fig.transient(num, den, t_end=5e-3)
    aiea_fig.load_line(iv_fn, vdd=10, r=1e3)
    aiea_fig.phasor([{'value': 10 + 0j, 'label': '$V$'}, ...])

Each helper builds the current matplotlib figure. The renderer captures it with
`plt.savefig()` — the spec must not call savefig / show itself.

Worker-only — depends on matplotlib (heavy) and scipy.signal (Bode / transient).
"""
from __future__ import annotations

from typing import Callable, Iterable

import matplotlib.pyplot as plt
import numpy as np


def bode(
    num: list[float],
    den: list[float],
    *,
    w_range: tuple[float, float] | None = None,
    title: str | None = None,
) -> None:
    """Two-pane Bode plot (magnitude in dB / phase in degrees) on the current figure.

    If `w_range` is None, scipy picks a sensible auto-range. The corner frequency at
    -3 dB (single-pole approximation) is marked with a thin vertical line.
    """
    import scipy.signal as sig

    sys = sig.TransferFunction(num, den)
    if w_range is None:
        w, mag, phase = sig.bode(sys)
    else:
        w = np.logspace(np.log10(w_range[0]), np.log10(w_range[1]), 600)
        w, mag, phase = sig.bode(sys, w=w)

    plt.close("all")
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(6.5, 4.2), sharex=True)
    ax1.semilogx(w, mag, lw=2)
    ax1.set_ylabel("Magnitude [dB]")
    ax1.grid(True, which="both", alpha=0.3)
    if title:
        ax1.set_title(title)

    # Find the -3 dB corner (closest point to peak − 3 dB).
    idx = int(np.argmin(np.abs(mag - (mag.max() - 3))))
    w_c = float(w[idx])
    if mag.max() - mag.min() > 3:
        ax1.axvline(w_c, color="grey", ls="--", lw=0.8)
        ax1.text(w_c, mag.max(), r"  $\omega_c$", va="top")

    ax2.semilogx(w, phase, lw=2)
    ax2.set_ylabel("Phase [°]")
    ax2.set_xlabel(r"$\omega$ (rad/s)")
    ax2.grid(True, which="both", alpha=0.3)
    if mag.max() - mag.min() > 3:
        ax2.axvline(w_c, color="grey", ls="--", lw=0.8)

    fig.tight_layout()


def filter_response(
    fc: float,
    *,
    kind: str = "lowpass",
    order: int = 1,
    f_range: tuple[float, float] | None = None,
    f_unit: str = "Hz",
    mark_3db: bool = True,
    title: str | None = None,
    **_ignored: object,
) -> None:
    """Linear magnitude response |H(f)| of an ideal Butterworth-shape filter.

    Use this for any "magnitude vs frequency / find the -3 dB bandwidth" figure —
    NEVER hand-draw a straight-line rolloff, which is physically wrong. The curve
    is the real response |H| = 1/sqrt(1+(f/fc)^(2n)) (lowpass), its mirror for
    highpass, so the marked -3 dB point lands at exactly fc by construction.

    `kind`: 'lowpass' | 'highpass' | 'bandpass'. `order` n sets the rolloff
    steepness. `fc` and `f_range` are in `f_unit`.
    """
    lo, hi = f_range or (0.0, fc * 4)
    f = np.linspace(max(lo, 1e-9 if kind == "highpass" else 0.0), hi, 800)
    ratio = np.where(f == 0, 1e-12, f) / fc
    if kind == "highpass":
        mag = ratio**order / np.sqrt(1 + ratio ** (2 * order))
    elif kind == "bandpass":
        # symmetric band centred on fc, width ~ fc/order
        q = max(order, 1)
        mag = 1.0 / np.sqrt(1 + (q * (ratio - 1.0 / np.where(ratio == 0, 1e-9, ratio))) ** 2)
    else:  # lowpass
        mag = 1.0 / np.sqrt(1 + ratio ** (2 * order))

    plt.close("all")
    plt.figure(figsize=(6.8, 4.2))
    plt.plot(f, mag, lw=2.2, color="C3")
    if mark_3db:
        thresh = 1 / np.sqrt(2)
        plt.axhline(thresh, color="grey", ls="--", lw=0.9)
        plt.text(lo, thresh, r" $1/\sqrt{2}=0.707$", va="bottom", fontsize=10)
        plt.axvline(fc, color="grey", ls="--", lw=0.9)
        plt.annotate(
            rf"$f_c = {fc:g}$ {f_unit}",
            xy=(fc, thresh), xytext=(fc, 0.15),
            ha="center", fontsize=10,
            arrowprops=dict(arrowstyle="->", color="grey"),
        )
    plt.xlabel(f"Frequency ({f_unit})")
    plt.ylabel(r"$|H(f)| = |U_o/U_i|$")
    plt.ylim(0, 1.08)
    plt.xlim(lo, hi)
    plt.grid(True, alpha=0.3)
    if title:
        plt.title(title)
    plt.tight_layout()


def counter_timing(
    bits: int,
    clocks: int,
    *,
    trigger: str = "falling",
    blank_outputs: bool = False,
    clk_name: str = "CLK",
    title: str | None = None,
    **_ignored: object,
) -> None:
    """Correct ripple/synchronous binary UP-counter timing diagram.

    Generates the clock plus Q0..Q(bits-1) where each Qk toggles at half the rate
    of Qk-1 and the whole count WRAPS modulo 2**bits — so it can never show the
    'Q stays high forever' bug. `blank_outputs=True` draws dotted '(to be
    completed)' rows for the Q outputs (the question form); False fills them (the
    answer form). `trigger` controls which clock edge advances the count.
    """
    n = clocks
    edges = np.arange(n + 1)
    # Count value after each clock period (advances once per clock).
    counts = [(i) % (2**bits) for i in range(n + 1)]

    plt.close("all")
    rows = bits + 1
    fig, ax = plt.subplots(figsize=(max(5.0, n * 0.55), max(1.6, rows * 0.8)))
    hi, gap = 0.7, 1.4

    def draw_wave(ybase: float, levels: list[int]) -> None:
        xs, ys = [], []
        for k, lv in enumerate(levels):
            y = ybase + (hi if lv else 0.0)
            xs += [k, k + 1]
            ys += [y, y]
        ax.plot(xs, ys, color="black", lw=2, solid_capstyle="butt")
        for k in range(1, len(levels)):
            y0 = ybase + (hi if levels[k - 1] else 0.0)
            y1 = ybase + (hi if levels[k] else 0.0)
            if y0 != y1:
                ax.plot([k, k], [y0, y1], color="black", lw=2)

    for k in edges:
        ax.axvline(k, color="0.85", lw=0.8, zorder=0)

    # Clock row (top): one full high/low per count period.
    clk_levels = [(1 if i % 2 == 0 else 0) for i in range(n)]
    ybase = bits * gap
    ax.text(-0.4, ybase + hi / 2, clk_name, ha="right", va="center", fontsize=11)
    draw_wave(ybase, clk_levels)

    for b in range(bits):
        ybase = (bits - 1 - b) * gap
        ax.text(-0.4, ybase + hi / 2, f"$Q_{b}$", ha="right", va="center", fontsize=11)
        if blank_outputs:
            ax.plot([0, n], [ybase + hi / 2] * 2, color="0.6", lw=1, ls=":")
            ax.text(n / 2, ybase + hi / 2 + 0.18, "(to be completed)",
                    ha="center", fontsize=8, style="italic", color="0.55")
        else:
            levels = [(counts[i] >> b) & 1 for i in range(n)]
            draw_wave(ybase, levels)

    ax.set_xlim(-1.6, n + 0.2)
    ax.set_ylim(-0.4, rows * gap)
    ax.set_xticks(edges)
    ax.set_xticklabels([])
    ax.set_yticks([])
    for sp in ax.spines.values():
        sp.set_visible(False)
    if title:
        ax.set_title(title)
    fig.tight_layout()


def transient(
    num: list[float],
    den: list[float],
    t_end: float,
    *,
    kind: str = "step",
    n_points: int = 600,
    t_units: str = "ms",
    title: str | None = None,
) -> None:
    """Time-domain step or impulse response. `t_units` controls x-axis scaling
    (`'s'`, `'ms'`, `'us'`)."""
    import scipy.signal as sig

    sys = sig.TransferFunction(num, den)
    t = np.linspace(0, t_end, n_points)
    if kind == "impulse":
        t, y = sig.impulse(sys, T=t)
    else:
        t, y = sig.step(sys, T=t)

    scale = {"s": 1.0, "ms": 1e3, "us": 1e6}.get(t_units, 1.0)
    plt.close("all")
    plt.figure(figsize=(6.5, 3.5))
    plt.plot(t * scale, y, lw=2)
    plt.xlabel(f"Time ({t_units})")
    plt.ylabel("Response")
    plt.grid(True, alpha=0.3)
    if title:
        plt.title(title)

    # Mark the first-order time constant where output reaches ~63.2 % of final.
    if kind == "step" and len(y) > 5:
        y_final = float(y[-1])
        if y_final != 0:
            target = 0.632 * y_final
            idx = int(np.argmin(np.abs(y - target)))
            tau = float(t[idx])
            plt.axhline(target, color="grey", ls="--", lw=0.8)
            plt.axvline(tau * scale, color="grey", ls="--", lw=0.8)
            plt.text(tau * scale, target, r"  $\tau$", va="bottom")
    plt.tight_layout()


def load_line(
    iv_curve: Callable[[np.ndarray], np.ndarray],
    vdd: float,
    r: float,
    *,
    iv_label: str = "device I-V",
    v_label: str = "$V_D$ (V)",
    i_label: str = "$I_D$ (mA)",
    title: str | None = None,
) -> tuple[float, float]:
    """Plot a nonlinear device I-V curve against a resistive load line and mark
    the Q-point. Returns the Q-point as (V_q, I_q in amperes)."""
    v = np.linspace(0, vdd, 600)
    i_dev = np.asarray(iv_curve(v))
    i_load = (vdd - v) / r

    diff = i_dev - i_load
    sign = np.sign(diff)
    cross_idx = int(np.argmin(np.abs(diff))) if not np.any(sign[:-1] != sign[1:]) else int(
        np.where(sign[:-1] != sign[1:])[0][0]
    )
    v_q, i_q = float(v[cross_idx]), float(i_dev[cross_idx])

    plt.close("all")
    plt.figure(figsize=(6.5, 4))
    plt.plot(v, i_dev * 1e3, lw=2, label=iv_label)
    plt.plot(v, i_load * 1e3, lw=2, ls="--", label=f"load line ($V_{{DD}}={vdd:g}$ V, $R={r:g}\\,\\Omega$)")
    plt.plot(v_q, i_q * 1e3, "ro", markersize=8)
    plt.annotate(
        f"Q ({v_q:.2f} V, {i_q*1e3:.2f} mA)",
        xy=(v_q, i_q * 1e3),
        xytext=(v_q + 0.6, i_q * 1e3 + 0.5),
        arrowprops=dict(arrowstyle="->", color="grey"),
        fontsize=10,
    )
    plt.xlabel(v_label)
    plt.ylabel(i_label)
    plt.grid(True, alpha=0.3)
    plt.legend(loc="upper right")
    plt.xlim(0, vdd)
    plt.ylim(0, vdd / r * 1e3 * 1.1)
    if title:
        plt.title(title)
    plt.tight_layout()
    return v_q, i_q


def phasor(phasors: Iterable[dict], *, title: str | None = None) -> None:
    """Phasor diagram. Each phasor is {value: complex, label: str, color?: str}.
    Arrows are 1:1 in x/y so magnitudes are visually accurate."""
    items = list(phasors)
    if not items:
        return
    plt.close("all")
    fig, ax = plt.subplots(figsize=(5.2, 5.2))
    for p in items:
        z = complex(p["value"])
        color = p.get("color", "C0")
        ax.quiver(
            0, 0, z.real, z.imag,
            angles="xy", scale_units="xy", scale=1,
            color=color, headaxislength=3.5, headlength=5, width=0.008,
        )
        label = p.get("label")
        if label:
            ax.text(z.real * 1.05, z.imag * 1.05, label, color=color, fontsize=12)
    lim = max(abs(complex(p["value"])) for p in items) * 1.25
    ax.set_xlim(-lim, lim)
    ax.set_ylim(-lim, lim)
    ax.axhline(0, color="grey", lw=0.5)
    ax.axvline(0, color="grey", lw=0.5)
    ax.set_aspect("equal")
    ax.grid(True, alpha=0.3)
    ax.set_xlabel("Real")
    ax.set_ylabel("Imaginary")
    if title:
        ax.set_title(title)
    fig.tight_layout()


def torque_speed(
    t_stall: float,
    n_no_load: float,
    load_curve: Callable[[np.ndarray], np.ndarray] | None = None,
    *,
    title: str | None = None,
) -> tuple[float, float] | None:
    """DC motor torque-speed plot. `load_curve(n_rpm) -> torque (Nm)` if a load is
    given. Returns the operating point (n_rpm, torque_Nm) or None."""
    n = np.linspace(0, n_no_load * 1.05, 400)
    t_motor = t_stall * (1 - n / n_no_load)
    plt.close("all")
    plt.figure(figsize=(6.5, 4))
    plt.plot(t_motor, n, lw=2, label="motor T-n")
    op = None
    if load_curve is not None:
        t_load = np.asarray(load_curve(n))
        plt.plot(t_load, n, lw=2, ls="--", label="load T-n")
        diff = t_motor - t_load
        sign = np.sign(diff)
        if np.any(sign[:-1] != sign[1:]):
            idx = int(np.where(sign[:-1] != sign[1:])[0][0])
            op = float(n[idx]), float(t_motor[idx])
            plt.plot(op[1], op[0], "ro", markersize=8)
            plt.annotate(
                f"({op[1]:.2f} Nm, {op[0]:.0f} rpm)",
                xy=(op[1], op[0]),
                xytext=(op[1] + t_stall * 0.05, op[0] + n_no_load * 0.05),
                arrowprops=dict(arrowstyle="->", color="grey"),
                fontsize=10,
            )
    plt.xlabel("Torque (Nm)")
    plt.ylabel("Speed (rpm)")
    plt.grid(True, alpha=0.3)
    plt.legend(loc="best")
    if title:
        plt.title(title)
    plt.tight_layout()
    return op
