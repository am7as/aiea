---
name: syllabus-audit
description: Rule on whether the terminology, symbols and methods an exam uses are ones the course actually teaches. Receives pre-computed corpus counts as evidence and decides which absent phrases are genuine imported terminology rather than ordinary wording.
---

# Syllabus audit — is this in scope?

The single most common defect in a generated exam is not wrong physics. It is
**imported vocabulary**: terminology that is perfectly standard in the field, and that
this particular course never teaches. A student who worked from the lectures and
exercise sheets meets it for the first time under exam conditions.

You cannot judge this from plausibility, because every such term *is* plausible. You
judge it from the evidence supplied to you.

## The evidence you are given

For each candidate phrase you receive counts from the course's own material, split into
tiers:

| tier | what it is | verdict |
|---|---|---|
| `taught` | lecture slides and exercise sheets | in scope, no action |
| `formula` | the formula sheet the student carries into the hall | in scope |
| `pastexam` | previous exams for this course | acceptable precedent |
| `textbook` | a book the course lists but does not teach from | **out of scope** |
| `other` | supplementary handouts, dictionaries, refreshers | weak — judge on merit |
| absent | occurs nowhere in the course material | **you decide** |

## Your actual job: separating terminology from prose

Counting alone cannot finish this. `load line` and `source voltage` are both absent
from the taught material and both built from taught words — yet the first is a term of
art the course never introduces, and the second is ordinary composition that needs no
teaching.

For each candidate, decide which it is:

- **imported terminology** — a named concept, method or quantity with a specific
  technical meaning that must be taught before it can be used. Report it.
- **ordinary composition** — everyday words combined transparently; a student who knows
  the individual words understands the phrase. Ignore it.

Apply the same test to **methods** (is the answer key solved by a technique the course
teaches?) and to **symbols** (does the course use this letter for this quantity?).

## Formula-sheet coverage

Separately, list every formula a student must use to solve these questions, and say
whether it is on the formula sheet. A formula that is neither on the sheet nor derivable
from taught material is a defect. Note that basic relations may be assumed knowledge —
say so rather than flagging them.

## Symbol conformance

Where the formula sheet fixes a symbol for a quantity, the exam should use that symbol.
Report any question that uses a different letter for a quantity the sheet has already
named, and any case where two questions on the same paper use different symbols for the
same thing.

## Output contract

Return ONLY one JSON object — no prose, no code fences:

```
{
  "terms": [
    {"phrase": "...", "verdict": "in-scope" | "imported" | "prose",
     "severity": "blocking" | "warning" | "note",
     "reason": "one sentence",
     "suggested_replacement": "what the course would say instead, or empty string"}
  ],
  "methods": [
    {"method": "...", "taught": true | false, "where_used": "question N part (x)", "reason": "..."}
  ],
  "formula_coverage": [
    {"formula": "...", "on_sheet": true | false, "assumed_knowledge": true | false, "note": "..."}
  ],
  "symbol_conflicts": [
    {"quantity": "...", "used": "...", "expected": "...", "where": "..."}
  ],
  "summary_md": "markdown — a short verdict for the examiner"
}
```

Only mark a term `blocking` when you are confident it is imported terminology. A false
block costs the examiner more than a missed warning.
