---
name: suggest-research
description: Use when the user wants to identify the next best research direction in BERIL — review what has already been done (completed projects, findings, proposed ideas) and the available BERDL data, then synthesize a prioritized recommendation for a new high-impact research topic grounded in scientific gaps, data readiness, and impact. Triggers include "what should I work on next", "suggest a research topic", "what's the next project", or asking for the next direction based on prior work.
---

# Suggest Research

Survey the research landscape — completed projects and their findings, in-progress work, proposed ideas, and available BERDL data — then synthesize a prioritized recommendation for the next research topic. The recommendation is grounded in what has been learned, what data is available, and where scientific impact is highest.

State your assumptions and surface tradeoffs as you go. The goal is judgment, not just enumeration.

## Tailoring to the User

Before expensive landscape synthesis, ask only the missing high-information
questions that would change the recommendation. Prefer 1–3 concise choices:

1. Preferred scientific theme? (e.g., evolution, metabolism, ecology, gene function, AMR)
2. Effort preference? (Low: 1–2 weeks / Medium: ~1 month / High: multi-month)
3. Extend an existing project or open an entirely new direction?

If the prompt already supplies a constraint, use it rather than re-asking. If a
missing answer would not change the ranking, proceed and state the assumption. If
the user says "just suggest something," proceed with no constraints and state
that assumption.

## Landscape Synthesis

Build a picture of the research space before recommending anything. Gather across these dimensions:

- **Completed topics** — what themes have been thoroughly investigated? Capture each completed project's headline **Key Findings** (the 2–4 results), **Future Directions** (investigator-suggested follow-ups), **Limitations** (gaps the authors named), and **Novel Contribution** (what made it scientifically unique).
- **Active topics** — what is currently in progress, so you avoid duplicating it.
- **Proposed backlog** — which proposed ideas have their prerequisites met now? Note each idea's research question, hypotheses, priority/effort, impact, and dependencies.
- **Discovery log** — serendipitous findings, cross-analysis patterns, and data anomalies that are *not yet* formalized into a project. These are often the highest-value starting points. Review-vetted per-project discoveries take precedence over any stale duplicate of the same finding in a central archive; untagged background patterns are always context.
- **Underexplored data** — which BERDL collections exist but are rarely cited in completed reports.
- **Recurring gaps** — what limitation appears across multiple project reports (a recurring gap is a strong signal of a worthwhile direction).

Cross-check claimed status against actual state: a topic listed as "proposed" may already be partly done, and a completed report's Future Directions may already name the best next step. Note cross-project patterns — recurring organisms, pathways, taxa (GTDB lineages), functional categories (COG), pathways/metabolism themes, AMR signatures, or data gaps that surface in more than one report.

Use `lifecycle_transition` state awareness to read project standing (exploration → proposed → active → analysis → reviewed → complete) when judging whether a topic is truly "done" or still open.

## Grounding in BERDL Data

A recommendation is only as good as the data backing it. Establish data readiness before committing to a candidate.

- Use **`berdl_discover`** for the live, access-aware inventory of BERDL databases (and, with `database=<id>`, that database's tables); use **`berdl_peek`** to inspect a specific table's columns. For each candidate collection, note: collection name/identifier, the organism / scale / data type it covers, and whether it has been heavily used (cross-reference completed reports) or is **underexplored**.
- Use **`berdl_query`** (bounded SELECT, limit 100) to spot-check that a candidate collection actually contains the rows, organisms, genes, or annotations the proposed question needs — confirm coverage and plausible volume before recommending it. Treat these as feasibility probes, not analysis.
- Run **`/berdl-status`** to confirm the connection/environment is live; if not connected, **`/berdl-connect`** first. (Use `berdl_env_check` if you need to verify the environment programmatically.)

Identify underexplored collections — present in BERDL but rarely leveraged in completed work — as prime candidates for novel, data-ready directions.

## Candidate Scoring

From the synthesized landscape, identify **2–3 candidate topics**. Score each against this weighted rubric and select the strongest combined score; retain the runner-up as an alternative.

| Criterion | Weight | Question |
|---|---|---|
| Scientific novelty | High | Is this genuinely new relative to completed work? |
| Data readiness | High | Is the required BERDL data available and well-characterized (verified via `berdl_discover` / `berdl_query`)? |
| Impact | High | Does it extend or challenge a significant existing finding? |
| Feasibility | Medium | Are dependencies met? Does similar methodology already exist in the repo to reuse? |
| Competing hypotheses / resolvability | Medium | Does the suggested project identify competing explanations and have the data to *discriminate* between them — i.e. is it resolvable, not just additive? |
| Backlog alignment | Medium | Does it address a proposed idea or a Future Direction from a completed report? |
| Effort fit | Low | Is the scope appropriate for a focused project? |

The three High-weight criteria (novelty, data readiness, impact) should dominate the decision; a topic that is novel and impactful but data-starved is not yet a good next project.

## Novelty Check Against the Literature

Before finalizing the top candidate, confirm it is genuinely new. Run **`/literature-review <topic>`** (or use `lit_search` / `lit_fetch` directly) to answer:

1. Has this specific question been studied before, and in which organisms/scales?
2. What methods were used and what were the results?
3. What remains unstudied or contested?
4. Are there contradictory findings that BERDL's scale could resolve?

Use this to sharpen the hypothesis and confirm the candidate is not redundant. Anchor literature queries with the right vocabulary (MeSH terms, organism/taxon names, gene/pathway/COG identifiers) so the search is precise.

## Present the Recommendation

Deliver a structured recommendation. Use the user's ORCID identity (`beril_user`) for attribution where relevant.

```markdown
## Recommended Research Topic: {Title}

### Why Now?
{1–2 sentences: what completed work enables this, and why it is the right next step}

### Research Question
{The specific scientific question, one sentence}

### Hypotheses
- **H1**: {Primary hypothesis, with direction}
- **H0**: {Null hypothesis}
- **H2** (optional): {Secondary exploratory hypothesis}

### Grounding in Completed Work
- Extends **{project}** (Finding: {key result from its report})
- Addresses the limitation noted in **{project}**: "{limitation quote}"
- Reuses methodology established in **{project}**

### Required BERDL Data
| Collection | Tables | What it provides |
|---|---|---|
| `{collection}` | `{table}` | {description, confirmed via berdl_discover/berdl_query} |

### Approach
1. {Data extraction approach}
2. {Analysis method}
3. {Statistical test or model}
4. {Validation or comparison}

### Expected Impact
- {Scientific contribution}
- {Connection to the broader BERIL mission}

### Literature Context
- Aligns with: {Author et al. Year} — {key point}
- Extends beyond: {Author et al. Year} — {what BERDL adds}
- Open question: {what the literature has not settled}

### Effort Estimate
**{Low / Medium / High}** — {brief rationale}

### Dependencies
- {Prerequisite data, analysis, or completed project required}

---

### Alternative Topic: {Alt Title}
{2–3 sentence summary of the runner-up and why it ranked second}
```

When the recommendation extends an existing project or proposed idea rather than opening a new direction, state that relationship explicitly (e.g., "Extends `{project}`" / "Builds on proposed idea `{title}`") so the lineage is clear.

## After the Recommendation

Once the top candidate is presented, ask whether the user wants to register and start it:

> "Would you like me to register this idea and start it as a new project?"

If yes, hand off to the relevant Pi command/tool rather than editing files yourself:

- To scaffold and begin the new project from the confirmed idea (title, research question, hypotheses, approach, and BERDL data sources from the recommendation), run **`/berdl-start`** — pass the idea as starting context so the new project picks up the ideation already done here.
- To advance the idea's standing in the research lifecycle, use **`lifecycle_transition`** (e.g., exploration → proposed → active).
- To pull the synthesized recommendation into a working project write-up, run **`/synthesize <project>`**.

When the recommendation extends or builds on an existing project or proposed idea (rather than opening a new direction), state that lineage in the handoff context — never silently overwrite or restate prior work as new.

Project registration, the idea backlog, notebook scaffolding, and all state/UI are owned by Pi extensions — delegate to them; do not write registry or backlog files directly. If the user declines, leave everything unmodified.
