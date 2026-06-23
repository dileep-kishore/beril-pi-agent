# Co-scientist trust, review, and investigation-state hardening — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `superpowers:test-driven-development` for each code lane and
> `superpowers:subagent-driven-development` for independent lanes. Keep edits
> scoped to the files listed here. Run only the touched lane's targeted tests
> while iterating; run the full suite before commit.

**Goal:** Implement the design in
`docs/superpowers/specs/2026-06-23-coscientist-trust-hardening-design.md`: a
trustworthy review gate (WS1), a faithfulness-vs-groundedness trust split (WS2),
and a coherent investigation world model (WS3) — reusing the three existing state
planes (`beril.yaml:approval`, `claims.json`, `provenance.json:research_state`),
adding no new store and no new subagent.

**Architecture:** Judgment in rubrics/skills; the authoritative gate in the
Python state machine; trust computation in `lib/science.ts`/`lib/claim-state.ts`;
surface (tools/commands/cards/hooks) in extensions; measurement in pytest.

**Tech stack:** TypeScript ESM Pi extensions, TypeBox schemas, `node --test`;
Python CLI with uv/pytest.

**Scope of this plan:** Phases 1–3 (near-term MVP) are fully specified. Phase 4
(P1.6 eval + P1.4 falsification pass) is sketched and gated on Phases 2–3.

**Sequencing rule:** Phase 1 first — it closes a live safety hole *and* unbreaks
`/submit`. WS3 must not start before WS1 settles the authoritative gate.

---

## Phase 1 — Trustworthy review gate (WS1: P0.1 + P0.2)

**Files:**
- Modify: `lib/review-rubric.ts`
- Modify: `skills/berdl-review/SKILL.md`
- Modify: `beril_cli/lifecycle_cmd.py`
- Modify: `beril_cli/lifecycle.py` (if the legal-edge helper needs the gate)
- Modify: `extensions/beril-review.ts`
- Test: `test/beril-review.test.ts`
- Test: `tests/test_cli_lifecycle_cmd.py`

**P0.1 — leakage-aware reviewer:**
- [ ] Write failing tests asserting the rubric carries a `Data leakage &
      evaluation integrity` clause and the read-outputs steer.
- [ ] Add the `Data leakage & evaluation integrity` clause (4 silent failure
      modes) to `PROJECT_REVIEW_RUBRIC` and the panel `STATS_REVIEW_RUBRIC`.
- [ ] Change "focus on cell `source`, skip outputs" → "read cell outputs that
      report metrics / split sizes / class balances"; add "also read
      `claims.json` and the `research_state` world-model section" (the WS2/WS3
      cross-link).
- [ ] Mirror the clause + read-outputs guidance in `skills/berdl-review/SKILL.md`.

**P0.2 — human ORCID sign-off at `analysis → reviewed`:**
- [ ] Write failing pytest: bare `set reviewed` from `analysis` (no `--orcid`)
      returns non-zero; with valid `--orcid`/`--report-hash`/`--review`/`--review-hash`
      it writes the `approval` block (canonical key order, raw-file hashes).
- [ ] Add `_validate_review_signoff` to the `set` action: when current status is
      `analysis` and target is `reviewed`, require the approval flags and write
      the `approval` block **inline on the transition** (non-bypassable by the
      generic `lifecycle_transition` tool). Validate while status is still
      `analysis`, write approval, then transition — all in the one `set` branch.
- [ ] Write failing TS tests: `confirm=false` leaves status at `analysis` but
      keeps `REVIEW_N.md`; `!hasUI` does not auto-promote; `!isProjectTrusted()`
      does not auto-promote.
- [ ] Add `promoteWithSignoff(pi, ctx, project, reviewPath, reportHashPre)` in
      `extensions/beril-review.ts`; call it from both the panel and single
      branches *after* the post-review TOCTOU check, *before* the lifecycle set.
      Use `ctx.ui.confirm`, fail-closed on `!hasUI`/untrusted, pass the
      `sha256:`-prefixed raw-file hashes to the gated `set`.
- [ ] Verify `/submit` now works end-to-end (the approval block it requires is
      now written).

**Verify:** `env -u NO_COLOR bun test test/beril-review.test.ts`;
`uv run --group test pytest tests/test_cli_lifecycle_cmd.py -q`.

**Open decisions (defaults chosen; flag to override):** approval written *inline
on `set reviewed`* (not a separate `approve`); ORCID-must-match `## Authors` is a
SKILL expectation, not a hard block; projects already at `reviewed` from the old
silent path re-review to sign (document a `lifecycle approve` path if needed).

---

## Phase 2 — Calibrated trust: faithfulness vs groundedness (WS2: P0.3)

**Files:**
- Modify: `lib/science.ts`
- Modify: `lib/claim-state.ts`
- Modify: `lib/ui/science-cards.ts`
- Modify: `lib/review-preflight.ts`
- Modify: `skills/synthesize/SKILL.md`
- Test: `test/science.test.ts`
- Test: `test/claim-state.test.ts`

- [ ] Write failing pure-fn tests: `groundednessForEvidence` counts **distinct**
      re-runnable locators (two pointers with the same locator ⇒ single-source;
      two web/paper pointers ⇒ ungrounded, cannot reach high); `faithfulnessForPointer`
      passes when the claimed value appears in `pointer.exact`, else `unverified`.
- [ ] Add `groundednessForEvidence` + `faithfulnessForPointer` + `GroundednessTier`
      to `lib/science.ts` (pure, never-throwing; reuse `isResult` weighting).
- [ ] Add `ClaimStateRow.groundedness` + `tier_mismatch` (set when a claim writes
      `high`/`medium` but is single-source); round-trip in `claims.json`; extend
      `claimStateSummary` with `singleSource`/`tierMismatch` counts.
- [ ] Add `groundingFooter(theme, g)` — glyph+word, **never a number** — mirroring
      `confidenceFooter`; wire into `claimStateCard`/`evidenceCard`/`reviewPreflightCard`.
- [ ] Add a **warning (not blocker)** in `review-preflight` when a finding is
      high/medium but single-source, or `tier_mismatch` is set.
- [ ] Add groundedness/faithfulness judgment to `skills/synthesize/SKILL.md`
      ("high needs ≥2 *independent* artifacts — distinct notebooks/queries, not
      the same notebook twice; verify the cited number appears in the source").

**Verify:** `env -u NO_COLOR bun test test/science.test.ts test/claim-state.test.ts`.

**Open decisions (defaults):** single-source-high is a **warning** now (promote to
a submit blocker later once the eval shows low false-alarm rate); `tier_mismatch`
flags + shows the artifact-derived tier as orientation, never silently rewrites
`REPORT.md`; faithfulness is the pure `exact`-contains check only (stance wiring
deferred).

---

## Phase 3 — Investigation world model (WS3: P1.5, orientation fields only)

**Files:**
- Modify: `lib/session-state.ts`
- Create: `extensions/beril-world.ts`
- Modify: `extensions/beril-memory.ts`
- Modify: `extensions/beril-ideas.ts` (only the `/idea-tournament` hand-off note; full re-point is Phase 4)
- Test: `test/session-state.test.ts`
- Test: `test/beril-world.test.ts`
- Test: `tests/test_cli_session_state.py`

- [ ] Write failing tests: `buildSnapshot` clamps/bounds the new sections;
      `formatReinjection` includes open questions / dead ends and keeps the
      "orientation only, NOT established findings — re-verify" guard string.
- [ ] Extend `ResearchStateSnapshot` with bounded `question` (≤240),
      `openQuestions`, `assumptions`, `deadEnds` (≤8 each). **Do not add
      `findings[]`** — link to `claims.json` instead.
- [ ] Create `extensions/beril-world.ts`: a `world_model` read/update tool
      (`read` → `berilExec(['lifecycle','session-state',project,'--get'])` → card;
      `update` → merge agent-supplied sections, `--set`) + a `/world-model`
      command. Project-trust fail-closed; guard `renderResult` for `isError`;
      text-presentation glyphs only.
- [ ] Fix `beril-memory` `session_before_compact`: **read-modify-write merge** —
      `--get` current `research_state`, splice in the count/identifier core,
      **keep** the world-model sections, `--set`. (The Python `--set` replaces the
      whole block, so the merge must be in TS.)
- [ ] Write failing pytest: `session-state --set` round-trips the widened JSON,
      server-stamps `updated_at`, redacts a secret-named key, leaves `beril.yaml`
      untouched.

**Verify:** `env -u NO_COLOR bun test test/session-state.test.ts test/beril-world.test.ts`;
`uv run --group test pytest tests/test_cli_session_state.py -q`.

**Open decisions (defaults):** `world_model` lives in a **new `beril-world`**
extension (one concern per file); **no Python behavior change** (the verb already
persists the widened JSON); caps ≤8 per section / question ≤240.

---

## Phase 4 — Measurement + falsification (WS2 P1.6 + WS3 P1.4) — deferred, sketch

Gated on Phases 2–3. Specify fully before starting.

**P1.6 — reproducibility/trust eval (pytest/CI only):**
- [ ] `tests/test_reproduce.py` + a small `scripts/` helper: re-run a
      known-stable fixture notebook N times → identical canonical-JSON hashes;
      a known-flaky fixture → differing hashes (TP/FP). Reuse
      `tests/test_notebook_hash.py`'s drift corpus for the cosmetic-vs-real half.
- [ ] `test/science-eval.test.ts`: claim fixtures tagged stable/flaky → assert
      the tier correlates with reproducibility.
- [ ] (Defer the `beril reproduce` CLI subcommand until a product caller exists.)

**P1.4 — falsification-ranked hypothesis pass:**
- [ ] `lib/falsification-rank.ts`: pure ranker by **survival** (survived+result >
      survived+lit-only > unfalsified > refuted); "unfalsified" is never
      "survived"; tolerant of `[]`/garbled rows.
- [ ] `extensions/beril-world.ts` `/falsify-rank` command (thin): read competing
      hypotheses, mark un-executed ones `unfalsified`, reuse `/berdl-refute` (on
      request) + BERDL-gated `notebook_run`, write survival back to the world
      model, render a ranked card.
- [ ] `skills/falsify-rank/SKILL.md`: how to generate N competing explanations,
      derive a disconfirming check each, and rank by survival not novelty.
- [ ] Re-point `/idea-tournament` to hand off to `/falsify-rank` (keep
      approved-memory seeding).

---

## Phase 5 — Documentation: additions + differentiation from the original BERIL

**Files:**
- Create: `docs/beril-pi-vs-research-observatory.md`
- Read-only reference (NEVER import / depend on / modify):
  `/Users/g8k/.superset/projects/BERIL-research-observatory`

- [ ] Draft a **concise** doc (~1 page) in `docs/` that documents **(a) the
      additions from this plan** — WS1 trustworthy review gate, WS2
      faithfulness-vs-groundedness trust split, WS3 investigation world model
      (and the Phase-4 eval + falsification pass) — **and (b) what makes
      beril-pi-agent different** from the original BERIL Research Observatory.
- [ ] State the relationship + **standalone invariant**: beril-pi-agent is a
      self-contained Pi package that *replaces* the original's Claude Code / Codex
      skill layer and *bundles its own* BERDL execution substrate; it must never
      import, depend on, or modify the original repo at runtime (read it
      read-only, for this doc only — see the `beril-pi-agent-standalone` memory).
- [ ] Cover the differentiators concisely: terminal/TUI artifact-"science cards"
      surface; calibrated trust **computed, not verbalized** (now split into
      faithfulness vs groundedness); **disconfirmation-first** review/refute with
      a human ORCID-bound sign-off gate; reproducibility hashing + ORCID-gated
      submission; provenance/`TRACE.jsonl` auditability; **free + keyless,
      nothing third-party in a core path**; map-not-lock advisory arc.
- [ ] Keep it concise; **link** to this design spec and the
      `coscientist-landscape-positioning` memory rather than duplicating them.
- [ ] Draft once Phase 3 lands; append the Phase-4 additions when they land.

**Verify:** doc is ≤ ~1.5 pages, every claim about the original is grounded in a
read-only inspection, and no runtime dependency on the original repo is
introduced (the standalone invariant holds).

---

## Final verification (each phase)

- [ ] Touched-lane targeted tests green.
- [ ] `env -u NO_COLOR bun run check` (tsc + biome).
- [ ] `env -u NO_COLOR bun run test` (node --test).
- [ ] `uv run --group test pytest tests`.
- [ ] `git status --short --branch` + `git diff --stat` reviewed; every changed
      line traces to a deliverable.
