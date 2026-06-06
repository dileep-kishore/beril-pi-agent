---
name: berdl-review
description: Use when reviewing a BERDL analysis project or research plan and you need the scientific judgment behind an independent review — what to assess (methodology, reproducibility, SQL/code quality, findings, discoveries/performance claims), the project-review and plan-review rubrics, how to read a produced review and guide fixes, and what a notebook/report hash mismatch means. Run the /berdl-review command to actually produce the numbered review file and advance lifecycle status; use notebook_hash to check whether a review still covers the current report.
---

# BERDL Review

Independent, constructive assessment of a BERDL (BER Data Lakehouse) analysis project or research plan. The reviewer is a *separate* opinion from the author: surface strengths and concrete weaknesses, reference exact files/cells/queries, and never fabricate issues — only report what is verifiable from the files and live discovery. An AI-generated review is input to the author's judgment, not a definitive verdict.

Execution is handled by the `/berdl-review <project> [--plan] [--model <id>]` command. It runs an isolated, read-only review subagent (Opus 4.8 by default, overridable with `--model`), then numbers the output file, embeds the report-hash footer, runs the TOCTOU/hash checks, and advances lifecycle status. This skill is the *judgment*: what a good review looks like, the rubrics, and how to act on the result.

## When to use which review type

- **Project review** (default): a `REPORT.md` exists. Valid only once the project has reached `analysis`, `reviewed`, or `complete` — earlier states (`exploration`, `proposed`, `active`) have nothing to review yet; run `/synthesize <project>` first. A run from `analysis` advances the project to `reviewed`; re-running on an already `reviewed`/`complete` project just adds another opinion file without a status change.
- **Plan review** (`--plan`): evaluates a `RESEARCH_PLAN.md` *before* analysis begins. Independent of the lifecycle — it touches no status, and writes `PLAN_REVIEW_N.md` instead of `REVIEW_N.md`.

## What to read before reviewing

Project: `README.md` (question, hypothesis, approach, findings, authors), the analysis notebooks (focus on cell `source` code/markdown — skip base64 image outputs), `data/` (note existence/sizes, don't parse large CSVs), `figures/`, and the project's `memories/pitfalls.md`, `discoveries.md`, `performance.md` if present. Plan: `RESEARCH_PLAN.md` and `README.md`, plus related existing projects. For both, verify referenced databases/tables/columns against **live discovery** — use `berdl_discover` for current schemas — and check the project against the central pitfall/performance archives and any per-project `memories/`.

## Project review rubric

Assess and report on:

- **Methodology** — Is the research question clearly stated and testable? Is the approach sound? Are data sources clearly identified? Could someone reproduce this?
- **Reproducibility** —
  - *Notebook outputs*: do cells have saved outputs, or are notebooks empty code-only files? Empty `outputs` arrays across all cells is a significant gap (forces a full re-run to see results).
  - *Figures*: does `figures/` cover each major stage (exploration, results, validation)? Only 1–2 figures for 5+ notebooks likely signals gaps.
  - *Dependencies*: is there a `requirements.txt` or equivalent?
  - *Reproduction guide*: does the README have a `## Reproduction` section (how to run the pipeline, what needs Spark vs runs locally, expected runtimes)?
  - *Spark/local separation*: for Spark notebooks, is this documented? Can downstream notebooks run locally from cached data?
- **Code quality** — Are SQL queries correct and efficient? Are statistical methods appropriate? Is each notebook organized logically (setup → query → analysis → visualization)? Are known pitfalls (central archive + the project's live-captured `memories/pitfalls.md`) addressed? Any bugs or logical errors?
- **Findings assessment** — Are conclusions supported by the data shown? Are limitations acknowledged? Is any analysis incomplete or left "to be filled"? Are visualizations clearly labeled?
- **Discoveries / Performance notes** (if `REPORT.md` has these sections) — treat each entry as a first-class claim that will be extracted into per-project memory and may surface cross-project. For each: is the claim supported by specific results/notebooks/figures? Is the "applies-to" scope accurate or overgeneralized? Could it be phrased more precisely? Flag entries that are speculative, redundant with a prior project's known result, or not actually load-bearing across projects. Absence is fine — only flag an omission if the analysis clearly produced a cross-project-worthy finding and left it out.

**Suggestions**: numbered, specific, actionable, prioritized by impact. Distinguish **critical** issues from nice-to-haves. Don't suggest changes to working code for style preferences alone. If the project is solid, say so briefly rather than manufacturing issues.

## Plan review rubric

A pre-analysis review catches feasibility issues and wasted effort before notebooks exist. Frame everything as *suggestions* — the researcher may have context you don't. Aim for under ~30 lines, organized Critical / Recommended / Optional. Cover:

1. **Hypothesis & feasibility** — Is it testable with available BERDL data? Are referenced tables/columns real (cross-check via `berdl_discover`)? Are row-count estimates reasonable? Is anything based on data that doesn't exist or is too sparse (e.g., AlphaEarth embeddings only cover ~28% of genomes)? A speculative hypothesis is fine — note it, don't treat it as a defect.
2. **Relevant pitfalls** — one of the highest-value outputs. Read both the central pitfall archive and per-project `memories/pitfalls.md` for projects on the same databases/tables. Quote the specific pitfall heading, cite its source, and explain how it affects this plan (e.g., string-typed numeric columns, species ID format, large table scans). If the plan already accounts for a pitfall, note it positively. **Precedence**: if a central archive entry is tagged with a project id and that project has its own `memories/pitfalls.md`, prefer the per-project memory — the central tagged entry is a stale duplicate.
3. **Performance** — Does the plan touch large tables (e.g., `gene`, `genome_ani`) without filter strategies? Are filters appropriate per the performance archive and per-project performance notes? Is bounded local Spark SQL vs JupyterHub Spark the right call for the query complexity? Any `toPandas()` on potentially large intermediate results?
4. **Spark session correctness** — Is the `get_spark_session()` pattern right for the intended environment? JupyterHub notebooks use the injected session (no import); CLI/scripts and local runs use explicit imports. Flag mismatches between the stated environment and the import pattern; if the environment isn't specified, recommend stating it.
5. **Project conventions** — directory structure (`notebooks/`, `data/`, `user_data/`, `figures/`), sequential notebook numbering (01, 02, 03…), clear data flow (extraction → analysis → visualization), expected README/RESEARCH_PLAN sections, and cross-project data referenced from the lakehouse rather than copied.
6. **Duplication** — Does this overlap an existing project? If so, can it build on prior work (reuse extracts, reference findings) instead of repeating it? Note existing projects useful as references or data sources.

## Reading a review and guiding fixes

After `/berdl-review` produces the review, summarize for the user: overall assessment (from the Summary section), count of suggestions by priority (critical / important / nice-to-have), and the key issues to address.

- **No critical or important issues** → the project looks ready for `/submit <project>`. The latest review (by numeric order) becomes the canonical record; the user's explicit approval and lakehouse upload turn it into the formal submission.
- **Critical or important issues** → list them, offer to help fix. If fixes touch `REPORT.md`, re-run `/synthesize <project>` first (which demotes to `analysis`), then run `/berdl-review` again to produce a current review. Existing reviews go stale once the report changes (their `report_hash` footer no longer matches).

## Hash / report-mismatch meaning

Each project review records the SHA-256 of `REPORT.md` at review time as a `<!-- report_hash: sha256:<hex> -->` footer (the final non-empty line of the file). This lets a later step confirm a review still covers the *current* report. Use `notebook_hash <project>` to recompute the project's reproducibility hashes and check whether notebooks/report have changed since they were reviewed or approved.

A mismatch means **the report changed after it was reviewed/approved** — the review is stale and no longer describes what's on disk. For an already-`complete` project, this is the signal that producing a fresh review would leave the project in a confusing state (`complete`, but with a review for an unapproved report); the safe path is to demote to `analysis` (archiving the prior approval) before reviewing again. The `/berdl-review` command performs this hash check and prompts; `lifecycle_transition` handles the demote. Interpret a mismatch as "let the report stabilize, then re-review" — never as a reason to hand-edit the review file or its footer. The command also runs a TOCTOU re-check: if `REPORT.md` changes *during* the review, the output is discarded and you should re-run once the report is stable.

## Notes

- Reviews are numbered (`REVIEW_1`, `REVIEW_2`, …) and **preserved** as a history across `/submit` runs; the latest by number is canonical. Plan reviews (`PLAN_REVIEW_1`, …) are separate working documents and never affect the lifecycle.
- The report-hash footer must stay the single final non-empty line in the canonical form `<!-- report_hash: sha256:[0-9a-f]{64} -->` (exactly one occurrence). The command writes it automatically — don't add, edit, or duplicate it by hand, or `/submit` will reject the file.
- The reviewer is advisory: an AI-generated review is input to the author's judgment, not a definitive verdict.
