import assert from "node:assert/strict";
import { test } from "node:test";
import { buildClaimState, claimStateSummary, serializeClaimState } from "../lib/claim-state.ts";

const PLAN = `# Plan

## Hypotheses

- **H1:** Soil genomes carry more oxidative-stress genes.
- **H2:** Marine genomes carry fewer oxidative-stress genes.
`;

const REPORT = `# Report

## Key Findings

### Finding 1: Soil genomes carry more oxidative-stress genes

Status: supported
Confidence: medium
Supports: notebooks/01_soil.ipynb — enrichment test
Refutes: none found — searched marine controls

### Finding 2: Marine genomes carry fewer oxidative-stress genes

Status: needs-evidence
Confidence: low
Supports: none
Refutes: paper PMID:123 — conflicting habitat trend
`;

test("buildClaimState derives stable claim rows from plan and report", () => {
  const state = buildClaimState({ project: "demo", planMd: PLAN, reportMd: REPORT, now: "2026-06-17T00:00:00Z" });
  assert.equal(state.project, "demo");
  assert.equal(state.rows.length, 2);
  assert.equal(state.rows[0].claim_id, "h1-soil-genomes-carry-more-oxidative-stress-genes");
  assert.equal(state.rows[0].status, "supported");
  assert.equal(state.rows[0].refutesSearched, "marine controls");
});

test("buildClaimState preserves existing ids and reviewer notes by claim text", () => {
  const existing = {
    project: "demo",
    updated_at: "old",
    report_hash: "sha256:old",
    rows: [
      {
        claim_id: "custom-h1",
        claim: "Soil genomes carry more oxidative-stress genes.",
        status: "open",
        confidence: "low",
        supports: [],
        refutes: [],
        reviewer_notes: "watch habitat imbalance",
      },
    ],
  } as any;
  const state = buildClaimState({ project: "demo", planMd: PLAN, reportMd: REPORT, existing, now: "now" });
  assert.equal(state.rows[0].claim_id, "custom-h1");
  assert.equal(state.rows[0].reviewer_notes, "watch habitat imbalance");
  assert.equal(state.rows[0].status, "supported");
});

test("claimStateSummary counts unsupported and empty-refute rows", () => {
  const state = buildClaimState({ project: "demo", planMd: PLAN, reportMd: REPORT });
  assert.deepEqual(claimStateSummary(state.rows), {
    total: 2,
    supported: 1,
    refuted: 0,
    unsupported: 1,
    emptyRefutes: 1,
    tierMismatch: 1,
    synthesisBar: 0,
  });
});

test("serializeClaimState emits inspectable pretty JSON", () => {
  const state = buildClaimState({ project: "demo", planMd: PLAN, reportMd: REPORT });
  assert.match(serializeClaimState(state), /\n {2}"project": "demo"/);
});

test("each row carries a computed groundedness tier", () => {
  const state = buildClaimState({ project: "demo", planMd: PLAN, reportMd: REPORT });
  // H1: one notebook support → single-source. H2: no support → ungrounded.
  assert.equal(state.rows[0].groundedness, "single-source");
  assert.equal(state.rows[1].groundedness, "ungrounded");
});

test("tier_mismatch is set when written confidence outruns the evidence", () => {
  const state = buildClaimState({ project: "demo", planMd: PLAN, reportMd: REPORT });
  // H1 is written `medium` but rests on a single source → mismatch.
  assert.equal(state.rows[0].tier_mismatch, true);
});

test("claimStateSummary reports the tierMismatch count", () => {
  const state = buildClaimState({ project: "demo", planMd: PLAN, reportMd: REPORT });
  const summary = claimStateSummary(state.rows);
  assert.equal(summary.tierMismatch, 1);
});

const SYNTHESIS_REPORT = `# Report

## Key Findings

### Finding 1: Soil genomes carry more oxidative-stress genes

Status: supported
Confidence: high
Supports: notebooks/01_soil.ipynb — enrichment test
Supports: query:soil-oxidative-stress — independent query
Supports: paper PMID:12345 — prior mechanism
Refutes:
`;

test("synthesis_bar is set when a high synthesis claim lacks a real refutation search", () => {
  const state = buildClaimState({ project: "demo", planMd: PLAN, reportMd: SYNTHESIS_REPORT });
  assert.equal(state.rows[0].claim_type, "synthesis");
  assert.equal(state.rows[0].groundedness, "well-grounded");
  assert.equal(state.rows[0].tier_mismatch, false);
  assert.equal(state.rows[0].refutesSearched, undefined);
  assert.equal(state.rows[0].synthesis_bar, true);
  assert.equal(claimStateSummary(state.rows).synthesisBar, 1);
});

test("buildClaimState normalizes legacy 'not recorded' refute search placeholders", () => {
  const existing = {
    project: "demo",
    updated_at: "old",
    rows: [
      {
        claim_id: "h1",
        claim: "Soil genomes carry more oxidative-stress genes",
        status: "supported",
        confidence: "high",
        supports: [
          { kind: "notebook", locator: "notebooks/01.ipynb", exact: "", relevance: "" },
          { kind: "query", locator: "query:soil", exact: "", relevance: "" },
          { kind: "paper", locator: "PMID:123", exact: "", relevance: "" },
        ],
        refutes: [],
        refutesSearched: "not recorded",
      },
    ],
  } as any;
  const state = buildClaimState({
    project: "demo",
    planMd: "- **H1:** Soil genomes carry more oxidative-stress genes\n",
    reportMd: "# Report\n",
    existing,
  });
  assert.equal(state.rows[0].refutesSearched, undefined);
});

const WELL_GROUNDED_REPORT = `# Report

## Key Findings

### Finding 1: Soil genomes carry more oxidative-stress genes

Status: supported
Confidence: high
Supports: notebooks/01_soil.ipynb — enrichment test
Supports: notebooks/02_replicate.ipynb — replication
Refutes: none found — searched marine controls

### Finding 2: Marine genomes carry fewer oxidative-stress genes

Status: needs-evidence
Confidence: low
Supports: none
Refutes: paper PMID:123 — conflicting habitat trend
`;

test("two distinct supports → well-grounded high claim has no tier_mismatch", () => {
  const state = buildClaimState({ project: "demo", planMd: PLAN, reportMd: WELL_GROUNDED_REPORT });
  assert.equal(state.rows[0].groundedness, "well-grounded");
  assert.equal(state.rows[0].tier_mismatch, false);
});

test("groundedness and tier_mismatch round-trip through claims.json", () => {
  const state = buildClaimState({ project: "demo", planMd: PLAN, reportMd: REPORT });
  const parsed = JSON.parse(serializeClaimState(state));
  assert.equal(parsed.rows[0].groundedness, "single-source");
  assert.equal(parsed.rows[0].tier_mismatch, true);
  assert.equal(parsed.rows[1].groundedness, "ungrounded");
});
