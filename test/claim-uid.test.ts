import assert from "node:assert/strict";
import { test } from "node:test";
import { buildClaimState } from "../lib/claim-state.ts";

const PLAN = `# Plan

## Hypotheses

- **H1:** Soil genomes carry more oxidative-stress genes.
`;

const reportWith = (support: string) => `# Report

## Key Findings

### Finding 1: Soil genomes carry more oxidative-stress genes

Status: supported
Confidence: medium
Supports: ${support} — enrichment test
Refutes: none found — searched marine controls
`;

test("claim_uid is stable for the same claim + evidence", () => {
  const a = buildClaimState({ project: "demo", planMd: PLAN, reportMd: reportWith("notebooks/01.ipynb") });
  const b = buildClaimState({ project: "demo", planMd: PLAN, reportMd: reportWith("notebooks/01.ipynb") });
  assert.ok(a.rows[0].claim_uid.startsWith("sha256:"));
  assert.equal(a.rows[0].claim_uid, b.rows[0].claim_uid);
});

test("claim_uid changes when the evidence set changes", () => {
  const a = buildClaimState({ project: "demo", planMd: PLAN, reportMd: reportWith("notebooks/01.ipynb") });
  const b = buildClaimState({ project: "demo", planMd: PLAN, reportMd: reportWith("notebooks/02.ipynb") });
  assert.notEqual(a.rows[0].claim_uid, b.rows[0].claim_uid);
});

test("each row carries a claim_type derived from its supports", () => {
  const state = buildClaimState({ project: "demo", planMd: PLAN, reportMd: reportWith("notebooks/01.ipynb") });
  // A notebook support with no literature → a data claim.
  assert.equal(state.rows[0].claim_type, "data");
});
