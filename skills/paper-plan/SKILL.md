---
name: paper-plan
description: Use after analysis notebooks have produced results and before synthesis, when BERIL should separate the publication narrative from the mechanical research plan. Guides creation of PAPER_PLAN.md from executed notebooks, figures, claims/evidence, and the approved research plan.
---

# Paper plan

Use this skill to create `PAPER_PLAN.md`, the narrative assembly plan for the paper/report. This is distinct from `RESEARCH_PLAN.md`: the research plan says what to test; the paper plan says what story the executed evidence can honestly support.

## Inputs

- `RESEARCH_PLAN.md`
- executed notebooks with saved outputs
- figures under `figures/`
- `claims.json`, `references.md`, and existing `REPORT.md` when present
- known refuting or limitation evidence

## Rules

- Do not invent a story before the analysis exists.
- Lead with the result the executed notebooks actually support, not the original hoped-for result.
- Keep unsupported claims out of the narrative plan or mark them as gaps requiring more analysis.
- Preserve refutations and limitations as first-class material, not cleanup text.
- Identify what must be checked before `/synthesize`: stale notebooks, missing figures, weak evidence, missing citations, or claims without refutes.

## Template

```markdown
# Paper Plan

## Central Claim

## Evidence Backbone

## Figure Plan

## Narrative Outline

## Claims To Exclude Or Qualify

## Limitations And Refuting Evidence

## Synthesis Checklist
```

After writing `PAPER_PLAN.md`, call `paper_plan` to show it and `request_checkpoint` before `/synthesize`.
