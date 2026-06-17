# Co-Scientist Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make BERIL Pi a Pi-native scientific cockpit with discoverable skills, action-oriented status, session reroll commands, first-class claims/evidence, project-scoped literature, refutation surfaces, and approved-memory idea support.

**Architecture:** Keep scientific judgment in skills and durable execution/state in extensions plus small pure helpers. Add files for capability routing, rollback labels, claim-state JSON, refutation summaries, literature target parsing, and science-memory indexing; wire them through existing Pi command/tool patterns. Persist only inspectable project artifacts (`claims.json`, project `references.md`, optional memory index), not opaque runtime state.

**Tech Stack:** TypeScript ESM Pi extensions, Node test runner via Bun, Biome/TypeScript checks, Python CLI tests via uv.

---

### Task 1: Capability Discovery + Skill Routing

**Files:**
- Create: `lib/capabilities.ts`
- Create: `lib/ui/capabilities.ts`
- Create: `extensions/beril-capabilities.ts`
- Test: `test/capabilities.test.ts`
- Test: `test/beril-capabilities.test.ts`

- [x] Write failing tests for capability categories, prompt matching, command registration, and custom-message rendering.
- [x] Add a static BERIL capability catalog grouped by scientist intent: start, discover, plan, analyze, literature, synthesize, refute, review, submit, memory.
- [x] Add `/skills` and `/capabilities` commands that render the catalog and show runtime command/tool counts from `pi.getCommands()` / `pi.getAllTools()`.
- [x] Add a `before_agent_start` router hint that appends a short route suggestion to the system prompt and displays a custom nudge when a plain-language prompt clearly maps to a BERIL skill.
- [x] Verify focused tests, then full TypeScript checks.

### Task 2: Action HUD + Session Reroll

**Files:**
- Modify: `lib/workflow.ts`
- Modify: `lib/ui/workflow-hud.ts`
- Create: `lib/session-reroll.ts`
- Create: `extensions/beril-reroll.ts`
- Test: `test/beril-workflow.test.ts`
- Test: `test/workflow-hud.test.ts`
- Test: `test/session-reroll.test.ts`
- Test: `test/beril-reroll.test.ts`

- [x] Write failing tests for secondary workflow actions and BERIL session labels.
- [x] Add deterministic next-action arrays per lifecycle phase.
- [x] Show compact action choices in the HUD below the main next hint.
- [x] Add `/bookmark-science`, `/back-to-plan`, and `/reroll-analysis-from` commands using Pi labels and `ctx.fork()`.
- [x] Auto-label lifecycle and checkpoint seams when the relevant event contains enough context.
- [x] Verify focused tests, then full TypeScript checks.

### Task 3: Deterministic Analyze/Synthesize Seams

**Files:**
- Modify: `extensions/beril-analysis.ts`
- Modify: `extensions/beril-governance.ts`
- Test: `test/beril-analysis.test.ts`
- Test: `test/beril-governance.test.ts`

- [x] Write failing tests for `/analyze --first-result`, `/analyze --continue`, and synthesis prompt gate text.
- [x] Teach `/analyze` to generate first-result and continue instructions, so the first-result checkpoint is explicit instead of buried in prose.
- [x] Strengthen `/synthesize` to require `claim_state`, `claim_ledger`, `evidence`, and refuting/literature checks before review.
- [x] Verify focused tests, then full TypeScript checks.

### Task 4: First-Class Claim State

**Files:**
- Create: `lib/claim-state.ts`
- Modify: `extensions/beril-governance.ts`
- Modify: `lib/ui/science-cards.ts`
- Test: `test/claim-state.test.ts`
- Test: `test/beril-governance.test.ts`
- Test: `test/science-cards.test.ts`

- [x] Write failing tests for deriving claim state from plan/report, merging existing `claims.json`, and rendering state quality.
- [x] Add a `claim_state` tool that reads `RESEARCH_PLAN.md` / `REPORT.md`, merges stable IDs with existing `claims.json`, and optionally persists the current ledger.
- [x] Broadcast the same claim tally used by the statusline.
- [x] Render a claim-state card that highlights unsupported claims, empty refutes, stale rows, and verification action.
- [x] Verify focused tests, then full TypeScript checks.

### Task 5: Literature + Refutation Surfaces

**Files:**
- Modify: `extensions/beril-literature.ts`
- Create: `lib/refutation.ts`
- Modify: `extensions/beril-refute.ts`
- Test: `test/beril-literature.test.ts`
- Test: `test/beril-refute.test.ts`

- [x] Write failing tests for project-scoped `/literature-review`, `--project`, and refutation summary extraction.
- [x] Make `/literature-review` infer or accept a project and write `projects/<id>/references.md` when scoped.
- [x] Render a red-team custom message after `/berdl-refute` using the existing `redTeamCard`.
- [x] Verify focused tests, then full TypeScript checks.

### Task 6: Approved Scientific Memory + Idea Tournament

**Files:**
- Create: `lib/scientific-memory.ts`
- Create: `extensions/beril-ideas.ts`
- Test: `test/scientific-memory.test.ts`
- Test: `test/beril-ideas.test.ts`

- [x] Write failing tests for extracting approved discoveries/performance notes from complete projects and formatting an idea-tournament prompt.
- [x] Add a `science_memory` tool and `/science-memory` command to build an inspectable JSONL index from complete projects.
- [x] Add `/idea-tournament [topic]` that shows the memory basis and sends a structured multi-role co-scientist prompt: data scout, literature scout, methods skeptic, refuter, novelty ranker.
- [x] Verify focused tests, then full TypeScript checks.

### Task 7: Final Verification

**Files:**
- Modify docs only if implementation discovers user-facing command details that must be documented.

- [x] Run `env -u NO_COLOR bun test`.
- [x] Run `env -u NO_COLOR bun run check`.
- [x] Run `uv run --group test pytest tests`.
- [x] Inspect `git status --short --branch` and `git diff --stat`.
- [x] Commit with a conventional message.
