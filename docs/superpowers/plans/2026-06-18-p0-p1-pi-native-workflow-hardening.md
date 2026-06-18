# P0/P1 Pi-native workflow hardening implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` for independent lanes and `superpowers:test-driven-development` for each code lane. Keep edits scoped to the files listed here.

**Goal:** Implement the P0/P1 workflow hardening from `docs/superpowers/specs/2026-06-18-p0-p1-pi-native-workflow-hardening-design.md`: provenance/trace, authorization stop behavior, planning preflight, notebook cache/resume support, and paper-plan separation.

**Architecture:** Deterministic state lives in BERIL project artifacts and CLI helpers. Pi extensions expose commands/tools/cards and event hooks. Skills carry scientific judgment only. Existing lifecycle/checkpoint/review controls remain authoritative.

**Tech Stack:** TypeScript ESM Pi extensions, TypeBox schemas, Bun test runner, Python CLI with uv/pytest.

---

### Lane A: Provenance and Trace (P0)

**Files:**
- Modify: `beril_cli/lifecycle_cmd.py`
- Modify: `extensions/beril-memory.ts`
- Create: `lib/project-audit.ts`
- Create: `extensions/beril-audit.ts`
- Test: `tests/test_cli_session_state.py`
- Test: `tests/test_cli_lifecycle_cmd.py`
- Test: `test/project-audit.test.ts`
- Test: `test/beril-audit.test.ts`

- [x] Write failing tests for `provenance.json`, `TRACE.jsonl`, legacy `research_state` fallback, `/provenance`, and `/trace`.
- [x] Move lifecycle `session-state` persistence from `beril.yaml` to `provenance.json` while keeping the CLI JSON contract.
- [x] Append trace rows after successful lifecycle `set`, `approve`, `marker`, and `session-state --set`.
- [x] Add a small audit helper for redacted JSONL rows and provenance snapshots.
- [x] Add a Pi extension with `/provenance`, `/trace`, and project-scoped event trace hooks.

### Lane B: Authorization Stop Behavior (P0)

**Files:**
- Modify: `lib/beril-exec.ts`
- Modify: `scripts/run_sql.py`
- Modify: `extensions/beril-data.ts`
- Test: `test/beril-exec.test.ts`
- Test: `test/beril-data.test.ts`
- Test: `tests/test_run_sql_errors.py`

- [x] Write failing tests for permission/auth/connectivity classification and feasibility abort behavior.
- [x] Add an error classifier with compatibility wrappers for existing connectivity behavior.
- [x] Sanitize SQL runner permission/auth failures into plain-language stop guidance.
- [x] Update data tools so permission/auth never looks like absent schema or optional coverage failure.

### Lane C: Planning Preflight (P1)

**Files:**
- Modify: `extensions/beril-plan.ts`
- Test: `test/beril-plan.test.ts`

- [x] Write failing tests for `planning_preflight` persistence/rendering and `/research-plan` prompt requirements.
- [x] Add `planning_preflight` as the deterministic handoff between discovery/feasibility and `RESEARCH_PLAN.md`.
- [x] Update `/research-plan` to require the preflight artifact and a checkpoint before analysis.

### Lane D: Notebook Cache/Resume (P1)

**Files:**
- Modify: `beril_cli/notebook_cmd.py`
- Modify: `beril_cli/cli.py`
- Modify: `scripts/run_notebook.py`
- Modify: `extensions/beril-analysis.ts`
- Modify: `skills/analysis-notebooks/SKILL.md`
- Test: `tests/test_cli_notebook.py`
- Test: `tests/test_notebook_hash.py`
- Test: `test/beril-analysis.test.ts`

- [x] Write failing tests for cache scaffold, execution metadata, resume behavior, hash stability, and `notebook_run({ resume: true })`.
- [x] Scaffold `notebooks/util.py` and `data/cache/` without overwriting existing user files.
- [x] Stamp BERIL execution metadata when notebooks are run.
- [x] Add `beril notebook run --resume` that skips only prior successful BERIL executions.
- [x] Teach `/analyze --continue` to use resume-aware `notebook_run`.

### Lane E: Paper Plan (P1)

**Files:**
- Create: `skills/paper-plan/SKILL.md`
- Create: `extensions/beril-paper.ts`
- Modify: `lib/capabilities.ts`
- Modify: `README.md`
- Test: `test/beril-paper.test.ts`
- Test: `test/capabilities.test.ts`

- [x] Write failing tests for `/paper-plan`, `paper_plan`, and capability catalog inclusion.
- [x] Add a paper-plan skill focused on narrative assembly from approved analysis artifacts.
- [x] Add a thin command/tool pair for `PAPER_PLAN.md` and a checkpoint before `/synthesize`.
- [x] Document the command at the README level.

### Final Verification

- [x] Run focused TS/Python tests for all touched lanes.
- [x] Run `env -u NO_COLOR bun test`.
- [x] Run `env -u NO_COLOR bun run check`.
- [x] Run `uv run --group test pytest tests`.
- [x] Inspect `git status --short --branch` and `git diff --stat`.
