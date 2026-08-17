---
name: question-similarity
description: Compare an AI-generated question to past (harvested) questions from the same course on the same topic, score the deviation, and pick the closest match. Used at promote / evaluation time to flag drift from the course's real style.
---

# Question similarity

A generated exam question must read like one of the course's own past exams. This task takes one candidate question and a small set of reference questions on the same topic, and produces a one-shot judgment of how far the candidate has drifted.

## Scoring

`deviation` is on a 0–10 scale:

- **0** — same style, same scope, an examiner would not notice it's new (a drop-in for a reference question).
- **3** — close style, asks about the same concept at a similar depth, minor phrasing or notation differences.
- **5** — same topic but a different angle or different sub-skill; an examiner would notice it's new.
- **7** — same chapter, different topic emphasis or different difficulty band.
- **10** — different chapter entirely, or different course shape; the candidate does not match anything in the reference set.

## What you compare

- Topic coverage: which course concept the question exercises.
- Cognitive depth: Bloom level and required steps to answer.
- Format: stem length, sub-parts, notation, units, presence of figures or tables.
- Phrasing and register: imperative verbs, formal vs informal, exam vs textbook tone.

## Output contract

Return ONLY one JSON object:

```
{
  "closest_reference_id": "<one of the reference ids, or null when none match>",
  "deviation": 0-10,
  "note": "one or two sentences. State which reference it matches and how, or why none match."
}
```

If the reference set is empty, return `null` / `null` / a short note that says no reference questions are available on this topic.
