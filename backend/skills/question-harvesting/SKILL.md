---
name: question-harvesting
description: Hard rules for harvesting existing exam / exercise questions out of an extracted PDF. Applies to every AI invocation that turns a past exam into Question rows.
---

# Question harvesting rules

You are reading a past exam or exercise sheet that has already been extracted to
markdown. Your job is to identify every distinct question / exercise in it and
return them as a strict JSON array. You are **not** rewriting, simplifying, or
combining questions — you are faithfully transcribing what is already there.

## Output shape (non-negotiable)

Return **only** a JSON array. No prose. No code fences. No commentary.

Each element is one question object with exactly these keys:

```
{
  "source_label": "<exercise number / title, e.g. 'Problem 4.2', 'Extra Assignment 8.1c', 'Fråga 5', '' if none>",
  "page": <1-indexed page number where the question begins, or null>,
  "prompt_md": "<the question body in markdown, English when bilingual>",
  "prompt_md_sv": "<Swedish translation when the source is bilingual SE/EN; otherwise empty string>",
  "answer_md": "<answer / worked solution if the sheet provides one, else empty string>",
  "category": "<short topic label, or null>",
  "kind": "mcq | short | essay | problem | code | true_false"
}
```

## Faithfulness

- **Transcribe, don't paraphrase.** Math, units, numbers, variable names — copy
  exactly. Convert layout (LaTeX, two-column, etc.) to clean markdown when
  necessary but never change the meaning.
- **Never invent.** If the question is partially captured (e.g. the diagram
  caption is in the extract but the body got cut off), include only what you
  can transcribe. Do **not** synthesize the missing parts.
- **Never merge two distinct exercises into one.** Different exercise numbers =
  different questions.
- **Sub-parts (a), (b), (c) inside one exercise stay together** under a single
  question. Mark them inside `prompt_md` with bold sub-headers:
  `**(a)** ...`, `**(b)** ...`.

## Source labels — keep them OUT of the body

Each source exam labels exercises with things like `**Problem 4.2**`, `**Extra
Assignment 8.1**`, `**Fråga 5** [5 p]`, `## Question 12`, `Exercise 3.1 part c)`.

**Put the label in `source_label`, NOT in `prompt_md`.** The body should start
with the actual question prose. The label will be stored in YAML frontmatter
for cross-reference.

Example. Source:

```
**Problem 4.2 in the Book**  [5 p]
A PMDC motor has armature resistance $R = 0.5\,\Omega$. Determine the …
```

Wrong:
```json
"source_label": "",
"prompt_md": "**Problem 4.2 in the Book** [5 p]\nA PMDC motor has armature resistance $R = 0.5\\,\\Omega$. Determine the …"
```

Right:
```json
"source_label": "Problem 4.2 in the Book",
"prompt_md": "A PMDC motor has armature resistance $R = 0.5\\,\\Omega$. Determine the …"
```

Drop point values (`[5 p]`, `(2 marks)`) from the body too — they live on the
ExamQuestion row, not in the prose.

## Figure preservation

The extracted markdown contains image references like
`![Figure 6.2](attachments/page-006-02.png)`. These are real PNG crops on disk.

**Preserve every image reference that belongs to your question, exactly as it
appears in the source.** Downstream code will copy the PNG into the question's
figures/ folder and rewrite the path.

If you drop the image reference, the question loses its figure forever. When
in doubt, keep it.

## Bilingual SE / EN sources

Many Swedish exams print every question in both Swedish and English. The
extracted text often looks like:

```
**Fråga 1 / Question 1.** [5 p]
SE: Bestäm strömmen $I$ i kretsen nedan.
EN: Determine the current $I$ in the circuit below.
```

Or two parallel paragraphs without explicit SE: / EN: tags.

When the source is bilingual:

- `prompt_md` = the **English** version only.
- `prompt_md_sv` = the **Swedish** version only.
- Do **not** include both languages in `prompt_md`.

If the source is monolingual, leave `prompt_md_sv` as `""`.

## Split / merge policy

| Source pattern | Result |
|---|---|
| `**Problem 3**` with parts `(a) … (b) … (c)` inside | **One** question, all parts inside `prompt_md` |
| `**Extra Assignment 8.1a)**` … `**Extra Assignment 8.1b)**` printed as separate bold headers | **One** question — same scenario, merge with `**(a)** ... **(b)** ...` sub-headers; set `source_label` to `Extra Assignment 8.1` |
| `**Problem 3**` … `**Problem 4**` | **Two** separate questions |
| One question split across pages | **One** question, body joined |

The rule of thumb: **shared scenario or shared base number → merge. Different
base numbers → split.**

## Page numbers

Capture the page number where the question begins. The extracted markdown is
divided into `## Page N` sections — use those headers. If you can't determine
the page, return `null`.

## Categories

Pick a short topic label for `category` (e.g. `KVL / KCL Analysis`,
`Boolean Algebra`, `PMDC Motor Sizing`). Match the categories present in the
course syllabus when possible. Leave `null` only when no topic is identifiable.

## Kinds

- `problem` — multi-step calculation or design exercise (most exam questions).
- `mcq` — multiple choice.
- `short` — one-line factual answer.
- `essay` — open-ended discussion.
- `code` — write code.
- `true_false`.

Default to `problem` when uncertain; an examiner will reclassify later.

## Don't

- Don't include answer/solution text in `prompt_md`.
- Don't include points (`[5 p]`) in `prompt_md`.
- Don't include the exercise number/title in `prompt_md`.
- Don't drop figure references.
- Don't merge questions with different base numbers.
- Don't translate from Swedish into English (or vice versa) — only split what
  the source already provides bilingually.
- Don't add chatter outside the JSON array.
