import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSnapshot, formatReinjection } from "../lib/session-state.ts";

const TALLY = { total: 3, supported: 1, refuted: 1 };

test("buildSnapshot derives step from phase and copies the tally", () => {
  const snap = buildSnapshot({ project: "aquila", phase: "analysis", claims: TALLY });
  assert.equal(snap.project, "aquila");
  assert.equal(snap.phase, "analysis");
  assert.equal(snap.step, "review"); // currentStep("analysis") === "review"
  assert.deepEqual(snap.claims, { total: 3, supported: 1, refuted: 1 });
  // Optional field omitted when absent.
  assert.equal(snap.lastCheckpoint, undefined);
});

test("buildSnapshot coerces an unknown phase to an empty step", () => {
  const snap = buildSnapshot({ project: "p", phase: "no-such-phase", claims: TALLY });
  assert.equal(snap.step, "");
});

test("buildSnapshot clamps + single-lines lastCheckpoint, omits empty", () => {
  const snap = buildSnapshot({
    project: "p",
    phase: "active",
    claims: TALLY,
    lastCheckpoint: `Approve the plan?\n -> ${"x".repeat(300)}`,
  });
  assert.ok(snap.lastCheckpoint && snap.lastCheckpoint.length <= 160);
  assert.ok(!snap.lastCheckpoint?.includes("\n"));
  // A whitespace-only checkpoint collapses to nothing and is omitted.
  const blank = buildSnapshot({ project: "p", phase: "active", claims: TALLY, lastCheckpoint: "   " });
  assert.equal(blank.lastCheckpoint, undefined);
});

test("formatReinjection carries identifiers + counts + the anti-laundering guards", () => {
  const snap = buildSnapshot({
    project: "aquila",
    phase: "analysis",
    claims: { total: 4, supported: 2, refuted: 1 },
    lastCheckpoint: "Plan ready? -> Approve and continue",
  });
  const text = formatReinjection(snap);
  // Identifiers + step.
  assert.match(text, /aquila/);
  assert.match(text, /review step/);
  // Literal counts (not claim text).
  assert.match(text, /4 claim\(s\), 2 supported, 1 refuted/);
  // The checkpoint decision line.
  assert.match(text, /Plan ready\? -> Approve and continue/);
  // The anti-laundering guard strings.
  assert.match(text, /NOT established findings/);
  assert.match(text, /re-verify/);
  // Deterministic + bounded.
  assert.equal(text, formatReinjection(snap));
  assert.ok(text.length < 600);
});

test("formatReinjection never leaks claim hypothesis text", () => {
  // The snapshot only ever holds counts/identifiers — there is no field for a
  // hypothesis string, so it can never reach the re-injected prose.
  const snap = buildSnapshot({ project: "p", phase: "analysis", claims: TALLY });
  const text = formatReinjection(snap);
  assert.ok(!Object.keys(snap).includes("hypothesis"));
  assert.ok(!/hypothesis|H\d+:/.test(text));
});

test("formatReinjection omits the checkpoint line when none is known", () => {
  const snap = buildSnapshot({ project: "p", phase: "active", claims: TALLY });
  assert.ok(!formatReinjection(snap).includes("Last checkpoint decision"));
});
