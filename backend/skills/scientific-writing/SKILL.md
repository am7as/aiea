---
name: scientific-writing
description: STEM register for exam questions — units, significant figures, symbols, notation, tables, quantitative precision.
---

# Scientific writing

Engineering and science questions follow strict notation conventions. Get them right;
a sloppy unit or symbol makes a question look amateur.

## Quantities and units

- Every physical quantity has a unit. SI units, with a space between number and unit:
  `5 V`, `2.2 kΩ`, `10 ms`, `9.81 m/s²`. (`°C` and `%` take no space.)
- Use standard prefixes (k, m, µ, n, M) — not "kilo-ohms" in prose.
- State numeric precision: give data to a sensible number of significant figures and ask
  for the answer "to 3 significant figures" or "to 2 decimal places".

## Symbols and notation

- Variables are italic (`$R$`, `$v$`, `$t$`); units are upright (`\text{V}`).
- Vectors bold or arrowed; matrices bold capitals; subscripts for indices (`$R_1$`,
  `$v_{\text{out}}$`).
- Define every symbol the first time it appears: "the load resistance $R_L$".
- Use the field's conventional symbols (V for voltage, I for current, ω for angular
  frequency) — do not invent letters.

## Equations

- Display non-trivial equations: `$$ V = IR $$`. Inline only short expressions.
- Number an equation only if the question refers back to it.
- Keep algebra exact; give decimals only at the final numeric step.

## Tables

- Tabular data goes in a real table with a header row and units in the header
  (`Resistance (Ω)`), not in prose.
- Truth tables, state tables and data tables are Markdown tables.

## Precision of framing

- Quantitative questions must be fully determined — enough data for exactly one answer.
- State conditions and assumptions (steady state, ideal components, room temperature).
- Do not test a value the source material does not pin down.
