---
name: data-validity
description: Use before an analysis consumes lakehouse data, or when a result looks suspiciously clean, strong, or strange — to profile the rows for silent traps that invert conclusions: zero-as-missing sentinels (0 ≠ measured), numbers stored as strings (lexicographic ordering flips comparisons), near-constant columns, sparse coverage, and pseudoreplication (rows collapsing to a few independent groups). Applies whenever data quality or the unit of analysis could be wrong. This is the data-validity judgment gate; it informs, the scientist decides.
---

# Data Validity

The most consequential errors in lakehouse analysis are not in the model — they
are in the data, and they are *silent*. A column that looks numeric but is
stored as text will sort `"-0.0001" > "9.997"`, inverting the biology. A `0` that
means "not measured" rather than "measured zero" shifts every mean. Rows that
look independent but collapse to three clades pseudoreplicate the headline.
`berdl_validate` profiles the rows feeding an analysis and surfaces these before
they corrupt a conclusion.

## When to run it

- On the rows that will feed an analysis, **before** building on them — pass the
  sampling `sql`, or `rows_json` from a prior `berdl_query`.
- When a result is *too clean* or *too strong* to believe.
- With `group_col` set to the finest independent unit (genome, subject, study)
  when the analysis makes a per-row claim — that is the pseudoreplication check.
- With `axis` set to a categorical grouping column to check effective vs. raw
  group counts (a `none`/`unknown`/`na` value is missing, not a category).

## Reading the verdict

- **pass** — no traps found; note it and proceed.
- **warn** — one or more findings. This is a *judgment* gate, not a wall: read
  each finding, decide whether it changes the analysis (cast the string column,
  treat the sentinel as null, re-grain to the group), then **record the
  decision** with `gate_record data-validity pass|fail` and a one-line note of
  what you concluded. The verdict never blocks on its own — you are the arbiter.

## Judgment

- **0 ≠ measured.** A zero-inflated continuous column almost always encodes
  missingness. Confirm what the source means by 0 before averaging over it.
- **Trust the finest independent unit.** If 400 rows are 6 genomes, the n is 6.
  Prescribe and analyze at the group grain; a row-grain p-value is a mirage.
- **Numbers as strings are invisible until they bite.** A column that is ≥90%
  castable to float but typed as string will pass every eyeball check and fail
  every comparison. Cast, then re-validate.
- Validity is a *checkpoint*, not paperwork: the point is to catch the invert
  cheaply, up front, so the analysis you build is one you can defend.
