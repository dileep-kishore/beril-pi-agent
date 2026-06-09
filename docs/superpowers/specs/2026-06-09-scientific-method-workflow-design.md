# Scientific-Method Workflow Update — Design Spec

**Date:** 2026-06-09
**Branch:** `feat/scientific-method`
**Status:** Approved for implementation (descoped to the terminal-native workflow; see Non-Goals)

## 1. Problem

beril carries a working scientist through a linear arc — `explore → plan → analyze →
synthesize → review → submit` — and has solid plumbing for its three pillars (BERDL
Spark SQL, Jupyter notebooks with a canonical hash, PubMed literature). But the
**scientific method is only half-encoded, as prose conventions the model can skip.**

The KBase co-scientist workshop (38 scientists) found the #1 problem is **calibrated
trust**: the agent is "confidently wrong" with no hedging, and users rarely verify its
claims. The corpus confirms the mechanism — across 65 reports only ~6 record *any*
refuting evidence, and 0 of 65 plans frame a rival hypothesis. The skills genuinely
have nowhere to put skepticism: feasibility is a soft instruction, confidence is prose,
"supporting vs refuting" is unstructured, and falsification is never asked for.

## 2. Goal

Make beril encode the scientific method and **lead with calibrated trust**, by upgrading
each seam of the existing arc. The guiding policy (from a verified survey of AI
co-scientist systems — Google AI co-scientist, FutureHouse, Flywheel, the autonomous-
discovery post-mortems, and the calibration/provenance literature):

- **Generate cheaply, verify expensively.** Spend more turns checking a claim against
  BERDL data + PubMed than producing it.
- **No empirical claim ships without a re-runnable artifact and its verbatim source.**
- **Refuting evidence is rare → hunt it actively.** "refutes" is a first-class slot;
  "needs-evidence" is an honest outcome, not a failure.
- **Confidence is computed from artifact type, never a verbalized number.**
- **The human is the verifier-of-record.** Clarifying questions and reversible
  checkpoints are core, gated by expected information gain to avoid alert fatigue.

## 3. Non-Goals (explicitly out of scope here)

The production durable-knowledge layer — the **OpenViking context layer**, the **KG**
(`StatementCard`s), and the **wiki** — is assumed to be implemented/integrated **later**.
This spec **does not** build any of it:

- No `beril knowledge` bridge, no `openviking` client, no statement emission/push.
- No reading prior cross-project knowledge as planning context.
- No cross-project conflict detection.

Everything below is **self-contained in the terminal Pi agent** and ships with no external
service. We only ensure **forward-compatibility** (§7): the vocabulary, confidence, and
provenance shapes are chosen so the later KG integration is a thin mapping, not a rework.

## 4. Principles & invariants (do not violate)

- Scientific **judgment** lives in `skills/*` (markdown SKILL.md); **execution / UI /
  state** live in `extensions/*` + `lib/*`.
- The canonical notebook hash (`tools/notebook_hash.py`) and Spark/MinIO access stay in
  **Python**. The `beril-safety` destructive-op gate is **untouched**.
- Every new/edited `renderResult` guards the Pi error contract: on failure Pi calls
  `renderResult` with `details = {}` and `context.isError = true` → render `errorCard`,
  never "undefined".
- The conduct contract (`lib/conduct.ts`) is injected every turn; keep additions to 1–2
  load-bearing sentences so the few directives that matter aren't diluted.
- Surgical changes only; match existing patterns (`registerTool` → wrap CLI / pure helper
  → render a card). No speculative abstraction.

## 5. Shared data shapes (the small, forward-compatible core)

Two controlled enums + one evidence pointer, defined once in a new `lib/science.ts` and
reused across cards and skills.

```ts
// lib/science.ts
/** Per-CLAIM status — a separate axis from the project lifecycle states. */
export type ClaimStatus =
  | "open" | "supported" | "refuted" | "needs-replication" | "blocked" | "needs-evidence";

/** Confidence is COMPUTED from the strongest artifact behind a claim, never verbalized. */
export type ConfidenceTier = "high" | "medium" | "low";

/** A typed, re-openable pointer to the artifact behind a claim. */
export interface EvidencePointer {
  kind: "query" | "notebook" | "figure" | "paper";
  /** notebook path (+ optional `#cell-N`), figure path, query hash, or PMID/DOI. */
  locator: string;
  /** The exact, verbatim source sentence/number this claim rests on. */
  exact: string;
  /** One-line why-this-matters. */
  relevance: string;
}

/** Map artifact strength → tier (deterministic; no model judgment). */
export function tierForEvidence(supports: EvidencePointer[]): ConfidenceTier;
```

`tierForEvidence` rule (pure, unit-tested):
- `high` — a replicated/held-out result, or ≥2 independent artifact-backed supports.
- `medium` — a single re-runnable query/notebook result, or one result + a resolving PMID.
- `low` — literature-only, or an assertion with no artifact (→ status `needs-evidence`).

These names mirror the future KG (`StatementCard.tier`/`confidence`/`links`/`evidence`)
so a later emitter is a read-off, not a redesign (§7). They are used **in-session and in
the rendered markdown only** — nothing is persisted to a new store.

## 6. Design, seam by seam

### 6.1 Question & plan seam — `/berdl-start`, `/research-plan`

**Feasibility gate → real tool.** Add a `berdl_feasibility` tool in `extensions/beril-data.ts`:
```
berdl_feasibility(question: string, tables?: string[]) ->
  { verdict: "answerable" | "partial" | "not-answerable",
    blockers: string[], opportunities: string[],
    checked: { table: string, column?: string, coverage?: number }[] }
```
It runs **cheap** probes only (column existence, non-null coverage %, a bounded sample via
the existing `berdl_query`/`berdl_peek` substrate — no full scans), and renders a
`feasibilityCard`. `extensions/beril-plan.ts` calls it **after** clarifying questions and
**before** drafting the plan; a `not-answerable` verdict surfaces "here is the closest
answerable question" as a first-class response. *Judgment* (what counts as answerable)
stays in `skills/research-plan/SKILL.md`; *probe execution* is in the extension/CLI.

**Clarifying questions (info-gain gated).** A clarifying step in the `/research-plan`
flow asks 2–3 structured, multiple-choice questions grounded in real `berdl_peek` values
(the question in 1–2 sentences; which tables; what a successful answer looks like) before
the skill drafts the plan. Skill prose applies an **Expected-Information-Gain** heuristic:
only interrupt when resolving the ambiguity would change the query/result; otherwise
auto-resolve and **state the assumption**. The chosen answers appear in the plan's context.

**Competing hypotheses + falsification + confidence prior.** Edit
`skills/research-plan/SKILL.md` to add, after the `H0/H1` block: a **Competing Hypotheses**
section (2–3 rivals `H2/H3` phrased so available BERDL data could *distinguish* them, plus
a discrimination strategy); a per-hypothesis **Falsification test** ("what single
query/figure result would refute this?"); and a **Confidence prior** (HIGH/MED/LOW + why,
to be compared against the posterior at synthesis). The agent drafts these *before* asking
the scientist's preference.

### 6.2 Analysis seam — `/analyze`, `analysis-notebooks`

**Refute-first ordering.** Edit `skills/analysis-notebooks/SKILL.md` so the
discriminating / falsifying test runs **before** confirmatory cells, and the skill records
"did this actively seek data that would refute the hypothesis, or only affirm it?".

**Per-result confidence + scope.** Each notebook result carries a computed
`ConfidenceTier` (via `tierForEvidence`) and a scope bound ("in these N samples / under
filter X"); the notebook path is the **evidence anchor** (`EvidencePointer.kind:notebook`).

### 6.3 Synthesis seam — `/synthesize` (the core leverage point)

**Supports-vs-refutes with verbatim provenance.** Add an `evidenceCard` to
`lib/ui/science-cards.ts` rendering `{ claim, status, confidence, supports[], refutes[],
unresolved[] }`, each item an `EvidencePointer`. **`refutes` is a mandatory, separately
rendered slot** that defaults to "none found — searched X" when empty. Edit
`skills/synthesize/SKILL.md` so each Key Finding: carries an inline `ConfidenceTier` +
scope bound + caveat; cites the **exact verbatim source sentence/number** for every claim;
and shows raw evidence *before* the interpretation. Block templated placeholders and any
number not traceable to a query/notebook result.

**Evidence tally + assumptions ledger.** Pass-2 of `synthesize` produces an evidence tally
(strong-support / weak-support / neutral / refuting → `supported-with-caveats` vs
`H0-not-rejected` vs `mixed`) and an **"Assumptions & Caveats"** REPORT.md section recording
which research-plan assumptions held vs broke (compared against the confidence prior).

**Active refutation pass — `/berdl-refute`** (the key new mechanism). Add
`extensions/beril-refute.ts`, closely mirroring `extensions/beril-review.ts`: it reuses
`runReviewSubagent` (`lib/review-agent.ts`, isolated read-only Opus 4.8 session, model
falls back to `ctx.model`) with a new `REFUTATION_RUBRIC` in `lib/review-rubric.ts`. Per
Key Finding the subagent (a) proposes/describes one **disconfirming BERDL query** and (b)
hunts one **contradicting paper**, then writes a `## Refutation Pass` section into a numbered
`REFUTATION_N.md` (and the agent lifts the results into REPORT.md's refutes slots). It
**records what was attempted** so the *absence* of skepticism is visible. It does **not**
advance the lifecycle and does **not** touch the safety gate. Falsification/critique on the
strongest model is deliberate (weak models have high Type-I error).

### 6.4 Literature (woven through plan + synthesis)

**Abstracts + zero-shot stance/abstention.** Extend `lib/lit.ts` with an efetch abstract
fetch (`rettype=abstract`) reusing the existing paced-request / 429-backoff gate. Add a
zero-shot **stance** pass in `extensions/beril-literature.ts` (in-process `complete()`,
reusing the `expandQueries` model-fallback pattern) returning `{ stance:
"supports"|"refutes"|"NEI", confidence, exact_quote, qualifiers }` for top-N papers vs a
hypothesis. "insufficient evidence in the retrieved set" (NEI) is a first-class output.

**Verify-on-write citations.** A gate so any PMID/DOI is resolved via `lit_fetch` **before**
it lands in `references.md`/`REPORT.md`; a major metadata mismatch is flagged as probable
fabrication (fuzzy match + human-confirm for borderline; hard-block only on major mismatch).

### 6.5 Review seam — `/berdl-review`

Edit `lib/review-rubric.ts`:
- **PROJECT_REVIEW_RUBRIC** — add a **Confidence assessment / anti-overexcitement**
  subsection: flag tone-exceeds-evidence, unsupported superlatives, and violated/un-caveated
  assumptions. Add an **empty-refutes lint**: if a finding's Interpretation/Limitations prose
  names a confounder/contradiction while its refutes slot is empty, flag "possible refutation
  not lifted — re-synthesize."
- **PLAN_REVIEW_RUBRIC** — add a **Competing hypotheses** point: flag single-hypothesis
  plans; nudge a rival + a discriminating test.

Mirror these in `skills/berdl-review/SKILL.md` (the human-facing rubric source).

### 6.6 Always-on

**Conduct directive + controlled vocabulary.** Append to `CONDUCT_CONTRACT`
(`lib/conduct.ts`) one directive: *"Every empirical claim needs a re-runnable artifact
reference (a notebook cell, a query, or a PMID) and its exact source sentence; surface
refuting evidence in its own slot; 'needs-evidence' is an honest outcome, not a failure."*
Introduce the per-claim status vocabulary `{open, supported, refuted, needs-replication,
blocked, needs-evidence}` (a **per-claim axis, separate** from the lifecycle states) in the
contract and in the synthesize/research-plan skills.

**Session evidence-ledger card.** Add a read-only `claim_ledger` tool (in
`extensions/beril-governance.ts`) + card rendering a `Status | Confidence | Supports |
Refutes | Stale?` table, parsed **at render time** from the project's `RESEARCH_PLAN.md` /
`REPORT.md` (reusing `lib/ui/table.ts` + `lib/ui/glyphs.ts`). It **persists nothing** (cannot
drift). Staleness compares a finding's notebook against its recorded hash where available;
otherwise omitted. The always-visible (often empty) Refutes column makes missing skepticism
glaring.

## 7. Forward-compatibility with the future KG (design alignment only — not built here)

These cost nothing now and make the eventual OpenViking/`StatementCard` integration a thin
mapping:

| This spec (in-session / markdown) | Future KG `StatementCard` field |
|---|---|
| `ClaimStatus` vocabulary | `tier` / status |
| `ConfidenceTier` | `confidence` |
| `evidenceCard.supports` / `.refutes` | `links.supports` / `links.contradicts` |
| `EvidencePointer.exact` (verbatim) | `evidence.exact` (verbatim — already required there) |
| `EvidencePointer{notebook,figure,query,paper}` | `evidence.{notebook,figure,p_value,source}` |
| competing hypotheses / falsification | `kind: hypothesis` + `requires_validation` |

When the bridge is added later, "emit a StatementCard" reads off what `synthesize` already
produced — no behavioral change.

## 8. Testing strategy

- **Pure logic (Python + TS):** `tierForEvidence` table; the feasibility verdict on a
  fixture with a sparse/absent column; the verify-on-write resolver on a bad PMID.
- **Card rendering (TS, `node --test`):** `evidenceCard`/`feasibilityCard`/`claim_ledger`
  render without throwing on populated **and** empty slots, and guard the Pi error contract
  (`context.isError` → `errorCard`).
- **Extension wiring (TS):** `/berdl-refute` parses args, reuses the injectable subagent
  seam (`__reviewSubagent`-style) so tests run without a live LLM; `berdl_feasibility`
  payload is byte-stable.
- **Skill changes** are prose; covered by the rubric/review and by manual smoke on 1–2 real
  projects.
- Gate every wave on `bun run check` (tsc + biome) + `bun run test` + `uv run --group test
  pytest tests/ -q`.

## 9. Risks & mitigations

- **Alert fatigue** (clarifying Qs + checkpoints + footers + cards firing too often) →
  EIG-gate questions, reserve checkpoints for redirect-worthy seams, render confidence as
  quiet dim footers, full evidence cards only for high-stakes findings.
- **The refutation pass can't *force* genuine disconfirmation** — only make its absence
  visible. A lazy pass yields shallow refutes rows that look rigorous; the structure refuses
  to *hide* this (empty-refutes lint). Document the limit honestly.
- **Zero-shot stance/feasibility labels are themselves fallible** → render as the agent's
  claim + the verbatim source, default to `needs-evidence` when thin, never present a
  self-label as ground truth.
- **Touching shared surfaces** (`conduct.ts` every turn; `science-cards` `renderResult`) →
  keep contract additions to 1–2 sentences; guard `context.isError` in every renderer.
- **Cost/latency of verify-expensively** (extra efetch round-trips, the refute subagent) →
  pace through the existing rate-limit gate; reserve `/berdl-refute` for synthesis-time and
  high-stakes findings.

## 10. Sequencing (waves)

- **Wave 1 — prose + rubric (cheap, biggest calibrated-trust win):** `lib/science.ts`
  vocab; conduct directive; competing hypotheses + falsification + confidence prior in
  `research-plan`; supports/refutes + verbatim quotes + evidence tally + assumptions ledger
  in `synthesize`; review-rubric additions (anti-overexcitement, empty-refutes lint,
  competing-hypotheses plan check) + the mirrored `berdl-review` skill.
- **Wave 2 — the mechanisms:** `/berdl-refute` + `REFUTATION_RUBRIC`; `berdl_feasibility`
  tool + `feasibilityCard`; `evidenceCard` + confidence footers in `lib/ui`; literature
  abstracts + stance + verify-on-write.
- **Wave 3 — flow polish:** clarifying-questions step; refute-first notebook ordering;
  `claim_ledger` card; suggest-research competing-hypotheses criterion.

Each wave is committed independently after its checks pass.
