---
name: translate
description: Translate an exam question (markdown, math, units, references intact) into a target language. Used at exam-render time to produce the second language of a bilingual exam.
---

# Translate

Translate one exam question — prompt, options, answer, worked solution — into a target language while keeping the structure and notation of the source intact.

## Hard rules

- **Math is sacred.** `$x_1$`, `$$\int_0^1 f$$`, `\frac`, `\Delta`, units — leave them byte-for-byte. Only translate the prose between math spans.
- **Code is sacred.** Code fences, identifiers, function names, comments unless the comment is plain prose.
- **Tables stay tables.** Translate cell text; never change the column structure or header row.
- **Figure markdown stays.** `![figure](figures/foo.png)` is copied through, including the path.
- **Question structure stays.** Same numbering, same sub-parts (a) (b) (c), same bullet layout, same `[N marks]` style annotations.
- **Numbers stay.** Quantities, indices, equation labels are not translated.
- **Markdown stays.** Bold/italic markers map across; section headings keep their level.

## Style for Swedish target

- Use Swedish technical register: domain-specific terms common in Swedish engineering / science exams (kretsschema, spänning, vippa, signal, övning, härled, visa, beräkna).
- Imperative verbs match the exam tone: "Beräkna…", "Visa att…", "Härled…", "Skissa…".
- Keep SI units; do not localise unit symbols.
- Swedish quotation marks are «…» or "…" — the source uses straight; keep straight.

## Output contract

Return ONLY the translated question body — same markdown, same math, no preamble, no commentary, no "translation:" header. The output goes verbatim under the English version in the rendered exam, so it must be a drop-in replacement for the prompt body.

If a question already contains a translation in the target language (a bilingual reference exam), return the source unchanged — do not double-translate.
