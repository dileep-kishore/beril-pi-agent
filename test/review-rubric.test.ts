import assert from "node:assert/strict";
import { test } from "node:test";
import { PLAN_REVIEW_RUBRIC, PROJECT_REVIEW_RUBRIC, REVIEW_PANEL, STATS_REVIEW_RUBRIC } from "../lib/review-rubric.ts";

test("project rubric is self-sufficient", () => {
  for (const needle of ["read-only", "Methodology", "Reproducibility", "Code quality", "Findings", "frontmatter"]) {
    assert.ok(PROJECT_REVIEW_RUBRIC.includes(needle), needle);
  }
  // The extension owns the footer — the reviewer must NOT emit report_hash.
  assert.ok(!/report_hash/i.test(PROJECT_REVIEW_RUBRIC));
});

test("plan rubric covers feasibility + pitfalls", () => {
  for (const needle of ["Hypothesis", "pitfall", "Performance", "Duplication"]) {
    assert.ok(PLAN_REVIEW_RUBRIC.includes(needle), needle);
  }
});

test("project rubric hunts the four silent failure modes (P0.1)", () => {
  assert.match(PROJECT_REVIEW_RUBRIC, /Data leakage & evaluation integrity/);
  assert.match(PROJECT_REVIEW_RUBRIC, /train\/test leakage/i);
  assert.match(PROJECT_REVIEW_RUBRIC, /selection bias/i);
  assert.match(PROJECT_REVIEW_RUBRIC, /metric misuse/i);
  assert.match(PROJECT_REVIEW_RUBRIC, /benchmark\/baseline selection/i);
});

test("project rubric scopes the ML-leakage half to model/threshold work (P1.4)", () => {
  // The train/test leakage hunt is conditional on a model/threshold being fit;
  // selection bias + metric misuse stay universal (apply to plain descriptive SQL).
  assert.match(PROJECT_REVIEW_RUBRIC, /trains or tunes a model or threshold/i);
  assert.match(STATS_REVIEW_RUBRIC, /trains or tunes a model or threshold/i);
});

test("project rubric reads numeric cell outputs + the claim ledger, not just source (P0.1)", () => {
  assert.match(PROJECT_REVIEW_RUBRIC, /report numbers \(metric values/);
  // The old "skip outputs wholesale" steer must be gone.
  assert.doesNotMatch(PROJECT_REVIEW_RUBRIC, /skip base64 image outputs in cell/);
  assert.match(PROJECT_REVIEW_RUBRIC, /claims\.json/);
  // The leakage section appears in the output template too.
  assert.match(PROJECT_REVIEW_RUBRIC, /## Data leakage & evaluation integrity/);
});

test("the stats panelist also carries the leakage clause (P0.1)", () => {
  assert.match(STATS_REVIEW_RUBRIC, /Data leakage & evaluation integrity/);
  assert.match(STATS_REVIEW_RUBRIC, /held-out set/i);
  assert.ok(
    REVIEW_PANEL.some((s) => s.id === "stats"),
    "the panel includes the stats specialist that hunts leakage",
  );
});
