import assert from "node:assert/strict";
import { test } from "node:test";
import { RESEARCH_STEPS, currentStep, stepBreadcrumb } from "../lib/research-steps.ts";

test("breadcrumb marks the current step per lifecycle state", () => {
  assert.match(stepBreadcrumb("exploration"), /▸explore/);
  assert.match(stepBreadcrumb("proposed"), /▸plan/);
  assert.match(stepBreadcrumb("active"), /▸analyze/);
  // A drafted report (analysis) points the scientist at the next action: review.
  assert.match(stepBreadcrumb("analysis"), /▸review/);
  assert.match(stepBreadcrumb("reviewed"), /▸submit/);
});

test("breadcrumb always lists every step in order", () => {
  const out = stepBreadcrumb("active");
  for (const step of RESEARCH_STEPS) assert.ok(out.includes(step), `missing ${step}`);
  assert.ok(out.indexOf("explore") < out.indexOf("submit"));
});

test("complete shows a finished checklist; unknown state marks nothing", () => {
  assert.match(stepBreadcrumb("complete"), /✓$/);
  assert.doesNotMatch(stepBreadcrumb("complete"), /▸/);
  const unknown = stepBreadcrumb("nonsense");
  assert.doesNotMatch(unknown, /▸/);
  assert.doesNotMatch(unknown, /✓/);
});

test("currentStep gives the statusline phase label per state", () => {
  assert.equal(currentStep("exploration"), "explore");
  assert.equal(currentStep("active"), "analyze");
  assert.equal(currentStep("analysis"), "review");
  assert.equal(currentStep("complete"), "complete");
  assert.equal(currentStep("nonsense"), undefined);
});
