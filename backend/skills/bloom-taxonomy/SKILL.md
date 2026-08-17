---
name: bloom-taxonomy
description: Bloom's revised taxonomy reference for classifying and targeting cognitive levels. Used by the question generator (to target a level) and evaluator (to classify a draft).
---

# Bloom's revised taxonomy

Six levels, ordered from lowest to highest cognitive demand. The current verb in the question's prompt is the strongest signal.

## 1. remember — recall facts and basic concepts

**Verbs**: define, duplicate, list, memorize, recall, repeat, state, name, identify.
**Question shape**: "What is the formula for...?" / "List three..." / "Define...".
**Typical**: 1-2 sentence answers from a single page. Difficulty 1-2.

## 2. understand — explain ideas or concepts

**Verbs**: classify, describe, discuss, explain, identify, locate, recognize, report, select, translate, paraphrase.
**Question shape**: "Explain why..." / "Describe the difference between..." / "Translate this into your own words".
**Typical**: Short paragraph. Difficulty 2-3.

## 3. apply — use information in new situations

**Verbs**: execute, implement, solve, use, demonstrate, interpret, operate, schedule, sketch.
**Question shape**: "Given this scenario, calculate..." / "Apply the formula to..." / "Solve for x when...".
**Typical**: Problem-type. Difficulty 2-4.

## 4. analyze — draw connections among ideas

**Verbs**: differentiate, organize, relate, compare, contrast, distinguish, examine, experiment, question, test.
**Question shape**: "Compare and contrast X and Y." / "Why does X cause Y?" / "What assumptions does this argument make?".
**Typical**: Essay or extended short answer. Difficulty 3-4.

## 5. evaluate — justify a stance or decision

**Verbs**: appraise, argue, defend, judge, select, support, value, critique, weigh.
**Question shape**: "Which approach is better and why?" / "Critique this proof." / "Defend the choice of...".
**Typical**: Essay with rubric. Difficulty 4-5.

## 6. create — produce new or original work

**Verbs**: design, assemble, construct, conjecture, develop, formulate, author, investigate.
**Question shape**: "Design a system that..." / "Propose a new algorithm for..." / "Develop a proof that...".
**Typical**: Open-ended project-style. Difficulty 5.

## How to use this skill

When generating:
- Pick the target level FIRST, then choose a verb from that level for the prompt.
- Match question type to level: MCQ works well for remember/understand/apply; essay needed for analyze/evaluate/create.
- Don't dress up a recall question with an analyze verb — the actual cognitive demand is what counts.

When evaluating:
- Read the answer the question requires, not the verb in the prompt.
- A question that *says* "evaluate" but only needs the student to recall a definition is **remember**, not **evaluate**.
- Use the highest level the answer demands. If the answer needs apply AND analyze, classify as analyze.
