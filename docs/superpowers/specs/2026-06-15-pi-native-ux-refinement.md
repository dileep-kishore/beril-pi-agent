# Pi-native UX refinement — tracer-bullet slice

Status: implemented (slices 1–4)

## Intent

BERIL should feel like a Pi-native scientific workbench, not a prompt-script port: persistent state belongs in Pi chrome/cards, deterministic workflow decisions belong in code, and skills should carry scientific judgment rather than command choreography.

## Layering rule

- **Code / CLI / extensions** own deterministic state: lifecycle, current project, cached BERDL readiness, next command, card rendering, safety gates.
- **Pi UI** owns orientation: footer/HUD, phase banners, focused overlays, compact science cards.
- **Skills** own judgment: feasibility reasoning, biological interpretation, pitfalls, calibrated-trust rubrics, review criteria.

## Implemented in this slice

### `/whereami`

A deterministic Pi slash command that shows a workflow card with:

- active project (from `beril lifecycle current`)
- lifecycle status and scientist-facing phase
- cached BERDL readiness when known, otherwise a `/berdl-status` nudge
- stored research-state claim counts and last checkpoint when present
- deterministic next action and command

No BERDL/DLH query is performed. It reads only the lifecycle CLI and the in-process readiness cache.

### `/next`

A deterministic Pi slash command that shows the next workflow command/action for the active project:

| Lifecycle | Recommended command/action |
| --- | --- |
| none/unknown | `/berdl-status`, then explore data or start a project |
| exploration | use discovery/query tools, then `/research-plan` |
| proposed | `/analyze <project>` |
| active | `/analyze <project>` |
| analysis | `/berdl-review <project>` |
| reviewed | `/submit <project>` |
| complete | done; reopen intentionally before changing |

### Workflow card renderer

`beril-workflow-status` renders a compact governance-coloured card. The model does not infer this state; it is computed from lifecycle state + optional `research_state`.

## Files

- `extensions/beril-workflow.ts`
- `lib/workflow.ts`
- `lib/ui/workflow-card.ts`
- `test/beril-workflow.test.ts`

## Safety/trust notes

This slice is read-only and non-destructive. It does not require DLH connectivity, does not open tunnels, and does not query BERDL. It may display cached readiness from prior tools, but if no cache exists it explicitly says BERDL was not checked in this session.

## Additional implemented slices

### Verification footer

Major evidence/governance/analysis cards now include a concise `Verify:` line when there is a concrete next check: open evidence pointers, re-run `claim_ledger`/`evidence`, inspect notebooks, or re-run `notebook_hash` before review/submit. The footer is rendered by `verifyLine()` so verification language is consistent and testable.

### Project-id command completion

Core project-scoped commands now expose Pi argument completions from `projects/*`:

- `/research-plan`
- `/analyze`
- `/synthesize`
- `/berdl-review`
- `/berdl-refute`
- `/submit`

The helper is intentionally local/read-only (`process.cwd()/projects`) because Pi's command-completion hook receives only the prefix, not a command context.

### Skill thinning / ideology split

Core workflow skills now explicitly defer deterministic orientation to `/whereami` and `/next`, keeping the skills focused on scientific judgment: feasibility, notebook design, interpretation, review rubrics, and responsible approval.

## Remaining future slices

1. Consider project-id completion for tool arguments if Pi exposes a tool-argument completion API in a future pinned version.
2. Add richer `Verify:` footers to report/synthesis cards if/when synthesis becomes a first-class rendered artifact rather than a prompt-driven file write.
