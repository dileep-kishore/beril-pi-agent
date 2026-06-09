import assert from "node:assert/strict";
import { test } from "node:test";
import { parseClaimLedger } from "../lib/claim-ledger.ts";

const PLAN = `# Research Plan: AMR Atlas

## Hypothesis
- **H0**: AMR gene prevalence is independent of habitat.
- **H1**: AMR gene prevalence is higher in clinical isolates.
`;

const REPORT = `# Report: AMR Atlas

## Confidence & Caveats
- Finding: clinical isolates carry more AMR genes (**medium**: one re-runnable query; n=37 isolates. Caveats: single habitat split. Status: needs-evidence).

## Supporting vs Refuting
- Supports: *(query: amr_by_habitat)* clinical mean 4.2 vs environmental 1.1 — the headline split.
- Refutes: none found — searched accessory-gene burden by habitat.
`;

test("parses a finding's tier, status, and supports/refutes onto the first hypothesis", () => {
  const rows = parseClaimLedger(PLAN, REPORT);
  assert.equal(rows.length, 2, "one row per hypothesis (H0, H1)");
  assert.equal(rows[0].confidence, "medium");
  assert.equal(rows[0].status, "needs-evidence");
  assert.equal(rows[0].supports, 1);
  assert.equal(rows[0].refutes, 0);
  // H1 has no matching finding → defaults.
  assert.equal(rows[1].confidence, "low");
  assert.equal(rows[1].status, "open");
  assert.equal(rows[1].supports, 0);
  assert.equal(rows[1].refutes, 0);
});

test("findings with no parseable hypotheses become one row each, slugged", () => {
  const rows = parseClaimLedger("", REPORT);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].confidence, "medium");
  assert.equal(rows[0].status, "needs-evidence");
  assert.ok(rows[0].hypothesis.includes("clinical isolates"), "hypothesis cell is a slug of the finding");
});

test("empty / missing inputs → [] (never throws)", () => {
  assert.deepEqual(parseClaimLedger("", ""), []);
  assert.deepEqual(parseClaimLedger(undefined as unknown as string, undefined as unknown as string), []);
});
