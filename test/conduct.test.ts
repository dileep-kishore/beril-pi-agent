import assert from "node:assert/strict";
import { test } from "node:test";
import { CONDUCT_CONTRACT } from "../lib/conduct.ts";

test("conduct contract names the behaviors we want by default", () => {
  const lower = CONDUCT_CONTRACT.toLowerCase();
  // Ask before large moves / clarifying questions.
  assert.match(lower, /ask before large moves/);
  // Check in at natural seams.
  assert.match(lower, /check in at natural seams/);
  // Signal confidence / uncertainty.
  assert.match(lower, /signal your confidence/);
  // Make the data visible via berdl_peek.
  assert.match(CONDUCT_CONTRACT, /berdl_peek/);
  // Make verification easy (offer the check by default).
  assert.match(lower, /make verification easy/);
});

test("conduct contract stays short enough not to dilute the directives", () => {
  // A guardrail, not a precise budget: a long contract buries the few rules that matter.
  assert.ok(CONDUCT_CONTRACT.length < 2000, `contract too long: ${CONDUCT_CONTRACT.length} chars`);
});
