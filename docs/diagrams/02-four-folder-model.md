# 02 — Four-folder model

Every course owns four absolute host paths. You choose them, anywhere AIEA can reach through
`AIEA_ALLOWED_ROOTS`. Two are inputs you own, two are outputs AIEA writes.

```mermaid
flowchart LR
    you(["You"]):::person

    subgraph inputs[" Inputs — you own these "]
      direction TB
      materials["materials/<br/><small>course material</small>"]:::input
      brain["brain/<br/><small>skills, prompts, memory</small>"]:::input
    end

    aiea{{"AIEA<br/><small>api + worker</small>"}}:::engine

    subgraph outputs[" Outputs — AIEA writes these "]
      direction TB
      workshop["workshop/<br/><small>drafts and working files</small>"]:::draft
      library["library/<br/><small>finished work</small>"]:::final
    end

    you -- "fills" --> materials
    you -- "tunes" --> brain
    materials -- "reads" --> aiea
    brain -- "reads every prompt" --> aiea
    aiea -- "writes" --> workshop
    workshop -. "promote<br/>not yet built" .-> library
    you -. "edits directly" .-> workshop

    classDef person fill:transparent,stroke:#C6664A,stroke-width:2px
    classDef input fill:transparent,stroke:#C6664A,stroke-width:2px
    classDef engine fill:transparent,stroke:#8B7BB8,stroke-width:2px
    classDef draft fill:transparent,stroke:#B8894A,stroke-width:2px
    classDef final fill:transparent,stroke:#6E9075,stroke-width:2px
```

**Reading the colours.** Warm clay is yours to write. Violet is AIEA. Ochre is a draft.
Green is finished. The same four colours mean the same four things in every diagram here.

## What is actually inside each folder

`materials/` and `brain/` are scaffolded with README files when you create a course.
`workshop/` and `library/` are filled as you work.

```mermaid
flowchart TB
    subgraph M[" materials/ — you fill this "]
      direction LR
      m1["book/"]:::input
      m2["lectures/"]:::input
      m3["exercises/"]:::input
      m4["exams/"]:::input
      m5["exam-template/<br/><small>styling, never ingested</small>"]:::inputDash
      m6["other/"]:::input
    end

    subgraph B[" brain/ — you tune this "]
      direction LR
      b1["skills/"]:::input
      b2["agents/"]:::input
      b3["hooks/<br/><small>scaffolded, not yet read</small>"]:::inputDash
      b4["prompts/"]:::input
      b5["memory/"]:::input
    end

    subgraph W[" workshop/ — AIEA and you both write "]
      direction LR
      w1["extracted/"]:::draft
      w2["questions/"]:::draft
      w3["exams/"]:::draft
      w4["chats/"]:::draft
      w5["checklists/"]:::draft
      w6["logs/"]:::draft
    end

    subgraph L[" library/ — empty until promote ships "]
      direction LR
      l1["question-bank/"]:::finalDash
      l2["exams/"]:::finalDash
    end

    classDef input fill:transparent,stroke:#C6664A,stroke-width:2px
    classDef inputDash fill:transparent,stroke:#C6664A,stroke-width:2px,stroke-dasharray:4 3
    classDef draft fill:transparent,stroke:#B8894A,stroke-width:2px
    classDef finalDash fill:transparent,stroke:#6E9075,stroke-width:2px,stroke-dasharray:4 3
```

A dashed border means scaffolded but not yet used by any code path.

## How a question is stored

Each question is a folder, not a file. The path carries its own metadata, so the vault stays
browsable in Obsidian or a file manager without a database.

```mermaid
flowchart LR
    root["workshop/questions/"]:::draft
    origin["generated/<br/><small>or harvested/</small>"]:::draft
    chapter["ch3-active-components/"]:::draft
    category["rectifier-circuits/"]:::draft
    qid["one id per question"]:::draft

    root --> origin --> chapter --> category --> qid

    qid --> f1["question.md"]:::leaf
    qid --> f2["answer.md"]:::leaf
    qid --> f3["figures/"]:::leaf

    classDef draft fill:transparent,stroke:#B8894A,stroke-width:2px
    classDef leaf fill:transparent,stroke:#6B7280,stroke-width:2px
```

An exam is the same idea: `workshop/exams/generated/` then one folder per exam, holding
`exam.tex`, `exam.pdf`, `_questions.tex`, `instructions.tex`, plus `figures/` and `questions/`.

## Asymmetry to remember

|  | materials | brain | workshop | library |
|---|---|---|---|---|
| Who writes | you | you | AIEA and you | nothing yet |
| Who reads | AIEA | AIEA, every prompt | you | you, once promote ships |
| Can it be regenerated? | no | no | yes | yes |
| Back it up? | medium priority | **highest — smallest and least replaceable** | low | low |
| Put it in git? | optional | **yes** | no | no |

`brain/` is the folder to protect. It is a few kilobytes of text that encodes how you want
AIEA to behave, and nothing else can reproduce it.
