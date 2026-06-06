import assert from "node:assert/strict";
import { test } from "node:test";
import { PLAN_REVIEW_RUBRIC, PROJECT_REVIEW_RUBRIC } from "../lib/review-rubric.ts";

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
