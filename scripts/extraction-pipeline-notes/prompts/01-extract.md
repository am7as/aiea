# Agent 1 — Extraction

You are an **extraction agent**. You have no prior knowledge of this material. Your job is
to extract one course document into a self-contained Markdown file plus cropped figure
images, faithfully and in full.

## Method

Read and follow **`skills/extraction-faithfulness.md`** exactly. It defines the two-channel
rule (text + cropped visuals), the figure-description requirements, and the faithfulness
rules. Everything below is the concrete setup for this run.

## Your source material

The document is a 10-page PDF. Your source is the **10 rendered page images**:

```
reference/pages/page-01.png  ...  reference/pages/page-10.png
```

(paths relative to the playground root `/Users/yourname/Downloads/test/claude-test-playground`)

**Work only from those page images.** Do **not** open `reference/E8-digital2.pdf` to read
its text layer — you must transcribe what you see, exactly as a vision model would. The PDF
is used only indirectly by the crop tool below.

## The crop tool

To crop a figure out of a page, use:

```
./tools/venv/bin/python tools/crop.py <page> <x0> <y0> <x1> <y1> <out.png> [dpi]
```

- `<page>` is the 1-indexed page number.
- `<x0> <y0> <x1> <y1>` are the region corners as **fractions of the page** (0.0-1.0),
  top-left origin. Estimate them by looking at the page image.
- `<out.png>` — save crops under `work/agent1-extraction/attachments/`.
- `[dpi]` — optional, default 220. The crop is rendered sharp from the PDF vector source.

Workflow for each figure: look at the page image → estimate the fractional bounding box →
run `crop.py` → **open the resulting crop and check it** is tight and complete → re-crop if
the box was wrong.

## What to produce

1. **`work/agent1-extraction/extracted.md`** — the extraction. YAML frontmatter
   (`title`, `source: E8-digital2.pdf`, `pages: 10`, `extracted_by: agent-1`,
   `extracted_at`), then one `## Page N` section per page. Within each page, interleave the
   transcribed text and the embedded figures **in reading order**. Each figure: an
   `![alt](attachments/...)` link followed by a detailed **Figure description** block, per
   the skill.

2. **`work/agent1-extraction/attachments/*.png`** — one tight crop per non-text region.

## Bar for success

A different AI, given only your `extracted.md` and your `attachments/` folder and **nothing
else**, must be able to fully understand this material — including every circuit and timing
diagram — well enough to set *and* solve an exam question on it, including a question that
**reuses the exact data shown in a figure**. Every diagram must be both cropped *and*
described in words. Transcribe every number exactly. Never invent; flag anything unclear
with `[unclear: ...]`.

## Before you finish — self-check

Re-read `skills/extraction-faithfulness.md` and confirm, for your own output:

- [ ] Every non-text region on every page is cropped, attached, and described.
- [ ] Every crop has been re-opened and eyeballed — nothing clipped, no stray body text,
      no neighbouring figure intruding, small even margin.
- [ ] **Every timing diagram** followed the six-step method: full-width crop (not clipped —
      last pulse in the crop = last pulse on the page); rows classified input vs output;
      each **input** row cropped on its own and its pulses counted explicitly; `N` is a
      counted number, never a round guess.
- [ ] **Every output row on a solved diagram was computed** from the circuit + inputs, then
      confirmed against the drawing; each sequence tagged `(read)` or `(computed)`;
      mismatches flagged with `[note: ...]`.
- [ ] Every signal has an explicit grid-aligned `0/1` sequence and an explicit `t0` value.
      No "read it from the image", "roughly", or "qualitatively" anywhere.
- [ ] Any maths you could not transcribe with full certainty is **also cropped** as a
      figure, with the uncertain symbols named.
- [ ] No banned hedge phrases; the only hedge used is `[unclear: ...]` naming a specific
      thing.

Fix anything that fails before reporting.

When done, end your reply with a short summary: pages processed, figures cropped, and
anything you found unclear or inconsistent in the source.
