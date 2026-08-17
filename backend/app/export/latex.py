"""Markdown-to-LaTeX conversion for exam export.

Pragmatic, not a full Markdown engine: converts the subset that AIEA's
question markdown actually uses into compilable LaTeX for the `exam` class.
Math spans are protected before prose escaping so `$x_1$` survives intact.
Worker-side — the api only enqueues the render job.
"""
from __future__ import annotations

import re

_DISPLAY_MATH = re.compile(r"\$\$(.+?)\$\$", re.DOTALL)
_INLINE_MATH = re.compile(r"\$(.+?)\$", re.DOTALL)
_BOLD = re.compile(r"\*\*(.+?)\*\*", re.DOTALL)
_ITALIC = re.compile(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", re.DOTALL)
_IMAGE = re.compile(r"!\[[^\]]*\]\(([^)]+)\)")
_HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
_BULLET = re.compile(r"^\s*[-*]\s+(.*)$")
_TABLE_SEP = re.compile(r"^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$")

_ESCAPES = {"&": r"\&", "%": r"\%", "#": r"\#", "_": r"\_"}


def _escape_prose(text: str) -> str:
    """Escape LaTeX-special chars in prose only (math is already protected)."""
    return "".join(_ESCAPES.get(ch, ch) for ch in text)


def _split_row(line: str) -> list[str]:
    body = line.strip()
    if body.startswith("|"):
        body = body[1:]
    if body.endswith("|"):
        body = body[:-1]
    return [c.strip() for c in body.split("|")]


def _table_to_latex(rows: list[str], placeholders: dict[str, str]) -> str:
    """Convert a markdown table block (header, sep, body rows) to a tabular."""
    cells = [_split_row(r) for r in rows if not _TABLE_SEP.match(r)]
    if not cells:
        return ""
    ncols = max(len(r) for r in cells)
    col_spec = "l" * ncols
    out = [r"\begin{center}", r"\begin{tabular}{" + col_spec + "}", r"\toprule"]
    for i, row in enumerate(cells):
        padded = row + [""] * (ncols - len(row))
        out.append(
            " & ".join(_inline(c, placeholders) for c in padded) + r" \\"
        )
        if i == 0:
            out.append(r"\midrule")
    out += [r"\bottomrule", r"\end{tabular}", r"\end{center}"]
    return "\n".join(out)


_ITALIC_US = re.compile(r"(?<![\w\\])_(?!_)(.+?)(?<!_)_(?![\w])", re.DOTALL)


def _inline(text: str, placeholders: dict[str, str]) -> str:
    """Inline markup: images, bold / italic, escaped prose. Math kept as tokens."""
    imgs: dict[str, str] = {}

    def _stash_img(m: re.Match) -> str:
        token = f"\x00IMG{len(imgs)}\x00"
        imgs[token] = (
            r"\includegraphics[width=0.7\linewidth]{" + m.group(1).strip() + "}"
        )
        return token

    text = _IMAGE.sub(_stash_img, text)
    text = _BOLD.sub(lambda m: f"\x01B{m.group(1)}\x01", text)
    text = _ITALIC.sub(lambda m: f"\x01I{m.group(1)}\x01", text)
    text = _ITALIC_US.sub(lambda m: f"\x01I{m.group(1)}\x01", text)
    text = _escape_prose(text)
    text = re.sub(r"\x01B(.*?)\x01", lambda m: r"\textbf{" + m.group(1) + "}", text, flags=re.DOTALL)
    text = re.sub(r"\x01I(.*?)\x01", lambda m: r"\emph{" + m.group(1) + "}", text, flags=re.DOTALL)
    for token, latex in imgs.items():
        text = text.replace(token, latex)
    return text


def md_to_latex(md: str) -> str:
    """Convert one question's markdown body to a LaTeX fragment."""
    placeholders: dict[str, str] = {}

    def _stash(latex: str) -> str:
        token = f"\x00MATH{len(placeholders)}\x00"
        placeholders[token] = latex
        return token

    text = _DISPLAY_MATH.sub(
        lambda m: _stash(
            r"\begin{center}\adjustbox{max width=\linewidth}{$\displaystyle "
            + m.group(1).strip()
            + r"$}\end{center}"
        ),
        md,
    )
    text = _INLINE_MATH.sub(lambda m: _stash("$" + m.group(1).strip() + "$"), text)

    lines = text.split("\n")
    out: list[str] = []
    i = 0
    in_list = False

    def _close_list() -> None:
        nonlocal in_list
        if in_list:
            out.append(r"\end{itemize}")
            in_list = False

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if not stripped:
            _close_list()
            out.append("")
            i += 1
            continue

        img = _IMAGE.fullmatch(stripped)
        if img:
            _close_list()
            path = img.group(1).strip()
            out.append(r"\begin{center}")
            out.append(r"\includegraphics[width=0.7\linewidth]{" + path + "}")
            out.append(r"\end{center}")
            i += 1
            continue

        if (
            "|" in line
            and i + 1 < len(lines)
            and _TABLE_SEP.match(lines[i + 1])
        ):
            _close_list()
            block = [line]
            j = i + 1
            while j < len(lines) and "|" in lines[j] and lines[j].strip():
                block.append(lines[j])
                j += 1
            out.append(_table_to_latex(block, placeholders))
            i = j
            continue

        heading = _HEADING.match(line)
        if heading:
            _close_list()
            out.append(r"\subsection*{" + _inline(heading.group(2).strip(), placeholders) + "}")
            i += 1
            continue

        bullet = _BULLET.match(line)
        if bullet:
            if not in_list:
                out.append(r"\begin{itemize}")
                in_list = True
            out.append(r"\item " + _inline(bullet.group(1).strip(), placeholders))
            i += 1
            continue

        _close_list()
        out.append(_inline(stripped, placeholders))
        i += 1

    _close_list()
    body = "\n".join(out)
    for token, latex in placeholders.items():
        body = body.replace(token, latex)
    return body.strip()


_PREAMBLE = r"""\documentclass[11pt,addpoints]{exam}
\usepackage{amsmath,amssymb,graphicx,booktabs,adjustbox}
\usepackage[margin=1in]{geometry}
\usepackage{xcolor}
"""


def _rewrite_graphics(body: str, figures_dir: str) -> str:
    r"""Resolve relative \includegraphics paths against the question's figures_dir.

    The question markdown writes its figure refs relative to the question
    folder (e.g. ``figures/fig1.png``). The exam render places each question's
    figures under ``<exam_dir>/figures/<question_id>/`` and tells this rewrite
    to prefix with ``figures/<question_id>``. To avoid the doubled
    ``figures/figures/fig1.png`` that results from naive concatenation, we
    strip any leading ``figures/`` from the source path before prefixing.
    """
    if not figures_dir:
        return body

    def _sub(m: re.Match) -> str:
        path = m.group(2)
        if path.startswith("/"):
            return m.group(0)
        # Strip leading "figures/" (or "figures\") so concatenation produces
        # exactly one such segment.
        if path.startswith("figures/"):
            path = path[len("figures/") :]
        elif path.startswith("./figures/"):
            path = path[len("./figures/") :]
        return r"\includegraphics" + (m.group(1) or "") + "{" + f"{figures_dir}/{path}" + "}"

    return _GRAPHICS.sub(_sub, body)


def read_exam_template(materials_path: Path | None) -> dict | None:
    """Look for a `materials/exam-template/` folder with a .sty + instructions.tex
    and return them if found. Returns None when the user hasn't provided a
    template — caller falls back to the built-in `exam`-class default.
    """
    if materials_path is None:
        return None
    tdir = materials_path / "exam-template"
    if not tdir.is_dir():
        return None
    sty_files = sorted(tdir.glob("*.sty"))
    instructions = tdir / "instructions.tex"
    if not sty_files:
        return None
    return {
        "dir": tdir,
        "sty_files": [p.name for p in sty_files],
        "primary_sty": sty_files[0].stem,
        "has_instructions": instructions.is_file(),
    }


def build_exam_master_tex(
    title: str,
    instructions_md: str,
    template: dict | None = None,
    meta: dict | None = None,
    *,
    print_solutions: bool = False,
) -> str:
    r"""Assemble a master exam.tex / solution.tex — the file the user edits per-exam.

    It contains the preamble, per-exam macros (\examdate, \besokstid, …),
    and a single `\input{_questions}` line where the auto-generated question
    blocks live. The questions themselves are written to _questions.tex on
    every rebuild; this master file is written only on first render so user
    edits (custom examiner line, extra macros, etc.) survive subsequent
    rebuilds.

    When `print_solutions=True` the solution environment is shown (exsheets
    `solution/print=true` for the template path; `\\printanswers` for the
    built-in `exam` class). This produces the solutions PDF.
    """
    if template is not None:
        return _build_master_template_tex(
            title, instructions_md, template, meta, print_solutions=print_solutions
        )
    parts: list[str] = [_PREAMBLE]
    if print_solutions:
        parts.append(r"\printanswers")
    parts.append(r"\begin{document}")
    parts.append(r"\begin{center}\Large\textbf{" + _inline(title, {}) + r"}\end{center}")
    parts.append("")
    parts.append(r"\input{_questions}")
    parts.append(r"\end{document}")
    return "\n".join(parts) + "\n"


def _solution_body(item: dict) -> str:
    """Combine answer_md + worked_solution_md into one LaTeX fragment."""
    figures_dir = str(item.get("figures_dir") or "").rstrip("/")
    parts: list[str] = []
    ans = str(item.get("answer_md") or "").strip()
    worked = str(item.get("worked_solution_md") or "").strip()
    if ans:
        parts.append(_rewrite_graphics(md_to_latex(ans), figures_dir))
    if worked:
        if parts:
            parts.append("")
        parts.append(_rewrite_graphics(md_to_latex(worked), figures_dir))
    return "\n".join(parts).strip()


def build_questions_tex(
    items: list[dict],
    instructions_md: str = "",
    template: dict | None = None,
) -> str:
    r"""Build the regenerated _questions.tex — overwritten every rebuild.

    Holds the actual question blocks (and the optional `instructions_md`
    paragraph when no template is in use). The master exam.tex just
    `\input{_questions}`s this file. A `\begin{solution}…\end{solution}`
    block is emitted after each question; it renders only when the master
    has `solution/print=true` (template path) or `\printanswers` (built-in
    `exam` class), so the same _questions.tex powers both the exam PDF and
    the solutions PDF.
    """
    if template is not None:
        return _build_questions_template_tex(items)
    parts: list[str] = []
    if instructions_md and instructions_md.strip():
        parts.append(md_to_latex(instructions_md))
        parts.append("")
    parts.append(r"\begin{questions}")
    for item in items:
        prompt = str(item.get("prompt_md") or "")
        prompt_sv = str(item.get("prompt_md_sv") or "").strip()
        points = item.get("points")
        figures_dir = str(item.get("figures_dir") or "").rstrip("/")
        body_en = _rewrite_graphics(md_to_latex(prompt), figures_dir)
        head = r"\question"
        if isinstance(points, int):
            head += f"[{points}]"
        if prompt_sv:
            body_sv = _rewrite_graphics(md_to_latex(prompt_sv), figures_dir)
            parts.append(head + r" \textbf{EN}: " + body_en)
            parts.append("")
            parts.append(r"\textbf{SE}: " + body_sv)
        else:
            parts.append(head + " " + body_en)
        sol = _solution_body(item)
        if sol:
            parts.append(r"\begin{solution}")
            parts.append(sol)
            parts.append(r"\end{solution}")
        parts.append("")
    parts.append(r"\end{questions}")
    return "\n".join(parts) + "\n"


def _build_master_template_tex(
    title: str,
    instructions_md: str,
    template: dict,
    meta: dict | None = None,
    *,
    print_solutions: bool = False,
) -> str:
    """Master exam.tex when the user has provided a custom .sty template.

    Mirrors the SSY300 reference structure: article class, custom .sty,
    per-exam macros, `\\input{instructions}` (when present), then a single
    `\\input{_questions}` for the regenerated blocks.
    """
    sty = template["primary_sty"]
    has_instructions = template["has_instructions"]
    meta = meta or {}
    examdate = meta.get("examdate") or title
    besokstid = meta.get("besokstid") or ""
    visninga = meta.get("visninga") or ""
    visningb = meta.get("visningb") or ""
    sol_flag = "true" if print_solutions else "false"
    lines: list[str] = [
        r"\documentclass[a4paper,12pt]{article}",
        rf"\usepackage{{{sty}}}",
        r"\usepackage{booktabs}",
        r"\usepackage{adjustbox}",
        rf"\newcommand{{\examdate}}{{{_escape_prose(examdate)}}}",
        rf"\newcommand{{\besokstid}}{{{_escape_prose(besokstid)}}}",
        rf"\newcommand{{\visninga}}{{{_escape_prose(visninga)}}}",
        rf"\newcommand{{\visningb}}{{{_escape_prose(visningb)}}}",
        rf"\SetupExSheets{{solution/print={sol_flag}, solution/name={{}}}}",
        r"\begin{document}",
    ]
    if has_instructions:
        lines.append(r"\input{instructions}")
        lines.append("")
    else:
        lines.append(
            r"\begin{center}\Large\textbf{" + _inline(title, {}) + r"}\end{center}"
        )
        lines.append("")
        if instructions_md and instructions_md.strip():
            lines.append(md_to_latex(instructions_md))
            lines.append("")
    lines.append(r"\input{_questions}")
    lines.append(r"\end{document}")
    return "\n".join(lines) + "\n"


def _build_questions_template_tex(items: list[dict]) -> str:
    """_questions.tex body for the SSY300-style template path."""
    lines: list[str] = []
    for item in items:
        prompt = str(item.get("prompt_md") or "")
        prompt_sv = str(item.get("prompt_md_sv") or "").strip()
        points = item.get("points")
        figures_dir = str(item.get("figures_dir") or "").rstrip("/")
        # Figures are language-independent: strip them out of both language
        # bodies and emit each once, after the bilingual text (no duplicate).
        fig_paths = [p.strip() for p in _IMAGE.findall(prompt)]
        body_en = md_to_latex(_IMAGE.sub("", prompt))
        body_sv_src = _IMAGE.sub("", prompt_sv)
        pts = points if isinstance(points, int) else 1
        lines.append(rf"\begin{{question}}{{{pts}}}")
        if body_sv_src.strip():
            body_sv = md_to_latex(body_sv_src)
            lines.append(r"\textbf{SE}: " + body_sv)
            lines.append("")
            lines.append(r"\textbf{EN}: " + body_en)
        else:
            lines.append(body_en)
        for fp in fig_paths:
            inc = _rewrite_graphics(
                r"\includegraphics[width=0.6\linewidth]{" + fp + "}", figures_dir
            )
            lines.append(r"\begin{center}" + inc + r"\end{center}")
        sol = _solution_body(item)
        if sol:
            lines.append(r"\begin{solution}")
            lines.append(sol)
            lines.append(r"\end{solution}")
        lines.append(r"\end{question}")
        lines.append("")
    return "\n".join(lines) + "\n"


# Back-compat shim — callers outside the worker may still ask for the
# combined render. Used when previewing on its own, never on disk.
def build_exam_tex(
    title: str,
    instructions_md: str,
    items: list[dict],
    template: dict | None = None,
    meta: dict | None = None,
) -> str:
    """Combined master + questions in one string (legacy preview path)."""
    master = build_exam_master_tex(title, instructions_md, template, meta)
    body = build_questions_tex(items, instructions_md, template)
    # Inline the body in place of \input{_questions} so the legacy single-
    # file output keeps compiling stand-alone.
    return master.replace(r"\input{_questions}", body.rstrip())


_GRAPHICS = re.compile(r"\\includegraphics(\[[^\]]*\])?\{([^}]*)\}")
