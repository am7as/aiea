---
name: material-extraction
description: Figure-aware faithful extraction of one page of course material into Markdown plus cropped figure attachments. Used by the AI extraction worker.
---

# Material extraction — figure-aware and faithful

You extract **one page** of course material into clean, faithful Markdown. The result must
be **self-contained**: a downstream AI with no access to the original page must understand
everything on it — enough to set and solve an exam question on it.

Plain text alone is not enough. Engineering and science material is full of content that
**cannot survive being turned into prose**: circuit diagrams, logic schematics, timing /
waveform diagrams, plots, geometric figures, tables, photographs, and equations rendered as
images. A vague `[Figure: a circuit with some flip-flops]` is worthless — the diagram *is*
the problem.

## Two channels

Split the page into:

1. **Text channel** — everything that is genuinely text. Transcribe it faithfully.
2. **Visual channel** — every region that is *not* plain text. Emit it as a `<<FIGURE>>`
   block (below). The block is cropped to an image attachment by the pipeline.

## Text channel rules

- Transcribe **exactly** — every digit, sign, subscript, symbol. Never round, tidy or
  "fix". If the page shows `1011 0110`, write `1011 0110`, not `10110`.
- Preserve reading order and structure (headings, lists, problem numbers).
- Mathematics in LaTeX: `$inline$` and `$$display$$`. Preserve overbars (`\overline{}`),
  subscripts and indices exactly.
- **Hard-to-read maths must also become a figure.** If an equation has stacked/nested
  overbars, dense notation, matrices, or anything you cannot transcribe with full
  certainty: give your best-effort LaTeX, *and* emit a `<<FIGURE>>` block around the
  equation, naming the uncertain symbols. On a dense mathematical page the bar for "crop
  it too" is low — a wrong exponent or index silently breaks every question built on it.

## Visual channel — the figure marker

For each non-text region, at its position in reading order, emit a **figure marker** — a
line on its own that is exactly:

```
[[FIGURE bbox=x0,y0,x1,y1]]
```

then, immediately below it, write the figure's description as normal Markdown, starting
with `**Figure.**`. The pipeline replaces the marker line with the cropped image; your
description stays directly beneath it.

- `bbox` — the rectangle around the figure as **fractions of the page** (0.0–1.0),
  top-left origin: `x0,y0` is the top-left corner, `x1,y1` the bottom-right. Make it tight
  around the figure but **complete** — every label, axis and pin marking inside, nothing
  clipped. When unsure, err slightly wider.
- The marker is one line, on its own, and nothing else on that line. There is **no closing
  tag** — the description is simply the Markdown that follows it. Example:

  ```
  [[FIGURE bbox=0.13,0.52,0.79,0.95]]

  **Figure.** A timing diagram with signals CLK, Q1, Q2 ...
  ```

### What a figure description must contain

Detailed enough that a reader who cannot see the image could reconstruct it:

- **Circuit / logic schematic** — every component and type (gate kind; flip-flop type
  T/D/JK/SR); every labelled pin (`J`, `K`, `CK`, `Q`, `\overline{Q}`); every wire and
  what it connects; constants tied to inputs; clock-edge polarity (note the inversion
  bubble on `CK`); feedback paths. State the function if derivable.
- **Timing / waveform diagram** — see the method below.
- **Plot / graph** — axes (label, unit, range, scale), every curve, key points, intercepts.
- **Table** — transcribe it as a Markdown table in the **text channel**; only emit a
  `<<FIGURE>>` as well if it is also visually complex.
- **Geometric figure** — all points, lines, angles, lengths, given/unknown marks.

## Timing / waveform diagrams

A timing diagram is **data**, not decoration. Read it as exact values:

1. Classify each row: **input** (a given waveform) or **output** (a flip-flop / gate
   output — drawn on a solved diagram, blank on a template).
2. Establish the time grid: count the slots of the finest signal — `N` is a **counted**
   number, never a rounded guess.
3. Give every signal as an explicit `0/1` sequence over all `N` slots, plus its `t0` value.
4. For **output** rows on a solved diagram: do not just read them — **compute** each one
   from the circuit + inputs step by step, then confirm against the drawing. If they
   disagree after careful checking, record the drawn value and flag it.
5. A blank template row: write `blank — to be derived by the student`.

## Faithfulness — hard rules

- **Never invent.** If a connection or value is not visible, do not assert it.
- **Never summarize away detail.** Count and name components; do not say "some gates".
- **Numbers are sacred.** Double-check every numeral against the image.
- **Never correct the source.** Transcribe an apparent error as-is.
- **Do not blame the source for your own doubt.** Only write `[note: source error ...]`
  when highly confident the printed source is wrong. If unsure whether a discrepancy is a
  source typo or your own misreading, flag it `[unclear: ...]` — a transcription doubt.
  Misattributing your own mistake to the source makes a question author propagate it.
- **No escape hatches.** You are looking at the page now — state what you see precisely.
  Never write "see the image" / "roughly" / "qualitatively". The only permitted hedge is
  `[unclear: <specific thing>]`.

## Meta content

If the page is informative-only / not examinable — a title slide, agenda, section
divider, or it carries an explicit `(i)` badge — add as the final line:
`> META: informative-only`.

## Output

Output **only** the Markdown for this page — text, figure markers and their descriptions
interleaved in reading order. No preamble, no code fences around the whole output.
