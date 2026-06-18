# P0/P1 Pi-native workflow hardening design

Status: planned

## Intent

Translate the BERIL UI/UX meeting feedback into the current Pi agent architecture, not the old Claude Code BERIL agent. The highest-value work is to make research runs auditable, stop wasteful authorization retries, add an explicit planning checkpoint, improve notebook resume behavior, and separate paper assembly from analysis without building a parallel workflow system.

## Prioritization

### P0: scientific control and reproducibility

1. **Project provenance and trace artifacts**
   - Problem: researchers need to know what version/model/session path produced a study.
   - Pi-native home: extension event hooks plus project artifacts.
   - Deliverables:
     - `projects/<id>/provenance.json` for latest run context and research snapshot.
     - `projects/<id>/TRACE.jsonl` for append-only lifecycle/session actions.
     - `/provenance <project>` and `/trace <project>` read-only views.

2. **Authorization-aware data failures**
   - Problem: access denied should stop immediately with plain-language guidance.
   - Pi-native home: BERIL CLI/error helper and data extension tools.
   - Deliverables:
     - classify permission/auth errors separately from connectivity and missing-data errors.
     - `berdl_query`, `berdl_peek`, and `berdl_feasibility` surface permission/auth as stop conditions.
     - sanitize SQL runner errors before they reach non-technical users.

### P1: checkpoints and resume ergonomics

3. **Planning preflight**
   - Problem: users need an explicit chance to inspect question, data, schema, and assumptions before analysis.
   - Pi-native home: `/research-plan` command, `planning_preflight` tool, `request_checkpoint`.
   - Deliverables:
     - `projects/<id>/PLANNING_PREFLIGHT.json`.
     - `/research-plan` prompt requires `planning_preflight` before writing `RESEARCH_PLAN.md`.

4. **Notebook cache/resume convention**
   - Problem: notebooks should be resumable after failures without rerunning expensive work.
   - Pi-native home: Python notebook CLI scaffold/execution metadata and `notebook_run` tool.
   - Deliverables:
     - scaffold `notebooks/util.py` and `data/cache/`.
     - stamp BERIL execution metadata on notebook run.
     - expose notebook execution state in `notebook_list`.
     - add `beril notebook run --resume` and `notebook_run({ resume: true })`.

5. **Paper plan surface**
   - Problem: analysis exploration and publication narrative are different artifacts.
   - Pi-native home: skill for scientific writing judgment, thin extension command/tool for file display.
   - Deliverables:
     - `skills/paper-plan/SKILL.md`.
     - `/paper-plan <project>` command.
     - `paper_plan` display tool for `projects/<id>/PAPER_PLAN.md`.

## Explicit non-goals for this pass

- No skill marketplace or SDK. That belongs behind a separate extension-vetting design.
- No new Pi mode, MCP server, or separate planner agent runtime. Pi 0.79.1 exposes commands, tools, renderers, events, and session APIs; the workflow should use those.
- No parallel notebook fan-out. Resume should be deterministic and inspectable before adding concurrency.
- No broad UI redesign. Existing science cards, statusline, `/whereami`, `/next`, lifecycle, checkpoint, and review surfaces remain the primary UI.

## Construct placement

| Need | Pi-native construct | Reason |
| --- | --- | --- |
| deterministic project state | Python CLI + project JSON/JSONL artifacts | survives sessions; testable without model |
| action/read views | extension tools and slash commands | discoverable and Pi-native |
| scientific judgment | skills | prompts carry rubrics and domain decisions |
| human approval seam | `request_checkpoint` tool | existing explicit check-in surface |
| session audit events | extension event hooks + trace helper | captures Pi actions without becoming authority |
| notebook resume | CLI execution metadata | deterministic, independent of model prose |

## Risk controls

- `TRACE.jsonl` is evidence, not authority. Lifecycle remains in `beril.yaml`.
- Permission/auth errors must not be recorded as missing tables or weak feasibility.
- Notebook resume skips only notebooks with explicit successful BERIL execution metadata, not notebooks with arbitrary outputs.
- `/aside` remains off-the-record and must not be mirrored into project trace content.
- `PAPER_PLAN.md` does not change lifecycle by itself; review and submit gates remain unchanged.

## Verification

- Focused TS tests for data classification, planning preflight, paper plan, and analysis resume.
- Focused Python tests for lifecycle/session trace and notebook scaffold/resume metadata.
- Full checks:
  - `env -u NO_COLOR bun test`
  - `env -u NO_COLOR bun run check`
  - `uv run --group test pytest tests`
