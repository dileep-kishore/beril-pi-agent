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
  });
});

test("serializeClaimState emits inspectable pretty JSON", () => {
  const state = buildClaimState({ project: "demo", planMd: PLAN, reportMd: REPORT });
  assert.match(serializeClaimState(state), /\n {2}"project": "demo"/);
});
