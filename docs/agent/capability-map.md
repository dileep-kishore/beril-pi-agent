# Capability map

Update this page when an extension, skill, CLI command, or its ownership changes.
Exact schemas and arguments remain authoritative in the referenced source.

## Pi extensions

| Extension | Surface | Supporting logic and primary tests |
| --- | --- | --- |
| `beril-analysis` | Tools `notebook_scaffold`, `notebook_list`, `notebook_run`; `/analyze`, `/figures` | `beril notebook`, `lib/figures.ts`, figure cards; `test/beril-analysis.test.ts`, `test/figures.test.ts` |
| `beril-aside` | `/aside` off-the-record branch | `lib/aside.ts`, `lib/ui/aside-overlay.ts`; `test/beril-aside.test.ts` |
| `beril-audit` | Tools `project_provenance`, `project_trace`; `/provenance`, `/trace`; audit hooks | `lib/project-audit.ts`; audit and trace tests |
| `beril-capabilities` | `/skills`, `/capabilities`, palette, route nudge | `lib/capabilities.ts`, `lib/nudge-policy.ts`; capability/nudge tests |
| `beril-checkpoint` | Tools `request_input`, `request_checkpoint` | checkpoint cards/overlay; checkpoint tests |
| `beril-commons` | Tools `commons_check`, `commons_land`; `/commons` | `beril commons`, KOROS cards; commons tests in both suites |
| `beril-conduct` | Trusted-session `before_agent_start` contract | `lib/conduct.ts`; `test/conduct.test.ts` |
| `beril-data` | Tools `berdl_query`, `berdl_discover`, `berdl_peek`, `berdl_feasibility`, `berdl_validate`, `berdl_export`; `/berdl-preview` | readiness, peek, render, hints, `beril query/discover/validate/export`; data tests |
| `beril-display` | Compact/redacted `bash` replacement and collapsed TUI tools | display renderer; `test/beril-display.test.ts`, quiet-tool tests |
| `beril-env` | Tool `berdl_env_check`; `/berdl-connect`, `/berdl-status`, `/berdl-welcome`; HUD/footer/status hooks | readiness and `lib/ui/*`; env, footer, welcome, HUD tests |
| `beril-governance` | Tools `notebook_hash`, `claim_ledger`, `claim_state`, `review_preflight`, `evidence`, `lifecycle_transition`, `gate_record`, `beril_user`, `lakehouse_submit`; `/gates`, `/synthesize`, `/submit` | claim, gate, lifecycle, preflight, submit code; governance/claim/gate tests |
| `beril-ideas` | Tool `science_memory`; `/science-memory`, `/idea-tournament` | `lib/scientific-memory.ts`; ideas/memory tests |
| `beril-literature` | Tools `lit_search`, `lit_fetch`, `lit_abstract`, `lit_stance`; `/literature-review` | PubMed/Europe PMC clients, bounded fan-out, citation verification; literature tests |
| `beril-memory` | Compaction snapshot/reinjection hooks | `lib/session-state.ts`; memory and session-state tests |
| `beril-paper` | Tool `paper_plan`; `/paper-plan` | paper card; `test/beril-paper.test.ts` |
| `beril-plan` | Tools `planning_preflight`, `research_plan`; `/research-plan` | plan cards; `test/beril-plan.test.ts` |
| `beril-reroll` | `/bookmark-science`, `/reroll-analysis-from`, `/back-to-plan` | `lib/session-reroll.ts`; reroll tests |
| `beril-review` | `/berdl-refute`, `/berdl-review` including optional panel | review agent, rubrics, finalize/hash and refutation helpers; review/refute tests |
| `beril-safety` | Central destructive `tool_call` gate | `lib/destructive.ts`, destructive overlay; safety tests |
| `beril-web` | Tools `web_read`, `docs_lookup` | `lib/web.ts`, SSRF guard and docs client; web tests |
| `beril-workflow` | `/whereami`, `/next` | `lib/workflow.ts`, review preflight and workflow card; workflow tests |
| `beril-world` | Tool `world_model`; `/world-model` | `lib/session-state.ts`; world/session-state tests |

`package.json:pi` loads every extension, skill, prompt, and theme directory. A
new extension or skill therefore changes the package surface even without an
explicit manifest entry; re-run `pi install -l .` after pulling such changes.

## Skills

Skills contain judgment, not mechanics:

| Lane | Skills |
| --- | --- |
| Data exploration | `berdl-query`, `berdl-discover`, `data-validity`, `berdl-minio` |
| Study construction | `research-plan`, `analysis-notebooks`, `paper-plan`, `synthesize` |
| Evidence and review | `literature-review`, `berdl-review`, `lifecycle-gates`, `submit` |
| Cumulative discovery | `commons-check`, `suggest-research`, `world-model`, `pitfall-capture` |

The model may select a skill automatically or the user may invoke
`/skill:<name>`. A user-facing workflow command should orchestrate mechanics and
delegate scientific judgment to its matching skill.

## Bundled CLI

`beril_cli/cli.py` is the exact parser registry. Current top-level commands are:

| Area | Commands |
| --- | --- |
| Setup and launch | `doctor`, `setup`, `start`, `env`, `user` |
| BERDL access | `query`, `discover`, `export` |
| Analysis artifacts | `notebook`, `hash`, `validate` |
| Governance and memory | `lifecycle`, `commons`, `crate`, `submit` |

Most commands are thin wrappers. `beril_cli/lifecycle.py` and
`beril_cli/lifecycle_cmd.py` are intentionally substantive because lifecycle
enforcement must be shared by every caller. `scripts/` and `tools/` are not
included in the Python wheel; commands resolve them from the workspace root.

## Live registries

When exact inventory matters, inspect only the relevant registry rather than
rediscovering the repository:

- Package resources: `package.json` → `pi`.
- User/model routes: `lib/capabilities.ts`.
- Tools, commands, events, and renderers: the owning `extensions/*.ts` file.
- CLI arguments and dispatch: `beril_cli/cli.py`.
- Lifecycle gates: `lib/gates.ts` for the readable catalog and
  `beril_cli/lifecycle_cmd.py` for enforcement.
