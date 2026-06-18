import assert from "node:assert/strict";
import { test } from "node:test";
import { RESEARCH_STEPS, currentStep, nextAction, sessionName, stepBreadcrumb } from "../lib/research-steps.ts";
import { GLYPH } from "../lib/ui/glyphs.ts";

test("breadcrumb marks the current step per lifecycle state", () => {
  assert.ok(stepBreadcrumb("exploration").includes(`${GLYPH.here}explore`));
  assert.ok(stepBreadcrumb("proposed").includes(`${GLYPH.here}plan`));
  assert.ok(stepBreadcrumb("active").includes(`${GLYPH.here}analyze`));
  // A drafted report (analysis) points the scientist at the next action: review.
  assert.ok(stepBreadcrumb("analysis").includes(`${GLYPH.here}review`));
  assert.ok(stepBreadcrumb("reviewed").includes(`${GLYPH.here}submit`));
});

test("breadcrumb always lists every step in order", () => {
  const out = stepBreadcrumb("active");
  for (const step of RESEARCH_STEPS) assert.ok(out.includes(step), `missing ${step}`);
  assert.ok(out.indexOf("explore") < out.indexOf("submit"));
});

test("complete shows a finished checklist; unknown state marks nothing", () => {
  assert.ok(stepBreadcrumb("complete").endsWith(GLYPH.ok));
  assert.ok(!stepBreadcrumb("complete").includes(GLYPH.here));
  const unknown = stepBreadcrumb("nonsense");
  assert.ok(!unknown.includes(GLYPH.here));
  assert.ok(!unknown.includes(GLYPH.ok));
});

test("currentStep gives the statusline phase label per state", () => {
  assert.equal(currentStep("exploration"), "explore");
  assert.equal(currentStep("active"), "analyze");
  assert.equal(currentStep("analysis"), "review");
  assert.equal(currentStep("complete"), "complete");
  assert.equal(currentStep("nonsense"), undefined);
});

test("sessionName combines project + phase, or just project for unknown state", () => {
  assert.equal(sessionName("aquila", "active"), `aquila ${GLYPH.bullet} analyze`);
  assert.equal(sessionName("aquila", "complete"), `aquila ${GLYPH.bullet} complete`);
  assert.equal(sessionName("aquila", "nonsense"), "aquila");
  assert.equal(sessionName("aquila"), "aquila");
});

test("active next action points through paper planning before synthesis", () => {
  assert.match(nextAction("active"), /paper-plan/);
  assert.match(nextAction("active"), /synthesize/);
});
