import assert from "node:assert/strict";
import { test } from "node:test";
import { contextColor, contextGauge, formatTokens } from "../lib/ui/context-meter.ts";

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

test("contextGauge fills cells proportionally to percent", () => {
  assert.equal(contextGauge(0, 6), "▱▱▱▱▱▱");
  assert.equal(contextGauge(100, 6), "▰▰▰▰▰▰");
  assert.equal(contextGauge(50, 6), "▰▰▰▱▱▱");
  assert.equal(contextGauge(null, 6), "▱▱▱▱▱▱", "unknown reads as empty");
});

test("formatTokens is compact and human, em-dash when unknown", () => {
  assert.equal(formatTokens(980), "980");
  assert.equal(formatTokens(12_300), "12.3k");
  assert.equal(formatTokens(1_200_000), "1.2M");
  assert.equal(formatTokens(null), "—");
});
