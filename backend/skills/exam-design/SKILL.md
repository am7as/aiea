---
name: exam-design
description: Principles for assembling exams — coverage, difficulty distribution, time budget, Bloom's mix, ordering.
---

# Exam design

When the user assembles a set of questions into an exam, apply these rules. Surface warnings in the UI when a draft exam violates them.

## Coverage

1. **Every major topic in the course description should be represented.** If a topic has > 10% of the course's pages and 0 questions, warn.
2. **No single topic should exceed 40%** of the question count unless the course is intentionally focused.

## Difficulty distribution (typical undergraduate exam)

| Difficulty | Target share |
|:-:|:-:|
| 1 (recall) | 15-20% |
| 2 (apply simple) | 25-30% |
| 3 (combine) | 25-30% |
| 4 (analyze) | 15-20% |
| 5 (synthesize) | 5-10% |

For a final exam, shift toward 3-5. For a quiz, shift toward 1-3.

## Bloom's distribution

A well-rounded exam touches at least 4 of the 6 levels. If all questions are `remember` + `understand`, flag it.

## Time budget

3. **Estimated total = sum of `est_minutes`.** Add 15% slack for transitions and re-reading.
4. **Standard durations**: 50-min class quiz → target 40 min content. 90-min midterm → 75 min. 3-hour final → 2h 30min.
5. **No single question should consume > 25% of the budget** — if it does, split into parts (a), (b), (c) with separate point values.

## Ordering

6. **Easier first** — start with difficulty 1-2 to give students momentum.
7. **Group by topic** when topics are equally hard. Helps the student stay in context.
8. **Long-form last** — essays and problems at the end.

## Variety

9. **Mix question types.** All-MCQ tests recognition; all-essay tests writing. Aim for at least 3 of {MCQ, short, problem, essay}.
10. **No clusters of near-identical questions** unless intentional (e.g. drill section).

## Point allocation

11. **Points proportional to `est_minutes`** as a first pass.
12. **Bonus points for difficulty 5** can be 1.5× rate to reward synthesis.

## Warnings the UI should surface

- "Topic X is under-represented (1 question, ~25% of materials)"
- "Difficulty distribution is bottom-heavy: 70% are level 1-2"
- "Estimated time is 110 min for a 90-min slot"
- "Only one Bloom level present (remember)"
- "Question 7 is 35% of total time — consider splitting"
