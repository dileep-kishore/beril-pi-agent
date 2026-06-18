---
name: analysis-notebooks
description: Use when turning an approved BERDL research plan into analysis notebooks — designing, scaffolding, running, and iterating on the numbered notebooks that carry a project's analysis. Covers notebook structure (setup → query → analysis → visualization), sequential numbering, the Spark-session pattern and Spark-vs-local choice, the saved-outputs reproducibility requirement, figure conventions, and the check-in seam after the first result. Execution is handled by the notebook_scaffold / notebook_run / notebook_list tools and the /analyze command; this skill carries the judgment about what makes a good, reproducible analysis notebook.
---

# Analysis notebooks

## Pi-native workflow surface

Use `/whereami` before launching analysis and `/next` after the first-result checkpoint. This skill owns notebook-design judgment; `/analyze <project>` owns orchestration, while `notebook_scaffold`, `notebook_run`, `notebook_list`, and the HUD sub-step rail expose execution state in Pi.

Notebooks are a BERDL project's primary audit trail: a human (and the reviewer)
should be able to read them top-to-bottom and see exactly how each finding was
produced. Do as much work as possible in notebooks rather than ad-hoc shell or
one-off queries.

## When to use

After a research plan is approved (`proposed`), to create and run the analysis,
moving the project to `active`. The `/analyze <project>` command drives the
flow; the tools are `notebook_scaffold`, `notebook_run`, and `notebook_list`.

## Designing the notebooks

- **One notebook per stage, numbered in order** — `01_data_exploration.ipynb`,
  `02_analysis.ipynb`, `03_visualization.ipynb`, … The numbering is the reading
  order and the data flow (extraction → analysis → visualization).
- **Internal structure**: each notebook reads top-down as *setup → query →
  analysis → visualization*. Start with a markdown cell stating the notebook's
  goal, then the Spark session setup, then the work.
- **Spark session**: on the BERDL JupyterHub the session is injected (no import);
  for CLI/local runs use the explicit `get_spark_session()` pattern. State which
  environment a notebook targets and keep the import pattern consistent with it.
- **Spark vs local**: do heavy joins/scans in Spark, but cache intermediate
  results so downstream notebooks can run locally and cheaply. The scaffold
  creates `notebooks/util.py` and `data/cache/`; use `cache_path()`,
  `save_json()`, and `load_json()` for small structured cache artifacts. Put
  expensive extracted tables under `data/` or `data/cache/`, figures under
  `figures/`, and avoid `toPandas()` on large intermediates; filter first.
- **Respect the data guards**: prefer bounded queries and the patterns from the
  berdl-query skill; check large tables (`gene`, `genome_ani`, …) have filter
  strategies before scanning them.

## Test the discriminating / falsifying result first

The first analysis notebook should run the query or figure that *distinguishes
the competing hypotheses* (the plan's discrimination strategy) or *would refute
H1* — before any confirmatory cells. Leading with the falsification test means
the cheapest, most informative result lands first: if H1 doesn't survive it,
you have saved four notebooks of confirmation built on a dead hypothesis.

- After that first cell, record one line: **"did this seek data that would
  refute the hypothesis, or only affirm it?"** Affirm-only ordering is a smell —
  reorder so the disconfirming check runs before the supporting ones.
- Tag each result with its **confidence tier** (`high` / `medium` / `low`) and a
  **scope bound** — "in these N samples / under filter X", not a universal — so
  the result carries its own calibration into `/synthesize`. A single
  re-runnable result is `medium`; literature-only is `low`.
- Tag the hypothesis the result bears on with a **status**: `open` /
  `supported` / `refuted` / `needs-replication` / `blocked` / `needs-evidence`.
  A `refuted` H1 reported honestly is a finding, not a failure.

## Reproducibility (hard requirement)

Notebooks must be **committed with their outputs saved** — a notebook with only
source and empty `outputs` arrays is not acceptable, because the report, review,
and approval all attest to the executed results. `notebook_run` executes in place
and saves outputs; use `notebook_list` to confirm every notebook has outputs
before `/paper-plan` and `/synthesize`. `notebook_run` also stamps BERIL
execution metadata; use resume mode for continuation so prior successful BERIL
executions are skipped while failed or unstamped notebooks rerun. If you edit a
notebook after it was reviewed/approved, the prior approval is stale — re-run,
re-synthesize, and re-review.

## Figures

Save figures to `figures/`. Aim for coverage across stages (exploration,
results, validation) — one or two figures for five notebooks usually signals a
gap. Each major finding in the report should have a figure behind it.

## The check-in seam

Do not generate and run the whole pipeline silently. After the **first**
notebook's results are in, pause: show the scientist the first result or figure
and ask whether it looks right and matches expectations before continuing. This
is the cheapest moment to catch a wrong join key, a misread column, or an
infeasible question — far cheaper than after five notebooks.

## Flow

1. `notebook_scaffold` from the approved plan → numbered skeletons.
2. Move the project to `active` (`lifecycle_transition`).
3. Fill in / run `notebook_run`; check in after the first result.
4. `notebook_list` to confirm outputs are saved across all notebooks.
5. `/paper-plan` to choose the evidence-backed narrative from the executed
   results.
6. `/synthesize` to interpret that narrative into REPORT.md.

When a query fails, results look wrong, or a table surprises you, capture it via
the pitfall-capture skill so the next project benefits.
