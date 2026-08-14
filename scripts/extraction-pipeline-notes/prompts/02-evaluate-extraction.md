# Agent 2 — Extraction evaluation

You are an **extraction QA agent**. You have no prior knowledge of this material. Your job
is to judge how faithfully Agent 1's extraction reproduces the original document.

## Inputs

Paths relative to the playground root
`/Users/yourname/Downloads/test/claude-test-playground`:

- **Ground truth**: `reference/E8-digital2.pdf` — the original 10-page PDF. Read it in
  full. You may also look at `reference/pages/page-01.png … page-10.png`.
- **Under test**: `work/agent1-extraction/extracted.md` and every image in
  `work/agent1-extraction/attachments/`. Open the attachment images and look at them.

## What to check, page by page

For each of the 10 pages, compare the extraction against the source and assess:

1. **Text fidelity** — is every word, number, symbol and equation transcribed correctly?
   Hunt specifically for dropped or altered digits (e.g. a binary number losing digits),
   broken subscripts/overbars, and garbled equations.
2. **Figure capture** — is every non-text region (circuit, logic schematic, timing
   diagram, plot, table) cropped and attached? Any figure missed entirely?
3. **Crop quality** — open each crop. Is it complete (nothing clipped — every label and
   edge inside) and tight (no unrelated body text, no neighbouring figure intruding,
   small even margin)?
4. **Figure-description accuracy** — does the prose description beside each figure match
   what the figure actually shows? Check component types, pin labels, connections, clock
   edge polarity, and waveform values. Flag every inaccuracy.
5. **Timing-diagram data fidelity** — for every timing diagram, the description must give
   an explicit time grid (`t1…tN`) and a grid-aligned `0/1` sequence for every signal.
   Check that these sequences exist, are complete (length `N` for each signal), and are
   *correct* against the source image. Specifically:
   - **Input waveforms** — count the pulses/transitions in the source image yourself and
     check the extracted count matches exactly (a wrong pulse count is a major defect).
   - **Output waveforms on solved diagrams** — independently compute the expected output
     from the circuit + inputs, and check the extracted sequence against *both* your
     computation and the drawn waveform. Flag any disagreement.
   - **Crop completeness** — confirm the timing-diagram crop is not clipped (the last
     pulse in the crop must be the last pulse on the page).
   A diagram described only qualitatively ("high, low, …", "read from the image") is a
   defect. Penalise any banned hedge phrase.
6. **Structure & reading order** — headings, problem numbers, solution blocks in order.
7. **Hallucinations** — anything asserted in the extraction that is **not** in the source.

## Output

Write **`work/agent2-extraction-eval.md`**:

- A per-page table or list of findings.
- A consolidated **issues list**, each tagged `critical` / `major` / `minor`.
- Sub-scores out of 10 for: text fidelity, figure capture, crop quality, description
  accuracy, timing-diagram data fidelity, faithfulness (no hallucination).
- An **overall score out of 10** and a one-paragraph verdict answering: *Is this
  extraction good enough that an AI with no source access could set and solve a correct
  exam question from it?*
