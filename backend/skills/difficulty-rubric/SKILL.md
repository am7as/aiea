---
name: difficulty-rubric
description: Difficulty rating (1-5) and estimated solve time rubric for AIEA. Used by the evaluator and the question generator.
---

# Difficulty rubric (1-5)

Difficulty is **cognitive load × number of correct steps × ambiguity**. Estimate from the rubric below, not from gut feel.

| Level | Description | Typical solve time |
|:-:|---|---|
| **1** | Direct recall from a single page. One concept. No calculation. | 30s - 1 min |
| **2** | Apply a single formula or definition. One step. | 1 - 3 min |
| **3** | Combine two concepts. Two-step derivation. Or comparison across two pages. | 3 - 6 min |
| **4** | Analyze a non-trivial scenario. Three+ steps. Requires identifying which concepts apply. | 6 - 12 min |
| **5** | Novel scenario beyond the material. Synthesize across topics. Open-ended judgment. | 12 - 30 min |

## Time estimation

- Take the bottom of the difficulty range as a floor.
- Add 30s per distractor for MCQ (re-reading options).
- Add 1 min per page that must be cross-referenced.
- For essay, time includes ~30% writing overhead beyond pure thinking.

## Common miscalibrations to avoid

- **Wordy ≠ hard.** A long stem with simple recall is still difficulty 1.
- **Math ≠ hard.** A 5-step calculation that's purely mechanical is difficulty 2-3, not 4.
- **Unfamiliar context ≠ hard** if the analogy to the material is direct.
- **Trick questions ≠ hard** — they're *unfair*. If detecting the trick is the only barrier, the question is broken.

## Calibration sanity checks

- A first-year student should answer 70-80% of difficulty-1 questions correctly.
- 50-60% on difficulty-3.
- 30-40% on difficulty-5.
- If the answer distribution skews much further, the rating is off.

## Output

When the evaluator rates a question, it produces:

```json
{
  "difficulty": 3,
  "difficulty_rationale": "Two-step: identify the conservation law, then apply the kinematic equation. Both concepts appear separately in chapter 4.",
  "est_minutes": 5,
  "est_minutes_rationale": "3 min thinking, 2 min computation."
}
```

The rationale fields are required — they make the rating reviewable.
