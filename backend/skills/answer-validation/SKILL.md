---
name: answer-validation
description: Solve an exam question from the question text and its figures alone, without seeing the answer key, then compare the independent result against the key. Catches wrong keys, ambiguous questions, missing data and answers that a figure silently gives away.
---

# Answer validation — the blind solve

You are given a question and its figures. You are **not** given the answer key, and you
must not ask for it. Solve the question as a competent student would, then report what
you got and what you had to assume.

This exists because a plausible-looking key can be wrong, and because the only reliable
way to find out whether a question is solvable *as printed* is to try to solve it from
what is printed.

## How to work

1. Read the question text and **look at every figure**. The figure is part of the
   question, not decoration — polarity marks, arrow directions, component values, axis
   labels and gate shapes are all load-bearing.
2. Solve it. Show the steps and carry units through. State numeric answers to the
   precision the question asks for.
3. Note anything you had to **guess**: an undefined symbol, a missing reference
   direction, an unreadable label, a value the question never supplies. A guess is a
   defect in the question, not in you.
4. Note anything that made the question **easier than intended**: a value printed on a
   figure that a part asks the student to derive, a later part that hands over a formula
   an earlier part asks for, or a stem that states the answer.

## Judging your own result against the key

Only after you have committed to your own answer, compare.

- **match** — same result, allowing for rounding and equivalent forms.
- **mismatch** — the values genuinely differ. Say which is right and why. Do not assume
  the key is correct; keys are frequently the defective half.
- **ambiguous** — the question admits more than one defensible reading, and your answer
  follows one of them. This is a defect in the question even though nothing is "wrong".

## What counts as a defect

- Data that is given but never used by any part (redundant givens).
- Data a part needs that the question never supplies.
- A symbol used by the key that the question never defines, or vice versa.
- An answer visible in the question text or in a figure.
- A part whose answer follows from an earlier part with no new work.

## Output contract

Return ONLY one JSON object — no prose, no code fences:

```
{
  "my_answer_md": "markdown — your independent solution, with steps and units",
  "verdict": "match" | "mismatch" | "ambiguous",
  "confidence": 0-10,
  "discrepancy_md": "markdown — where you and the key differ and which is right; empty string when verdict is match",
  "assumptions": ["each thing you had to guess because the question does not say"],
  "defects": [
    {"kind": "redundant-given" | "missing-data" | "undefined-symbol" | "answer-leak" | "redundant-part" | "other",
     "detail": "one sentence, quoting the exact offending string"}
  ]
}
```

Be concrete and quote exact strings. An unsupported claim is worse than no claim.
