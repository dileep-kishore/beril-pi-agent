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

// ── world-model orientation sections ─────────────────────

test("buildSnapshot clamps the question to 240 chars and bounds the lists to 8", () => {
  const snap = buildSnapshot({
    project: "p",
    phase: "active",
    claims: TALLY,
    question: `What drives X?\n${"y".repeat(400)}`,
    openQuestions: Array.from({ length: 12 }, (_, i) => `q${i}`),
    assumptions: Array.from({ length: 11 }, (_, i) => `a${i}`),
    deadEnds: Array.from({ length: 10 }, (_, i) => `d${i}`),
  });
  assert.ok(snap.question && snap.question.length <= 240);
  assert.ok(!snap.question?.includes("\n")); // single-lined
  assert.equal(snap.openQuestions?.length, 8); // >8 truncated
  assert.equal(snap.assumptions?.length, 8);
  assert.equal(snap.deadEnds?.length, 8);
  // The first entries are kept (truncation drops the tail).
  assert.equal(snap.openQuestions?.[0], "q0");
  assert.equal(snap.deadEnds?.[7], "d7");
});

test("buildSnapshot clamps each list entry and drops empty ones", () => {
  const snap = buildSnapshot({
    project: "p",
    phase: "active",
    claims: TALLY,
    openQuestions: [`is ${"z".repeat(300)} relevant?`, "   ", "real question"],
  });
  assert.ok(snap.openQuestions?.[0] && snap.openQuestions[0].length <= 160);
  // Blank entries are dropped, so only the two real ones survive in order.
  assert.deepEqual(
    snap.openQuestions?.slice(0, 2).map((q) => q.length <= 160),
    [true, true],
  );
  assert.ok(!snap.openQuestions?.includes(""));
  assert.ok(snap.openQuestions?.includes("real question"));
});

test("buildSnapshot omits world-model sections when not supplied", () => {
  const snap = buildSnapshot({ project: "p", phase: "active", claims: TALLY });
  assert.equal(snap.question, undefined);
  assert.equal(snap.openQuestions, undefined);
  assert.equal(snap.assumptions, undefined);
  assert.equal(snap.deadEnds, undefined);
});

test("formatReinjection surfaces open questions + dead ends under the re-verify guard", () => {
  const snap = buildSnapshot({
    project: "aquila",
    phase: "analysis",
    claims: TALLY,
    question: "Does iron limitation drive the bloom?",
    openQuestions: ["which depth horizon dominates?"],
    assumptions: ["nitrate is non-limiting in spring"],
    deadEnds: ["salinity gradient was a dead end"],
  });
  const text = formatReinjection(snap);
  assert.match(text, /Does iron limitation drive the bloom\?/);
  assert.match(text, /which depth horizon dominates\?/);
  assert.match(text, /salinity gradient was a dead end/);
  assert.match(text, /nitrate is non-limiting in spring/);
  // Still carries the anti-laundering / orientation guard.
  assert.match(text, /NOT established findings/);
  assert.match(text, /re-verify/);
});
