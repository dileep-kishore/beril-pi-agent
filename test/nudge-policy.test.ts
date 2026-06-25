import assert from "node:assert/strict";
import { test } from "node:test";
import { CAPABILITIES, type Capability } from "../lib/capabilities.ts";
import { decideNudge, isReachable, phrase, requiredStep } from "../lib/nudge-policy.ts";
import { currentStep } from "../lib/research-steps.ts";
import { recommendedCommand } from "../lib/workflow.ts";

function cap(id: string): Capability {
  const found = CAPABILITIES.find((c) => c.id === id);
  assert.ok(found, `capability ${id} exists`);
  return found as Capability;
}

test("requiredStep maps capabilities onto the research-step rail", () => {
  for (const id of ["start", "world-model", "discover", "literature", "memory"]) {
    assert.equal(requiredStep(cap(id)), 0, `${id} is an explore-lane (step 0) capability`);
  }
  assert.equal(requiredStep(cap("plan")), 1);
  for (const id of ["analyze", "paper", "synthesize"]) {
    assert.equal(requiredStep(cap(id)), 2, `${id} is a step-2 capability`);
  }
  for (const id of ["refute", "review"]) {
    assert.equal(requiredStep(cap(id)), 3, `${id} is a step-3 capability`);
  }
  assert.equal(requiredStep(cap("submit")), 4);
});

test("isReachable gates out-of-phase capabilities, allows at-or-one-ahead", () => {
  assert.equal(isReachable(cap("submit"), "exploration"), false, "submit is far ahead of exploration");
  assert.equal(isReachable(cap("analyze"), "proposed"), true, "analyze is one step ahead of proposed");
  assert.equal(isReachable(cap("plan"), "exploration"), true, "plan is one step ahead of exploration");
  assert.equal(isReachable(cap("submit"), "analysis"), true, "submit is one step ahead of analysis");
  assert.equal(isReachable(cap("review"), "exploration"), false, "review (step 3) is unreachable from exploration");
});

test("unknown or absent status is not gated (don't gate on a cold cache)", () => {
  assert.equal(isReachable(cap("submit"), undefined), true);
  assert.equal(isReachable(cap("submit"), "not-a-phase"), true);
});

test("the analysis status maps to the review step, not 'still analyzing'", () => {
  assert.equal(currentStep("analysis"), "review");
});

test("decideNudge nudges an on-phase match", () => {
  const d = decideNudge({ cap: cap("analyze"), status: "active", project: "aquila" });
  assert.equal(d.kind, "nudge");
  assert.equal(d.kind === "nudge" && d.cap.id, "analyze");
});

test("decideNudge redirects an off-phase match to the phase-correct command", () => {
  const d = decideNudge({ cap: cap("submit"), status: "exploration", project: "aquila" });
  assert.equal(d.kind, "redirect");
  assert.equal(d.kind === "redirect" && d.command, recommendedCommand("exploration", "aquila"));
  // It must NOT route the user toward /submit while exploring.
  assert.equal(d.kind === "redirect" && d.command, "/berdl-preview <table>");
});

test("phrase renders nudge via routeNudge and redirect with the target command", () => {
  const nudge = phrase({ kind: "nudge", cap: cap("analyze") });
  assert.match(nudge, /Possible BERIL route/);
  const redirect = phrase({ kind: "redirect", command: "/berdl-preview <table>" });
  assert.match(redirect, /\/berdl-preview <table>/);
  assert.match(redirect, /not reachable from the current phase/i);
});
