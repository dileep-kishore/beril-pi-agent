import assert from "node:assert/strict";
import { test } from "node:test";
import { type EvidencePointer, tierForEvidence } from "../lib/science.ts";

const ptr = (kind: EvidencePointer["kind"]): EvidencePointer => ({
  kind,
  locator: "x",
  exact: "y",
  relevance: "z",
});

test("no supporting artifacts → low", () => {
  assert.equal(tierForEvidence([]), "low");
});

test("literature-only → low", () => {
  assert.equal(tierForEvidence([ptr("paper")]), "low");
});

test("a single re-runnable result → medium", () => {
  assert.equal(tierForEvidence([ptr("notebook")]), "medium");
  assert.equal(tierForEvidence([ptr("query")]), "medium");
});

test("one result + a resolving paper → medium", () => {
  assert.equal(tierForEvidence([ptr("query"), ptr("paper")]), "medium");
});

test("two independent artifact-backed results → high", () => {
  assert.equal(tierForEvidence([ptr("notebook"), ptr("query")]), "high");
});
