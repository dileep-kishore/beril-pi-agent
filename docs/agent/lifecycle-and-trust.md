# Lifecycle, trust, and research records

Update this page with changes to lifecycle, gates, claim/evidence semantics,
review, provenance, commons, approval, or submission.

## Research arc and legal state changes

The arc is a map, not a lock:

`exploration → proposed → active → analysis → reviewed → complete`

The Python state machine allows each adjacent forward transition plus
`reviewed → analysis` and `complete → analysis`. Do not write status fields
directly. Use `lifecycle_transition` or `beril lifecycle` so validation, traces,
approval history, and event updates remain coherent.

Typical user-facing route:

`/berdl-start → /literature-review → /research-plan → /analyze --first-result → /analyze --continue → /paper-plan → /synthesize → /berdl-refute → /berdl-review → /submit`

Exploration, literature, ideas, audit, figures, world-model, and reroll commands
remain available whenever scientifically useful.

## Gate model

`lib/gates.ts` is the readable registry. It does not enforce transitions;
Python validators and explicit human confirmation do. Gate types are:

- `auto`: re-derived from files or durable state. A recorded verdict cannot
  clear a failing automatic check.
- `judgment`: the tool informs; a verdict is recorded in `beril.yaml:gates`.
- `human`: only the scientist can approve or sign off.

Current catalog:

| Edge | Gates |
| --- | --- |
| `exploration → proposed` | `commons-check` (auto/advisory), `feasibility` (judgment) |
| `proposed → active` | `plan-approval` (human checkpoint) |
| `active → analysis` | `report-present`, `claims-present` (auto), `data-validity` (judgment) |
| `analysis → reviewed` | `independent-review` (judgment), `orcid-signoff` (human) |
| `reviewed → complete` | `coherence` (auto, attributed override allowed), `commons-landed` (judgment) |

Gate records are append-only; the last entry for a gate ID is its displayed
verdict. Overrides require a reason and an ORCID-shaped `by` value. Agents may
surface or record a scientist's decision, but may not invent an override.

## Claims and calibrated trust

`claims.json` is generated through `claim_state` from `RESEARCH_PLAN.md` and
`REPORT.md`. Each row has a content-addressed `claim_uid`, a status, written
confidence, typed evidence pointers, supporting and refuting evidence, and
artifact-derived trust signals.

- Claim status is independent of project status: `open`, `supported`,
  `refuted`, `needs-replication`, `blocked`, or `needs-evidence`.
- Claim state retains the confidence written in the report/ledger. The
  canonical evidence calibration is high for at least two re-runnable results,
  medium for one, and low for literature-only or absent results; derived
  groundedness and mismatch flags expose when the written tier outruns support.
- Groundedness counts distinct query/notebook locators: `well-grounded`,
  `single-source`, or `ungrounded`.
- Claim type is `data`, `literature`, or `synthesis`. High/medium synthesis
  claims must be well-grounded and show a real disconfirmation search; the
  synthesis bar warns but does not self-certify the claim.
- Every pointer should preserve a locator, exact source text/value, and its
  relevance. Empty refutation slots must state what was searched; literal
  `not recorded` is treated as missing.

These rules are centralized in `lib/science.ts`, `lib/claim-state.ts`, and
`lib/claim-ledger.ts`. Cards display derived trust; prose must not assert a
stronger conclusion than the underlying artifacts support.

## Review and approval

`/berdl-refute` runs a read-only red-team pass and writes
`REFUTATION_N.md`; it does not change lifecycle state. `/berdl-review` runs an
isolated read-only reviewer (or bounded specialist panel) and writes
`REVIEW_N.md` with the raw `REPORT.md` hash in its final footer.

For `analysis → reviewed`:

1. `REPORT.md` must remain unchanged during review.
2. The review footer must cover the current report.
3. The human confirms sign-off in a trusted interactive session.
4. The Python transition validates report and review hashes and writes the
   ORCID-attributed `approval` block inline with the state change.

Headless or untrusted review may write the review artifact but cannot promote
the project. Re-reviewing an already reviewed/complete project adds another
opinion without changing state.

There are distinct hash purposes:

- `tools/notebook_hash.py`: canonical JSON notebook content hash, resilient to
  irrelevant notebook serialization changes; used as an integrity signal.
- `lib/review-finalize.ts`: raw-file SHA-256 for report/review TOCTOU coverage.
- Commons object hashes and `claim_uid`: content addressing for deduplication
  and tamper evidence.

The notebook with saved outputs is the reproducible record. BERIL does not
re-run notebooks to manufacture a reproducibility score, and the hashes above
must not be described as such a score.

## Coherence and submission

The filesystem-only coherence check compares current artifacts rather than
trusting agent bookkeeping. For reviewed work it requires:

- `REPORT.md` present.
- `claims.json` present and at least as current as the report.
- `provenance.json`/`TRACE.jsonl` current with notebooks and figures.
- A non-empty trace.

A failing `reviewed → complete` coherence check blocks unless the scientist
explicitly supplies a reason and ORCID-attributed override.

`/submit` additionally runs review preflight, reads the configured ORCID,
requires interactive destructive confirmation, regenerates the RO-Crate, and
lands commons entries before upload. Failure to generate the crate or land the
commons stops before the irreversible upload. Upload success/failure is recorded
as a marker; lifecycle state changes remain explicit.

## Provenance and memory boundaries

- `beril.yaml` is authoritative.
- `provenance.json` and `TRACE.jsonl` are inspectable but non-authoritative.
- `provenance.json:research_state` is orientation only: question, open
  questions, assumptions, and dead ends. Findings belong in claims/report.
- The commons is a separate cross-project store. Tests must set
  `$BERIL_COMMONS_DIR` to a temporary directory and never touch the real store.
