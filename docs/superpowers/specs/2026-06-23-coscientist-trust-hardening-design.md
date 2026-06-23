# Co-scientist trust, review, and investigation-state hardening — design

Status: planned

## Intent

Translate the co-scientist landscape research (2026-06-23; see the team memory
`coscientist-landscape-positioning`) into beril's current Pi architecture. Six
recommendations — three P0, three P1 — that make the review gate trustworthy,
split and surface calibrated trust into *faithfulness* vs *groundedness*, and
give long investigations a coherent local state. They are combined into **three
workstreams** that land on **three state planes that already exist** — no new
store, no new subagent.

The standing priority is unchanged: fit/robustness > minimal code > no required
paid API. Confidence stays **computed, never verbalized**; irreversible actions
stay gated; nothing third-party enters a core path.

## Motivating discoveries (current tree, verified during design)

These reorder the priorities and make WS1 the highest-leverage starting point:

1. **`/berdl-review` auto-advances `analysis → reviewed` with no human input,
   even headless** (`extensions/beril-review.ts:194,233`). That is an
   AI-reviews-AI gate — exactly the failure mode BadScientist / Beel et al.
   document.
2. **`/submit` is currently non-functional.** `beril_cli/submit_cmd.py:32`
   requires an `approval` block that nothing ever writes; the
   `approve` / `_validate_approval` machinery is **dead code**. WS1 activates it.
3. **The independent reviewer cannot see results.** The rubric tells the
   read-only subagent to read notebook cell *source* but explicitly *skip*
   outputs (`lib/review-rubric.ts`), so it never sees the metrics / split sizes /
   class balances needed to detect data leakage or metric misuse.

## Prioritization

### Workstream 1 — Trustworthy review gate (P0.1 + P0.2)

- **Problem:** the review step both (a) can't see the evidence needed to catch
  the most common silent failures and (b) advances the lifecycle with no human
  accountability.
- **Pi-native home:** judgment → the reviewer **rubric** (the subagent's system
  prompt) + the human-facing **skill**; the gate → the **authoritative Python
  state machine**; the human seam → a **thin extension confirm**.
- **Deliverables:**
  - Add a `Data leakage & evaluation integrity` rubric clause naming the four
    Luo/Kasirzadeh/Shah silent failure modes — inappropriate benchmark/dataset
    selection, **data leakage** (train/test contamination, target/feature/group
    leakage, look-ahead), metric misuse (wrong metric, accuracy on imbalanced
    data, multiple-comparison/p-hacking, reporting on the eval set), and post-hoc
    / test-set selection bias — to `PROJECT_REVIEW_RUBRIC`, the panel
    `STATS_REVIEW_RUBRIC`, and `skills/berdl-review/SKILL.md`.
  - Change the "focus on cell `source`, skip outputs" steer to "**read** cell
    outputs that report metrics, split sizes, class balances" so the reviewer
    sees logs+code (their result: detection rises 51%→74% only with logs+code).
  - Tell the reviewer to also read `claims.json` (WS2 groundedness) and the
    `research_state` world-model section (WS3) — **one rubric bullet** is the
    entire cross-workstream integration.
  - Make `analysis → reviewed` require an explicit **human, ORCID-bound
    sign-off**, enforced in the Python state machine (so the generic
    `lifecycle_transition` tool cannot bypass it). AI review stays **advisory**;
    fail-closed on `!hasUI`/untrusted; preserve the report-hash TOCTOU guard; the
    human signs off on the exact reviewed report.

### Workstream 2 — Calibrated trust, measured (P0.3 + P1.6)

- **Problem:** trust is a single principled tier (`high = ≥2 re-runnable
  results`) that conflates "the source supports the claim" with "there is enough
  independent evidence," and is asserted rather than measured.
- **Pi-native home:** pure computation + types → `lib/science.ts` /
  `lib/claim-state.ts`; rendering → the science **cards**; judgment →
  `skills/synthesize`; measurement → a **Python eval** (substrate).
- **Deliverables (P0.3, near-term):**
  - `groundednessForEvidence(supports)` (counts **distinct** independent
    re-runnable sources; reuses `isResult` so web/lit cannot masquerade as
    results) and `faithfulnessForPointer(pointer)` (does the claimed number/sentence
    appear in the pointer's `exact`) beside `tierForEvidence` in `lib/science.ts`.
  - `ClaimStateRow.groundedness` + a `tier_mismatch` flag persisted in
    `claims.json`; surfaced as a **glyph+word footer, never a number** (mirrors
    `confidenceFooter`); a **warning, not a blocker** in `review-preflight`.
- **Deliverables (P1.6, Phase 4):**
  - A CORE-Bench-style eval **as pytest / CI only** (no user-facing command in
    v1): validate that `high ⇒ reproducible` (re-run a fixture notebook N times,
    compare canonical-JSON hashes) and that the reproducibility hash catches real
    content drift while ignoring autosave (TP/FP). The drift half largely reuses
    the existing `tests/test_notebook_hash.py` corpus.

### Workstream 3 — Investigation state + falsification-first hypotheses (P1.5 + P1.4)

- **Problem:** long arcs lose coherence (Kosmos: coherence degrades after limited
  actions), and beril has no falsification-first way to adjudicate competing
  explanations (Google/Sakana rank by persuasion; the Ideation-Execution Gap
  shows idea-stage ranking is misleading).
- **Pi-native home:** state shape → `lib/session-state.ts` (extends the existing
  `research_state` block in `provenance.json`); surface → a **new `beril-world`
  extension** (tool + command + card); compaction → the `beril-memory`
  **event hook**; the ranker → a **pure lib**; the protocol → a **skill**.
- **Deliverables (P1.5, near-term):**
  - Extend `ResearchStateSnapshot` with bounded `question`, `openQuestions`,
    `assumptions`, `deadEnds`. A `world_model` read/update tool + `/world-model`
    card in `extensions/beril-world.ts`.
  - `beril-memory` must **read-modify-write merge** the world-model sections at
    `session_before_compact` (because the Python `session-state --set` *replaces*
    the whole `research_state` block — the merge must happen in TS or compaction
    clobbers it).
- **Deliverables (P1.4, Phase 4):**
  - `lib/falsification-rank.ts` (pure ranker by **survival** of a disconfirming
    check; "unfalsified" never ranks as "survived"); `/falsify-rank` command +
    `skills/falsify-rank/SKILL.md`; reuse the existing `/berdl-refute` subagent
    and the BERDL-gated `notebook_run` execution; `/idea-tournament` hands off.

## Shared-state design (no new store)

The three workstreams map onto three planes that already exist, preserving the
authority hierarchy. This is the key to combining them without overlap:

| Plane | Authority | Receives |
| --- | --- | --- |
| `beril.yaml:approval` | authoritative | WS1 human ORCID sign-off record |
| `claims.json` (claim ledger) | gate-validated | WS2 per-claim `groundedness` / `faithfulness` / `tier_mismatch` |
| `provenance.json:research_state` | non-authoritative | WS3 world model (question / open-Qs / assumptions / dead-ends / hypotheses) |

The single cross-link: WS1's reviewer **reads** `claims.json` and the world-model
section (a prompt change). WS1's sign-off is authoritative state and stays in
`beril.yaml` — never in the non-authoritative world model.

## Construct placement

| Need | Pi-native construct | Reason |
| --- | --- | --- |
| reviewer judgment (failure-mode rubric, read-outputs steer) | rubric string + `skills/berdl-review` | judgment, and the rubric *is* the subagent's system prompt |
| non-bypassable review gate | Python lifecycle state machine | only the CLI gate survives the generic `lifecycle_transition` tool |
| human sign-off seam | extension `ctx.ui.confirm` (fail-closed `!hasUI`) | the existing confirmation primitive used by `/submit` and the safety gate |
| trust computation (groundedness/faithfulness) | `lib/science.ts` pure functions | the calibrated-trust home; deterministic, testable without a model |
| trust display | science cards (glyph+word footer) | keeps confidence computed-not-verbalized |
| reproducibility/trust measurement | Python eval (pytest/CI) | substrate; deterministic; no product surface needed in v1 |
| investigation orientation state | `provenance.json:research_state` via the existing `session-state` verb | non-authoritative, local, keyless; survives sessions |
| world-model surface | new `beril-world` extension (tool + command + card) | one concern per file |
| falsification ranking | pure `lib/falsification-rank.ts` + skill + thin command; reuse `/berdl-refute` | judgment in the skill, ranking is pure, **no new subagent** |

## Explicit non-goals / cuts (first iteration)

- **No new persistent store and no new subagent.** All three workstreams reuse
  the existing isolated read-only review/refute subagent and the three existing
  state planes.
- **Cut WS3 `findings[]`** — it would re-derive tiers that already live in
  `claims.json`, recreating the store-overlap this design avoids. The world model
  *links* to `claim_id`s instead.
- **Defer the `beril reproduce` CLI subcommand** — P1.6 is a measurement; build
  it as pytest first; add a product command only if a caller appears.
- **Do not extend `stamp_execution`** with `run_id`/`wall_time` — nothing
  consumes it.
- **Defer faithfulness stance wiring** (`lit_stance` → `EvidencePointer`); ship
  the pure `exact`-contains faithfulness check only.
- **Defer P1.6 (eval) and P1.4 (falsification pass) to Phase 4.**

## Risk controls

- Confidence and groundedness are **computed, never verbalized** — every tier
  comes from `lib/science.ts`; cards render a glyph+word footer, never a number.
  `tier_mismatch` is surfaced as a word ("single-source"), never as a competing
  numeric readout.
- AI review is **advisory**; the `analysis → reviewed` transition is gated on a
  human ORCID sign-off, enforced in the authoritative state machine and
  **fail-closed headless/untrusted**. The report-hash TOCTOU guard is preserved.
- The **two SHA-256 primitives stay distinct**: raw-file hash for the approval /
  TOCTOU integrity; canonical-JSON hash for reproducibility. The world model
  stores no report fingerprint.
- The world model lives **only in `provenance.json` (non-authoritative)**;
  `beril.yaml` stays the sole lifecycle authority and `claims.json` the sole
  transition-gating ledger. The world model never gates a transition.
- The falsification pass executes **only** through the existing BERDL-gated
  `notebook_run` path; the `world_model` tool is non-destructive and
  project-trust fail-closed. No new dependency; nothing third-party in a core
  path. Strip-safe TS throughout; every new `renderResult` guards `isError`.

## Documentation

A concise `docs/beril-pi-vs-research-observatory.md` (~1 page) documents both the
additions in this design and **what makes beril-pi-agent different** from the
original BERIL Research Observatory — the self-contained Pi/TUI co-scientist that
*replaces* the original's Claude Code / Codex skill layer and bundles its own
BERDL substrate (the `beril-pi-agent-standalone` invariant: never import, depend
on, or modify the original at runtime). It frames the trust-hardening here as
advancing beril's distinctive, field-validated stance (computed calibrated trust,
disconfirmation-first review, reproducibility + ORCID gating, keyless). See plan
Phase 5; the original repo is read **read-only**, for the doc only.

## Verification

- Focused TS tests (`node --test`): review sign-off (confirm=false / headless /
  untrusted), the leakage rubric clause, `groundednessForEvidence` /
  `faithfulnessForPointer`, `claim-state` groundedness rollup + `tier_mismatch`,
  `session-state` world-model shape + re-injection, the `beril-world` tool, and
  (Phase 4) the pure falsification ranker.
- Focused Python tests (`pytest`): the `set analysis→reviewed` sign-off gate
  (refuses bare promote; writes the approval block with valid flags), the
  world-model JSON round-trip through `session-state`, and (Phase 4) the
  reproduce/TP-FP eval.
- Full suite: `env -u NO_COLOR bun run check`, `env -u NO_COLOR bun run test`,
  `uv run --group test pytest tests`.
