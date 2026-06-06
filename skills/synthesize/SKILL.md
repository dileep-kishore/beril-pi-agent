---
name: synthesize
description: Use when analysis notebooks for a BERDL project have been run and the user wants to interpret the results biologically and draft (or revise) the project's REPORT.md. Reads CSV/figure/notebook outputs, assesses whether the hypothesis was supported, cross-references findings against the literature (organisms/taxa, AMR genes, COG/GTDB/MeSH terms), and writes the Key Findings, Discoveries, Performance Notes, Results, Interpretation, Data, and References narrative. Run via /synthesize <project>. Lifecycle/state changes are handled by the lifecycle_transition tool, not manual edits.
---

# Synthesis

Interpret analysis outputs for a BERDL project and draft the findings in `REPORT.md`. This skill holds the scientific judgment — how to read results, assess a hypothesis, compare against the literature, and structure the narrative. The mechanics of state changes, report hashing, and status bookkeeping are delegated to Pi tools and commands.

Invoke via `/synthesize <project>`. The command resolves the project, sets it active, and asks you to move it to `analysis` when the report is complete; this skill supplies the interpretation.

## When to proceed (judgment, not bookkeeping)

The `/synthesize` command and the `lifecycle_transition` tool own status validation and transitions. Your scientific obligation: **synthesize only when real analysis outputs exist.** If there are no executed notebooks, no result CSVs, and no figures, stop and say so — interpreting absent results produces empty or fabricated findings, which is exactly what the lifecycle is designed to prevent.

Use these judgments to decide what to do when the user invokes you, based on the project's current state (check it with `lifecycle_transition`'s status, or infer from what files exist):

- **No research plan, still exploration** → there is nothing to synthesize against yet. Stop. Tell the user: "This project is still in exploration — there's no research plan to synthesize against. Write the plan first (resume via `/berdl-start`), then re-run `/synthesize`."
- **Plan exists but no analysis (proposed)** → stop. Tell the user: "This project has a research plan but no analysis yet. Run the analysis notebooks first so `/synthesize` has results to interpret. Resume via `/berdl-start`."
- **`active`** → normal forward path. Proceed; the report drafts and the project moves `active` → `analysis`.
- **`analysis`** → re-synthesis on a project still pre-review. Proceed; the transition to `analysis` is idempotent.
- **`reviewed` or `complete`** → re-synthesis invalidates prior reviews: each review embeds the report's hash, so a rewritten `REPORT.md` makes them stale via hash mismatch, and a prior approval is no longer trustworthy. The `lifecycle_transition` tool performs the legal demote back to `analysis` (archiving any approval). Proceed, but tell the user plainly: "Demoted to `analysis`; existing reviews are now stale — run `/berdl-review` again before `/submit`." For a `complete` project, confirm with the user first, since this overwrites an approved report.

Do **not** hand-edit `beril.yaml`, status fields, or approval blocks. Use `lifecycle_transition` for every state change.

## Two-pass approach

### Pass 1 — Read data and draft findings

**Gather context.** Read the research plan (hypothesis, expected outcomes, analysis plan — `RESEARCH_PLAN.md`, or `research_plan.md` for legacy projects), the README (preserve its Research Question and Authors sections), and the existing `references.md`. If no plan file exists, fall back to the README for the research question and hypothesis.

**Read analysis outputs:**

- **Result CSVs** (in `data/`) — interpret column names, row counts, distributions, and key statistics. Identify the main result variables: correlations, counts, p-values, effect sizes. Use `berdl_query` (bounded SELECT, limit 100) and `berdl_discover` if you need to re-inspect source tables or confirm what a column means; `berdl_env_check` if a query fails for connectivity reasons.
- **Figures** (in `figures/`) — list filenames and infer content from names.
- **Notebook outputs** (in `notebooks/`) — read output cells of executed `.ipynb` files for printed summaries, DataFrames, and statistical test results. `notebook_hash` confirms which notebook a result traces to.

**Draft findings** addressing:

1. **Key results** — what did the data show? Specific numbers, correlations, counts.
2. **Hypothesis outcome** — was H1 supported, or H0 not rejected? Be explicit. A non-significant result is a real finding, not a failure.
3. **Statistical significance** — report p-values, effect sizes, and confidence intervals where available. Distinguish statistical significance from biological/effect-size significance.
4. **Unexpected patterns** — surprising results, anomalies, coverage gaps.

**Present the draft to the user** and ask whether the interpretation is correct, whether any results were missed or misread, and whether additional context should be included. Revise on feedback before moving to Pass 2.

### Pass 2 — Literature cross-reference and synthesis

**Search the literature** for context, using `lit_search` / `lit_fetch` (or `/literature-review <topic>` for a fuller fan-out pass). Look for papers that tested similar hypotheses in related organisms, used comparable methods or data, or reported results that align or conflict with the BERDL findings. Focus searches on:

- The specific organisms / taxa analyzed (use GTDB lineage where relevant).
- The specific biological question (e.g., "pangenome openness environmental adaptation", AMR gene prevalence, COG functional category enrichment).
- Key methods used (e.g., "partial correlation phylogenetic signal").

**Compare each finding against the literature:**

| Question | Assessment |
|---|---|
| Does this agree with published work? | Cite supporting papers (PMID). |
| Does this contradict published work? | Note methodology differences (data coverage, taxonomy, thresholds) that could explain the discrepancy. |
| Is this novel? | Identify what the BERDL data adds that wasn't previously known. |
| Are there caveats? | Data coverage, confounders, methodological limitations. |

## REPORT.md structure

Write or update `REPORT.md` with these sections. Place figures inline near the finding they support (`![desc](figures/filename.png)` — the UI rewrites these paths for web rendering); every figure in the project's `figures/` directory should appear inline at least once. End each finding subsection with `*(Notebook: filename.ipynb)*` for provenance.

- **Key Findings** — one subsection per finding: the figure, the statistical result with specific numbers, the notebook provenance line.
- **Discoveries** *(optional)* — include only if the analysis surfaced non-trivial insights worth elevating across projects. Each entry is a self-contained one-liner a reader from another project could learn from (e.g., "Pangenome openness correlates with environmental breadth in soil-associated genera (rho=0.38, p<0.01)."). Omit the heading entirely if there's nothing material — an absent section is the natural representation of "no claims of this kind." **Do not write to per-project memory files here.** These entries flow through `/berdl-review` (the reviewer evaluates them as part of the report), and only the approved-and-reviewed content is extracted into the project's `memories/discoveries.md` at approval time (via `/submit`). Writing memories at synthesize time would propagate unvetted claims; the review-gated path keeps promoted memories tied to content that survived review.
- **Performance Notes** *(optional)* — include only for non-obvious query timings, optimizations, or anti-patterns future projects on similar data should know (e.g., "Joining `species_pangenome_genes` to `species_function_genes` via `species_id` is 3x faster than via `cluster_id` for queries spanning >100 species."). Same review-gated promotion path as Discoveries (→ `memories/performance.md` at approval). Omit the heading if nothing material.
- **Results** — detailed results with embedded figures and markdown tables.
- **Interpretation** — what the results mean biologically. Then:
  - **Literature Context** — "{Finding} aligns with Author et al. (Year) who found {result} in {organism}"; "{Finding} contradicts Author et al. (Year) — possible explanation: {methodology difference}".
  - **Novel Contribution** — what the BERDL data adds that wasn't known before.
  - **Limitations** — data coverage gaps, potential confounders, methodological caveats.
- **Data** — `### Sources` (BERDL collections and tables queried, with their exact collection IDs and what each provides) and `### Generated Data` (output files with row counts and descriptions). This documents data lineage.
- **Supporting Evidence** — a Notebooks table (filename, purpose) and a Figures table (filename, description).
- **Future Directions** — next steps based on findings, follow-ups addressing limitations, new questions raised.
- **References** — always include, even for well-known data sources. At minimum cite the primary data sources (e.g., Price et al. 2018 for the Fitness Browser, Arkin et al. 2018 for KBase). Include PMIDs.

**Collection IDs.** Use the exact BERDL collection identifier (e.g., `kescience_fitnessbrowser`, `kbase_ke_pangenome`) in the Sources table — these link to collection detail pages on the Research Observatory, which carry citation and attribution for data providers. Ensure the collection IDs also appear somewhere in the README text so the project page can auto-detect and display Data Collections links.

## After drafting

- Add any new papers found during synthesis to the project's `references.md`, following the `/literature-review` format. Create the file if it doesn't exist.
- Update the README `## Status` to read "Analysis — report drafted, awaiting `/berdl-review` and `/submit`." This is honest about the state: any prior approval was archived during the demote, and any prior reviews are stale via hash mismatch. Preserve the existing Research Question and Authors sections.
- Use `lifecycle_transition` to move the project to `analysis`. Do **not** edit `beril.yaml`, the status field, or approval blocks by hand — the tool handles the forward flip (`active` → `analysis`), the idempotent no-op (already `analysis`), and the legal demote (`reviewed`/`complete` → `analysis`).
- If interpretation surfaced data surprises (missing data, anomalous distributions, coverage gaps), capture them per the project's pitfall-capture protocol so they land in `memories/pitfalls.md`.

**Suggest next steps to the user:**

1. Review the Key Findings and Interpretation sections.
2. Run `/berdl-review <project>` to produce a numbered review against the current report (each review embeds the report hash so `/submit` knows which is current). Iterate freely.
3. When ready to stand behind the project, run `/submit <project>` to approve and archive it to the lakehouse (ORCID-gated, irreversible).

## Integration

- **Reads from**: `data/*.csv`, `figures/`, `notebooks/*.ipynb`, the research plan, `references.md`, README.
- **Tools**: `berdl_query` / `berdl_discover` / `berdl_env_check` (re-inspect source tables), `notebook_hash` (provenance), `lit_search` / `lit_fetch` (literature), `lifecycle_transition` (state).
- **Produces**: `REPORT.md` (Key Findings, optional Discoveries/Performance Notes, Results, Interpretation, Data, Supporting Evidence, Future Directions, References); updated `README.md` (Status); updated `references.md`.
- **Consumed by**: `/berdl-review` (the reviewer assesses the findings and the Discoveries/Performance entries) and then `/submit` (extracts approved memories and archives to the lakehouse).
