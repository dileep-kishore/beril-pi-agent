---
name: research-plan
description: Use when turning a research question and explored data into a written RESEARCH_PLAN.md for a BERDL project — the contract for the analysis that follows. Covers the feasibility check (is the question answerable with the available data?), the plan template (research question, hypotheses, literature context, query strategy, the numbered analysis-notebook plan, expected outcomes), and the check-in before analysis begins. Run via /research-plan <project>; lifecycle transitions go through the lifecycle_transition tool, and the plan is shown with the research_plan tool.
---

# Research plan

The research plan is the **contract** for what the analysis will do. It is
written once the question is clear and the data has been explored, and it moves
a project from `exploration` to `proposed`. Do not write or run notebooks yet —
the plan comes first, then a check-in, then analysis.

## Feasibility first (the most important step)

Before writing anything, confirm the question is **answerable with the data we
actually have**. Use `berdl_discover` to find the relevant databases/tables and
`berdl_peek` to confirm the columns and a few real rows exist. If the data
needed to answer the question is not present, say so plainly and help the
scientist reshape the question — a beautiful plan for an unanswerable question
wastes everyone's time. This is BERIL's differentiator: the plan is grounded in
real, accessible data, not assumed schemas.

## What a strong plan contains

- A sharp, answerable **research question** and explicit **hypotheses** (H0/H1), **2–3 competing hypotheses** with a discrimination strategy, and a **falsification test** for H1 — the agent drafts these *before* asking the scientist's preference, so the design isn't wed to one story.
- **Literature context** tying the question to what is known (pull from
  `references.md` / the literature-review skill where relevant).
- A concrete **query strategy**: the specific tables, the filter strategy for
  large tables, and the performance tier (bounded local Spark SQL vs JupyterHub).
- An **analysis plan as numbered notebooks**, each with a goal and expected
  outputs — this becomes the scaffold the analysis-notebooks skill runs.
- Realistic **expected outcomes** and how you would know the hypothesis held.

## Template

Write `projects/<id>/RESEARCH_PLAN.md` with this structure:

```markdown
# Research Plan: {Title}

## Research Question
{One or two sentences — specific and answerable with available data.}

## Hypothesis
- **H0**: {Null hypothesis}
- **H1**: {Alternative hypothesis}

### Competing Hypotheses
Frame 2–3 rivals the available BERDL data could *distinguish* — not strawmen:
- **H2**: {alternative mechanism}. Favoured if the data shows {outcome}.
- **H3**: {alternative}. Favoured if {outcome}.
**Discrimination strategy**: {the specific query/figure result that would tell H1, H2, H3 apart.}

### Falsification test
- **What would refute H1?** {the single result — effect below a threshold, a pattern's absence, a sign flip — that would make you reject H1.}

### Confidence prior
- Before any data: **HIGH / MEDIUM / LOW** — {why; cite literature for HIGH}. (Compared against the posterior at synthesis; a large gap is itself a finding.)

## Literature Context
{What is known; key references (PMIDs) from references.md.}

## Query Strategy
### Tables Required
{db.table — why; confirmed via berdl_peek.}
### Key Queries
{The core queries / joins, with filter strategy for large tables.}
### Performance Plan
{Bounded local Spark SQL vs JupyterHub Spark; expected data sizes.}

## Analysis Plan
### Notebook 1: Data Exploration
{Goal + expected outputs.}
### Notebook 2: Main Analysis
{Goal + expected outputs.}
### Notebook 3: Visualization
{Goal + figures.}

## Expected Outcomes
{What results would support/refute H1; what figures/tables you expect.}

## Revision History
- **v1** ({date}): Initial plan

## Authors
{Name — affiliation — ORCID}
```

## After drafting

1. Call the `research_plan` tool to show the plan as a formatted card.
2. Move the project to `proposed` with `lifecycle_transition`.
3. **Check in** — the plan is a decision point, not a step to rush past. Ask the
   scientist whether to: approve and start the analysis (`/analyze`), get an
   independent plan review first (`/berdl-review <project> --plan`), or iterate.
   Surface the one or two assumptions you are least sure of so they can correct
   you cheaply now rather than after notebooks are written.

Revisions during analysis are recorded as new Revision History entries (`v2`,
…); they update the plan in place and do not change lifecycle state.
