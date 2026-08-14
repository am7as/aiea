---
name: question-generation
description: Hard rules for generating exam questions. Applies to every AI invocation that produces or rewrites a question.
---

# Question generation rules

## Grounding

1. **Every question must cite source pages.** If you cannot cite a specific page from the provided materials, you may not generate the question.
2. **Use only facts present in the provided materials.** Do not pull from prior knowledge, the internet, or other texts.
3. **If the material is ambiguous on a point, do not test that point.** Pick a different angle.

## Clarity

4. **Single correct answer for closed questions.** MCQ, True/False, fill-in-blank, numeric — exactly one defensible answer.
5. **No double-negatives.** "Which of the following is NOT a non-renewable resource?" — rewrite.
6. **Quantify ambiguity-prone terms.** Not "many", "some", "few" — use ranges or exact values.
7. **One concept per question.** Combined multi-part questions become problem-type, not MCQ.

## Question types

- **MCQ**: stem + 4 options (A-D). Exactly one correct. Distractors plausible.
- **True / False**: a claim that is exactly true or exactly false against the cited page.
- **Short answer**: 1-3 sentence target answer. Word limit stated in the prompt.
- **Essay**: rubric-based; specify the dimensions to grade against.
- **Problem**: numeric or symbolic with worked solution.
- **Code**: language specified; small (< 30 lines); test cases provided.

## Distractors (MCQ specific)

8. **Plausible to a specific misconception.** Each distractor must correspond to a named error a student might make (sign flip, unit confusion, wrong formula, off-by-one). State the misconception in the answer key.
9. **Balanced length.** All options within ±30% of each other in word count. Length is a classic give-away.
10. **Avoid "all of the above" / "none of the above"** unless the question is specifically testing that meta-reasoning.

## Difficulty

11. Difficulty 1 = direct recall from a single page.
12. Difficulty 2 = comprehension; apply one formula or definition.
13. Difficulty 3 = multi-step; combine two concepts.
14. Difficulty 4 = analyze / evaluate; requires understanding *why* a concept holds.
15. Difficulty 5 = create / synthesize; novel scenario not in the material, requiring transfer.

## Output

16. Markdown with YAML frontmatter (kind, difficulty, bloom, est_minutes, topics, source_pages).
17. Sections: `## Prompt`, `## Answer` (or `## Answer key`), `## Distractors` if MCQ, `## Worked solution` if problem.
18. Math: use `$inline$` and `$$display$$` LaTeX. Don't render to images.

## Forbidden

- "Best", "most important", "always", "never" — unless the source uses exactly that phrasing.
- Questions whose answer is a date / number not present in the source.
- Trick questions whose value is "did you read carefully" rather than "did you understand".
- Cross-referencing a source the materials don't include ("As we discussed in lecture 3..." when lecture 3 isn't provided).
