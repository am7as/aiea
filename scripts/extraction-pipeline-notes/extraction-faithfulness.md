# Skill — Figure-aware faithful extraction

The goal of extraction is a **self-contained** result: a Markdown file plus a folder of
cropped image attachments, such that a downstream AI with **no access to the original
source** can fully understand the material — enough to set *and* solve exam questions on
it, including questions that reuse the exact data shown in a figure.

Plain text alone is not enough. Course material in engineering, science and maths is full
of information that **cannot survive being turned into prose**: circuit diagrams, logic
schematics, timing/waveform diagrams, plots, geometric figures, flowcharts, data tables,
photographs, and equations that appear as images. For that content, a vague
`[Figure: a circuit with some flip-flops]` is worthless — the diagram *is* the problem.

## The two-channel rule

Extract every page into **two channels**:

1. **Text channel** — everything that is genuinely text. Transcribe it faithfully.
2. **Visual channel** — every region that is *not* plain text. Crop it to its own image,
   attach it, and write a detailed description beside it.

## The no-escape-hatch rule

The description is a **complete record**, not a pointer to the image. You are looking at
the image right now — read everything off it *now*. The following phrases are **banned**
from every description:

- "read the exact … from the image" / "see the image for details"
- "roughly", "approximately", "qualitatively" (when describing a value you can actually
  read), "the diagram shows … (consult the crop)"

If you can see it, state it precisely. If you genuinely cannot resolve it even after
zooming, write `[unclear: <what and why>]` — that is the *only* permitted hedge, and it
must name the specific thing in doubt.

## Text channel rules

- Transcribe **exactly**. Every digit, sign, subscript, and symbol. Never "round", "tidy",
  or "fix" the source. If the source says `1011 0110`, write `1011 0110` — not `10110`.
- Preserve **reading order** and document structure (headings, lists, problem numbers).
- Render mathematics in LaTeX: `$inline$` and `$$display$$`. Preserve overbars
  (`\overline{}`), subscripts, indices exactly.
- **Hard-to-read maths must also be cropped.** If an equation uses stacked/nested overbars,
  dense notation, unusual symbols, or anything you cannot transcribe with *full
  certainty*, then: (a) give your best-effort LaTeX transcription, (b) **also crop the
  equation as a figure**, and (c) name exactly which symbols are uncertain. Never
  transcribe-and-guess a maths expression as if it were certain. On a **dense mathematical
  page** (multi-line derivations, matrices, indexed sums, subscript/superscript-heavy
  expressions) the bar for "crop it too" is *low* — when in doubt, crop the equation block;
  a transcription error in a single exponent or index silently breaks every question built
  on it.
- If text is unreadable or ambiguous, write `[unclear: ...]`. Never guess.

## Visual channel rules

For **each** non-text region on a page:

1. **Crop a tight snapshot of just that region** — not the whole page. The crop must be:
   - **Complete first**: every label, axis, signal name, pin marking and edge of the
     drawing fully inside the crop. Nothing clipped. When in doubt, start a little wider.
   - **Then tight**: trim so there is only a small even margin (about 2% of the figure
     size) around the content, and no unrelated text or neighbouring figure inside it.
   - **Verify**: after cropping, **re-open the crop and look at it**. If anything is
     clipped at an edge, or a stray heading/body line is included, or another figure
     intrudes — re-crop. Do not accept a crop you have not eyeballed.

2. **Save it** to the `attachments/` subfolder with a descriptive, ordered filename:
   `page-<NN>-<seq>-<short-slug>.png`, e.g. `page-04-01-jk-flipflop-circuit.png`.
   Sequence numbers preserve reading order.

3. **Embed it** in the Markdown at the correct position in reading order:

   ```
   ![page 4 — JK flip-flop driving two NAND gates](attachments/page-04-01-jk-flipflop-circuit.png)

   **Figure description.** <exhaustive description — see below>
   ```

## What a figure description must contain

The description must let a reader who **cannot see the image** reconstruct the figure's
content completely — and, where the figure carries data, *use that data*. Be exhaustive,
concrete, and structured.

- **Circuit / logic schematic** — every component and its type (gate kind, flip-flop type
  T/D/JK/SR); every labelled input, output, and pin (`J`, `K`, `CK`, `Q`,
  `\overline{Q}`); every wire and what it connects to what; constants tied to inputs
  (e.g. "J tied to logic 1"); clock edge polarity (rising / falling — note the inversion
  bubble on `CK`); feedback paths. State the function in words if derivable.
- **Timing / waveform diagram** — follow the mandatory method below.
- **Plot / graph** — axes (label, unit, range, scale), every curve, key points,
  intercepts, asymptotes, annotations.
- **Table** — transcribe it as a proper Markdown table in the text channel. If it is also
  visually complex, additionally crop it.
- **Geometric figure** — all points, lines, angles, lengths, labels, given/unknown marks.
- **Photo / apparatus** — what it shows and every labelled part.

## Timing / waveform diagrams — mandatory method

A timing diagram is **data**, not decoration, and it is the single hardest thing to extract
correctly. Reading several stacked hand-drawn waveforms at once is error-prone — miscounted
pulses, a misread initial level, and confident-but-wrong output rows are the most common
extraction failures. Follow this six-step method **exactly**. Do not eyeball the whole
diagram at once.

### Step 1 — Crop the whole diagram, full width, never clipped

Crop the entire timing diagram into one attachment. It **must** include the full width of
the time axis: if the waveforms run to the page edge, crop to the page edge. After
cropping, count the pulses (or transitions) of the longest row in your crop and confirm the
last one is the last one visible on the page itself. If your crop ends before the diagram
does, re-crop wider. **A clipped timing crop is a critical defect** — the missing part will
be guessed.

### Step 2 — Classify every row

List the rows top to bottom and mark each one:
- **INPUT / source signal** — a *given* waveform (`A`, `B`, `C`, `Input`, a clock). Its
  shape is real data that exists only in the drawing.
- **OUTPUT / derived signal** — a flip-flop or gate output (`Q`, `Q1`, `Y`, `Z`, `\overline{Q}`).
  On a *solved* diagram it is drawn; on a *template* diagram it is blank.

### Step 3 — Read each INPUT row in isolation

For every input row, crop **that row alone** to its own image at high DPI (e.g. 400, so the
strip is tall and legible) and save it under `attachments/` (name it
`page-NN-<seq>-row-<signal>.png`). Read the waveform from that single strip, not from the
stacked diagram:
- Count the pulses / transitions **explicitly, one at a time**. If the row is long, crop it
  in halves and count each half. State the count as a number.
- Write the level in every time slot as a `0/1` sequence.
- Re-count once to confirm. **Never round the count to a tidy number** (if you read 13, it
  is 13 — not 16).

### Step 4 — Anchor the time grid to the primary input

Pick the finest-resolution input (usually the clock / `Input`). Its natural slots define
the grid `t1…tN`; `N` is its **counted** slot count — never a guessed round number. Every
other row is expressed against this same grid.

### Step 5 — OUTPUT rows: compute first, then confirm

Do **not** primarily "read" output waveforms — **derive** them:
- From the circuit you transcribed plus the input waveforms, **compute** each output signal
  step by step (apply the flip-flop / gate rules at each active clock edge).
- Then look at the drawn waveform and **confirm** your computation matches it.
- Match → record the sequence, mark it `(computed, confirmed by drawing)`.
- Mismatch → your input reading or your circuit reading is probably wrong; re-examine both
  and recompute. If they still disagree after careful re-checking, record the value
  **drawn in the source** (it is the official answer key) and add a `[note: ...]` giving
  the computed alternative and stating that drawing and logic disagree. Never silently pick.
- On a *template* diagram the output rows are blank — write `blank — to be derived by the
  student`. Do not invent values.

### Step 6 — Initial values

State each signal's value at `t0` (before the first slot) explicitly, from the left-hand
stub of the waveform **and** from any initial condition stated in the text. If the text
says e.g. `Q(t0)=0` but the stub looks otherwise, re-examine — you have probably misread
the stub or the diagram has a separate pre-count segment.

### Output requirement

Every timing-diagram description must contain: the full-width diagram crop; a per-row crop
for every input signal; the row classification; the **counted** `N`; an explicit
grid-aligned `0/1` sequence for every signal, each tagged `(read)` or `(computed)`; and an
explicit `t0` value per signal. A description missing any of these is incomplete and must
be redone.

## Faithfulness — hard rules

- **Never invent.** If a connection or value is not visible, do not assert it. Write
  `[unclear: ...]` and describe what you can see.
- **Never summarize away detail.** "Some flip-flops in a chain" is a failure. Count them,
  name them, trace them.
- **Never correct the source.** If the source has an apparent error, transcribe it as-is
  and add `[note: the source appears inconsistent here — ...]`.
- **Do not blame the source for your own doubt.** Only write `[note: source error]` when
  you are *highly confident*, after zooming, that the printed source itself is wrong. If
  you are unsure whether a discrepancy is a genuine source typo or your own misreading,
  flag it as `[unclear: ...]` — a transcription doubt — **not** as a source error.
  Misattributing your own mistake to the source is worse than admitting uncertainty: a
  question author trusts the `[note:]` and propagates the wrong value believing the
  textbook is at fault.
- **Numbers are sacred.** Dropping or adding a digit changes the answer. Double-check every
  numeral against the image.
- **Be internally consistent.** Do not state an initial value in one sentence and then
  contradict it in the next. Re-read your own description before moving on.
- **Flag low confidence.** Anything you are unsure of must say which part is uncertain.

## Output file shape

`extracted.md` — YAML frontmatter (`title`, `source`, `pages`, `extracted_by`,
`extracted_at`), then one `## Page N` section per page, with text and embedded figures
interleaved in reading order. All cropped images live in `attachments/` next to it.
