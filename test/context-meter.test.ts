import assert from "node:assert/strict";
import { test } from "node:test";
import { contextColor, formatContext } from "../lib/ui/context-meter.ts";

test("contextColor stays green well under the thresholds", () => {
  assert.equal(contextColor(10, 1000), "success");
  assert.equal(contextColor(null, null), "success");
});

test("contextColor warns on EITHER percent or absolute tokens", () => {
  assert.equal(contextColor(55, 1000), "warning"); // percent gate
  assert.equal(contextColor(10, 200_000), "warning"); // absolute-token gate
});

test("contextColor alarms on EITHER 90% or 500k tokens", () => {
  assert.equal(contextColor(95, 1), "error");
  assert.equal(contextColor(10, 600_000), "error");
});

test("formatContext renders a percent, or an em-dash when unknown", () => {
  assert.equal(formatContext({ tokens: 1000, percent: 38 }), "ctx 38%");
  assert.equal(formatContext({ tokens: null, percent: null }), "ctx —");
  assert.equal(formatContext(undefined), "ctx —");
});
