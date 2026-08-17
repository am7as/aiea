"""Lenient JSON parsing for model output.

Models that put LaTeX inside JSON string values routinely emit invalid escape
sequences — `\\Delta`, `\\left`, `\\frac` — which `json.loads` rejects. `loads`
retries once with lone backslashes doubled when a clean parse fails.
"""
from __future__ import annotations

import json
import re

# Matches either a complete valid JSON escape (group 1) or a lone backslash +
# any char (group 2). Consuming valid escapes — including the `\\` pair — as a
# unit is what stops a per-character scan corrupting the boundary of a real
# `\\`. `\n \r \t` stay valid; `\b \f` are treated as LaTeX (`\beta`, `\frac`).
_ESCAPE = re.compile(r'\\(["\\/nrt]|u[0-9a-fA-F]{4})|\\(.)', re.DOTALL)


def _fix_escapes(text: str) -> str:
    """Double every lone backslash, leaving genuine JSON escapes intact."""
    return _ESCAPE.sub(
        lambda m: m.group(0) if m.group(1) is not None else "\\\\" + m.group(2),
        text,
    )


def loads(text: str) -> object:
    """Parse model JSON, repairing lone backslashes first.

    The repair runs unconditionally — `\\frac` / `\\beta` are *valid* JSON
    escapes (`\\f`, `\\b`), so a plain json.loads silently mangles them into
    control characters without ever raising. `_fix_escapes` only ever emits
    valid escapes, so it cannot introduce an escape error of its own.

    `strict=False` allows literal control characters (newlines/tabs) inside
    string values — models routinely put multi-line markdown in a JSON string.
    If the model appended prose after the JSON value (an 'Extra data' error),
    fall back to decoding just the first value. As a last resort, a structural
    repair pass (`json_repair`, if installed) fixes unescaped quotes, missing or
    trailing commas — the malformations strict parsing can't recover."""
    fixed = _fix_escapes(text)
    try:
        return json.loads(fixed, strict=False)
    except json.JSONDecodeError:
        pass
    try:
        return json.JSONDecoder(strict=False).raw_decode(fixed.lstrip())[0]
    except json.JSONDecodeError:
        pass
    try:
        import json_repair
    except ModuleNotFoundError:
        return json.loads(fixed, strict=False)  # re-raise the original parse error
    try:
        return json_repair.loads(fixed)
    except Exception as exc:  # noqa: BLE001
        raise json.JSONDecodeError(f"unrepairable model JSON: {exc}", fixed[:200], 0) from exc


def _strip_fence(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        lines = raw.splitlines()[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        raw = "\n".join(lines).strip()
    return raw


def extract_object(text: str) -> dict:
    """Parse the first {...} object out of model text (strips fences / prose)."""
    raw = _strip_fence(text)
    start, end = raw.find("{"), raw.rfind("}")
    if start != -1 and end > start:
        raw = raw[start : end + 1]
    data = loads(raw)
    if not isinstance(data, dict):
        raise ValueError("model output was not a JSON object")
    return data


def extract_array(text: str) -> list[dict]:
    """Parse a JSON array of objects out of model text."""
    raw = _strip_fence(text)
    start, end = raw.find("["), raw.rfind("]")
    if start != -1 and end > start:
        raw = raw[start : end + 1]
    data = loads(raw)
    if isinstance(data, dict):
        for v in data.values():
            if isinstance(v, list):
                return [x for x in v if isinstance(x, dict)]
        return [data]
    if isinstance(data, list):
        return [x for x in data if isinstance(x, dict)]
    raise ValueError("model output was not a JSON array of objects")
