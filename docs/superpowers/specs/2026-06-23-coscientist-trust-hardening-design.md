# Co-scientist trust, review, and investigation-state hardening — design

Status: planned

## Intent

Translate the co-scientist landscape research (2026-06-23; see the team memory
`coscientist-landscape-positioning`) into beril's current Pi architecture. Six
recommendations that make the review gate trustworthy, add a *groundedness* axis
to calibrated trust, and give long investigations a coherent local state. They
are combined into **three workstreams** that land on **three state planes that
already exist** — no new store, no new subagent.

The workflow stays **deliberately lean**: exactly one new hard gate (the human
ORCID sign-off), everything else advisory. We do not keep checking things that
don't change a conclusion, and we never re-run notebooks (see the Reproducibility
principle under WS2).

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

### Workstream 2 — Calibrated trust: a groundedness axis (P0.3)

- **Problem:** trust is a single principled tier (`high = ≥2 re-runnable
  results`) that conflates "the source supports the claim" with "there is enough
  independent evidence."
- **Pi-native home:** pure computation + types → `lib/science.ts` /
  `lib/claim-state.ts`; rendering → the science **cards** (only when it adds
  signal); judgment → `skills/synthesize`.
- **Deliverables (P0.3, near-term):**
  - `groundednessForEvidence(supports)` — counts **distinct** independent
    re-runnable sources (reuses `isResult`, so it is keyed to the *count of
    distinct artifacts*, never to the values/bytes/hashes of stochastic outputs).
  - `ClaimStateRow.groundedness` + a `tier_mismatch` flag in `claims.json`,
    surfaced **once, where it matters** — a single advisory line at the
    `review-preflight` seam (a **warning, not a blocker**), and a grounding word
    on a claim card **only when it disagrees with the written tier**. Computed,
    never verbalized.

> **Reproducibility (the governing principle).** Reproducibility is captured by
> the analysis notebook together with its saved outputs — the notebook **is** the
> reproducible record. beril does **not** re-run notebooks to "prove"
> reproducibility, and byte/output/canonical-hash equality is explicitly **not** a
> reproducibility or trust signal (a stochastic analysis changes numbers without
> changing the conclusion). The canonical-JSON notebook hash survives **only** as
> the artifact-integrity / TOCTOU check at the approval gate ("was the reviewed
> notebook/report edited after sign-off?"), alongside the raw-file report hash.
> There is no reproducibility eval, no `beril reproduce` command, no re-execution.

### Workstream 3 — Investigation state + falsification-first hypotheses (P1.5 + P1.4)

- **Problem:** long arcs lose coherence (Kosmos: coherence degrades after limited
  actions), and beril has no falsification-first way to adjudicate competing
  explanations (Google/Sakana rank by persuasion; the Ideation-Execution Gap
  shows idea-stage ranking is misleading).
- **Pi-native home:** state shape → `lib/session-state.ts` (extends the existing
  `research_state` block in `provenance.json`); surface → a **new `beril-world`
  extension** (tool + command + card); compaction → the `beril-memory`
  **event hook**.
- **Deliverables (P1.5, near-term):**
  - Extend `ResearchStateSnapshot` with bounded `question`, `openQuestions`,
    `assumptions`, `deadEnds`. A `world_model` read/update tool + `/world-model`
    card in `extensions/beril-world.ts`.
  - `beril-memory` must **read-modify-write merge** the world-model sections at
    `session_before_compact` (because the Python `session-state --set` *replaces*
    the whole `research_state` block — the merge must happen in TS or compaction
    clobbers it).
- **Deliverables (P1.4, Phase 4 — light touch):**
  - `/berdl-refute` **already** runs the disconfirming checks (BERDL-gated
    `notebook_run`), writes `REFUTATION_N.md`, extracts surviving checks, and
    feeds them into finding status. P1.4 is therefore **one guidance paragraph**,
    not new machinery: in the `berdl-review` (refute) skill + the `synthesize`
    finding-status tagging, instruct "rank competing explanations by **survival**
    of a disconfirming check; an unfalsified hypothesis is **not** a survived one;
    never rank by idea-stage novelty." **No** new command, skill file, `lib`
    ranker, or `/idea-tournament` re-point — revisit a dedicated surface only if a
    user actually needs to compare 3+ live hypotheses.

## Shared-state design (no new store)

The three workstreams map onto three planes that already exist, preserving the
authority hierarchy. This is the key to combining them without overlap:

| Plane | Authority | Receives |
| --- | --- | --- |
| `beril.yaml:approval` | authoritative | WS1 human ORCID sign-off record |
| `claims.json` (claim ledger) | gate-validated | WS2 per-claim `groundedness` / `tier_mismatch` |
| `provenance.json:research_state` | non-authoritative | WS3 world model (question / open-Qs / assumptions / dead-ends) |

The single cross-link: WS1's reviewer **reads** `claims.json` and the world-model
section (a prompt change). WS1's sign-off is authoritative state and stays in
`beril.yaml` — never in the non-authoritative world model.

## Construct placement

| Need | Pi-native construct | Reason |
| --- | --- | --- |
| reviewer judgment (failure-mode rubric, read-outputs steer) | rubric string + `skills/berdl-review` | judgment, and the rubric *is* the subagent's system prompt |
| non-bypassable review gate | Python lifecycle state machine | only the CLI gate survives the generic `lifecycle_transition` tool |
| human sign-off seam | extension `ctx.ui.confirm` (fail-closed `!hasUI`) | the existing confirmation primitive used by `/submit` and the safety gate |
| trust computation (groundedness) | `lib/science.ts` pure functions | the calibrated-trust home; deterministic, testable without a model |
| trust display | science cards (glyph+word footer, only when it adds signal) | keeps confidence computed-not-verbalized |
| investigation orientation state | `provenance.json:research_state` via the existing `session-state` verb | non-authoritative, local, keyless; survives sessions |
| world-model surface | new `beril-world` extension (tool + command + card) | one concern per file |
| falsification guidance | one paragraph in the refute + synthesize skills (reusing `/berdl-refute`) | the disconfirming work already exists; no new command/skill/ranker |

## Explicit non-goals / cuts (first iteration)

- **No new persistent store and no new subagent.** All three workstreams reuse
  the existing isolated read-only review/refute subagent and the three existing
  state planes.
- **Cut WS3 `findings[]`** — it would re-derive tiers that already live in
  `claims.json`, recreating the store-overlap this design avoids. The world model
  *links* to `claim_id`s instead.
- **Cut the reproducibility eval entirely (P1.6).** No re-running notebooks, no
  `beril reproduce` command, no byte/canonical-hash reproducibility metric — the
  notebook + its saved outputs *is* the reproducible record (see the
  Reproducibility principle under WS2). The canonical-JSON hash stays only as the
  integrity check at the approval gate.
- **Do not extend `stamp_execution`** with `run_id`/`wall_time` — nothing
  consumes it.
- **Drop `faithfulnessForPointer`** — an unwired pure function + type + tests; the
  `synthesize` skill already asks the agent to verify a cited value appears in its
  source. Lean on the prose.
- **P1.4 (Phase 4) is guidance only**, not a new command / skill / ranker (above).

## Risk controls

- Confidence and groundedness are **computed, never verbalized** — every tier
  comes from `lib/science.ts`; cards render a glyph+word footer, never a number.
  `tier_mismatch` is surfaced as a word ("single-source"), never as a competing
  numeric readout.
- AI review is **advisory**; the `analysis → reviewed` transition is gated on a
  human ORCID sign-off, enforced in the authoritative state machine and
  **fail-closed headless/untrusted**. The report-hash TOCTOU guard is preserved.
- The **two SHA-256 primitives stay distinct, and both are *integrity* checks,
  not reproducibility metrics**: the raw-file hash gates the approval (TOCTOU);
  the canonical-JSON hash detects content drift in a notebook/report at the gate
  ("edited after sign-off?"). Neither is re-run; neither feeds a trust tier. The
  world model stores no report fingerprint.
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
disconfirmation-first review, the notebook-as-record + ORCID gating, keyless). It
is **decoupled** from this plan's completion — it can ship anytime, independent of
the trust work. See plan Phase 5; the original repo is read **read-only**, for the
doc only.

## Verification

- Focused TS tests (`node --test`): review sign-off (confirm=false / headless /
  untrusted), the leakage rubric clause, `groundednessForEvidence`, `claim-state`
  groundedness rollup + `tier_mismatch`, `session-state` world-model shape +
  re-injection, and the `beril-world` tool.
- Focused Python tests (`pytest`): the `set analysis→reviewed` sign-off gate
  (refuses bare promote; writes the approval block with valid flags) and the
  world-model JSON round-trip through `session-state`.
- Full suite: `env -u NO_COLOR bun run check`, `env -u NO_COLOR bun run test`,
  `uv run --group test pytest tests`.
