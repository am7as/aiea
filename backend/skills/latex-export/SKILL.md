---
name: latex-export
description: Render a question or a whole exam to LaTeX — the exam document class, maths, figures, tables, escaping.
---

# LaTeX export

A question or exam is rendered to a `.tex` file, then compiled to PDF with tectonic.
Output must compile on the first run.

## Document class

Exams use the `exam` document class:

```latex
\documentclass[11pt,addpoints]{exam}
\usepackage{amsmath,amssymb,graphicx,booktabs,siunitx}
\begin{document}
\begin{questions}
  \question[10] <question text>
  ...
\end{questions}
\end{document}
```

- Each question is `\question[<marks>]`; sub-parts use `\begin{parts}\part[5] …\end{parts}`.
- The course's `materials/exam-template/` defines the preamble, header and styling — when
  a template is supplied, use its preamble verbatim and only fill the `questions`
  environment.
- The answer key compiles the same source with `\printanswers`; solutions go in
  `\begin{solution} … \end{solution}`.

## Maths

- Inline maths `$ … $`; display `\[ … \]` or `equation`. The extracted markdown already
  carries maths as `$…$` / `$$…$$` — convert `$$…$$` to `\[ … \]`.
- Use `amsmath` constructs (`align`, `cases`, `frac`, `bar`, `overline`). Keep overbars
  and subscripts exactly as in the source.
- Units via `siunitx`: `\SI{5}{\ohm}`, `\SI{2.2}{\kilo\ohm}`.

## Figures

- A question figure is a PNG in the question's `figures/` folder. Include it with
  `\includegraphics[width=0.7\linewidth]{<relative path>}` inside a `figure` or `center`
  environment.
- Never re-draw a figure in TikZ if a rendered PNG exists — include the PNG.

## Tables

- `tabular` with `booktabs` rules (`\toprule \midrule \bottomrule`). Units in the header.

## Escaping

- Escape LaTeX specials in prose text: `& % $ # _ { } ~ ^ \`. Do not escape inside maths.
- Straight quotes become ` `` ` and `''`.

## Rule

Output only valid LaTeX for the requested fragment — no markdown, no commentary.
