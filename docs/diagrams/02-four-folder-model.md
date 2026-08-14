# 02 — Four-folder model

Every course owns four absolute host paths. They're chosen by the user (anywhere AIEA can reach via `AIEA_ALLOWED_ROOTS`) and divided into two inputs + two outputs:

```mermaid
flowchart LR
    user(["You"]):::user
    aiea[["AIEA<br/>api + worker"]]:::aiea

    subgraph inputs["Inputs — stable references"]
      direction TB
      materials["materials/<br/>your course material"]:::materials
      brain["brain/<br/>AI behavior + memory"]:::brain
    end

    subgraph outputs["Outputs — two commitment levels"]
      direction TB
      workshop["workshop/<br/>drafts, chats, evaluations"]:::workshop
      library["library/<br/>final clean outputs"]:::library
    end

    user -- "populates" --> materials
    user -- "tunes" --> brain

    materials -- "reads" --> aiea
    brain -- "reads on every prompt" --> aiea

    aiea -- "writes drafts + extracted text" --> workshop
    workshop -- "promote (user action)" --> library
    user -- "reads finals, publishes to students" --> library

    user -. "iterates in chat" .-> workshop

    classDef user fill:transparent,stroke:#3b82f6,color:#bfdbfe,stroke-width:2px
    classDef aiea fill:transparent,stroke:#a78bfa,color:#ddd6fe,stroke-width:2px
    classDef materials fill:transparent,stroke:#3b82f6,color:#bfdbfe,stroke-width:2px
    classDef brain fill:transparent,stroke:#a78bfa,color:#e9d5ff,stroke-width:2px
    classDef library fill:transparent,stroke:#22c55e,color:#bbf7d0,stroke-width:2px
    classDef workshop fill:transparent,stroke:#f59e0b,color:#fde68a,stroke-width:2px
```

## Canonical subfolder layout

```mermaid
flowchart TB
    subgraph m["materials/"]
      direction LR
      m1["book/"]:::mat
      m2["lectures/"]:::mat
      m3["exercises/"]:::mat
      m4["exams/"]:::mat
      m5["exam-template/<br/>not ingested"]:::tmpl
      m6["other/"]:::mat
    end

    subgraph b["brain/"]
      direction LR
      b1["skills/"]:::br
      b2["agents/"]:::br
      b3["hooks/"]:::br
      b4["prompts/"]:::br
      b5["memory/"]:::br
    end

    subgraph l["library/"]
      direction LR
      l1["question-bank/<br/>qid.md"]:::lib
      l2["exams/eid/<br/>exam.md/.tex/.pdf + answer-key.md"]:::lib
    end

    subgraph w["workshop/"]
      direction LR
      w1["extracted/mid/<br/>extracted.md, meta.json"]:::wk
      w2["questions/qid/<br/>current.md, iter-NNN.md, chat.md, evaluation.md"]:::wk
      w3["exams/eid/<br/>exam-draft.md, chat.md, checklist.md"]:::wk
      w4["chats/"]:::wk
      w5["checklists/"]:::wk
      w6["logs/<br/>cost.jsonl, runs.jsonl"]:::wk
    end

    classDef mat fill:transparent,stroke:#3b82f6,color:#bfdbfe,stroke-width:2px
    classDef tmpl fill:transparent,stroke:#3b82f6,color:#bfdbfe,stroke-width:2px,stroke-dasharray:4 2
    classDef br fill:transparent,stroke:#a78bfa,color:#e9d5ff,stroke-width:2px
    classDef lib fill:transparent,stroke:#22c55e,color:#bbf7d0,stroke-width:2px
    classDef wk fill:transparent,stroke:#f59e0b,color:#fde68a,stroke-width:2px
```

## Asymmetry to remember

|  | materials | brain | library | workshop |
|---|---|---|---|---|
| Who writes | you | you | AIEA on promote | AIEA + you |
| Who reads | AIEA | AIEA every prompt | you (publish to students) | you (iterate) |
| Regenerable? | no | no | yes — from materials + brain | yes |
| Backup priority | medium | **high (smallest, most valuable)** | low | low |
| Version-control? | optional | **yes** | no | no |

The library is the curated face of your work; the workshop is the messy process. Promotion (workshop → library) is an explicit user action with quality gates.
