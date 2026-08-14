---
name: category-discovery
description: Derive the categories (topic tags) that belong under each chapter of a course's syllabus. Used by the Course Map "Discover categories" action.
---

# Category discovery

Given a course's syllabus (chapters + ELOs), the live evidence from existing questions
(harvested + generated), and short excerpts from the course materials, propose the set of
**categories** under each chapter.

A category is the topic granularity at which a single exam question is tagged:
finer than a chapter, broader than one question. Categories drive question generation,
filtering and exam coverage analysis — so they must be useful as labels.

## Rules

- **4–8 categories per chapter.** Fewer is too coarse for an exam plan; more is noise.
- Each category is a short, examiner-style phrase. Two to seven words. Title-case or
  natural-case is fine; do not use sentences.
- Categories must not span chapters. If a topic naturally fits two chapters, pick the
  better-matching one.
- Prefer phrasing that already appears in the existing question categories — the evidence
  block. Do not rename a category that is already in use.
- Categories must not duplicate the chapter title. "DC circuits" as a category under
  "DC circuits" chapter is wasted.
- Use "/" as the only allowed separator when grouping (e.g. "DC circuits / Ohm's law").
- Categories within one chapter should be parallel in granularity. Avoid mixing a coarse
  "Filters" with a hyper-specific "Butterworth 3rd-order roll-off frequency".
- Reuse existing categories verbatim when their wording is already good — do not
  re-spell, re-case, or re-punctuate them.

## Output

Return ONLY a single JSON object:

```
{
  "chapters": [
    { "id": "ch1", "categories": ["Cat A", "Cat B", "..."] },
    { "id": "ch2", "categories": ["..."] }
  ]
}
```

The `id` of every chapter in the input must appear in the output. Use `[]` for a chapter
that legitimately has no categories yet (very rare). Never invent chapter ids that are
not in the input.
