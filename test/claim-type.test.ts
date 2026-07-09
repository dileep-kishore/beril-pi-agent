import assert from "node:assert/strict";
import { test } from "node:test";
import { type EvidencePointer, claimTypeForEvidence, synthesisBar } from "../lib/science.ts";

const at = (kind: EvidencePointer["kind"], locator: string): EvidencePointer => ({
  kind,
  locator,
  exact: "n",
  relevance: "z",
});

test("claimTypeForEvidence: results only → data", () => {
  assert.equal(claimTypeForEvidence([at("notebook", "01.ipynb")]), "data");
  assert.equal(claimTypeForEvidence([at("query", "q:1"), at("notebook", "02.ipynb")]), "data");
});

test("claimTypeForEvidence: literature only → literature", () => {
  assert.equal(claimTypeForEvidence([at("paper", "PMID:1")]), "literature");
  assert.equal(claimTypeForEvidence([at("web", "http://x")]), "literature");
});

test("claimTypeForEvidence: both, none, or figure-only → synthesis", () => {
  assert.equal(claimTypeForEvidence([at("notebook", "01.ipynb"), at("paper", "PMID:1")]), "synthesis");
  assert.equal(claimTypeForEvidence([]), "synthesis");
  assert.equal(claimTypeForEvidence([at("figure", "f1.png")]), "synthesis");
});

test("synthesisBar: only flags synthesis claims", () => {
  // A data claim, even single-sourced and high, is not this bar's business.
  assert.equal(synthesisBar({ confidence: "high", supports: [at("notebook", "01.ipynb")], refutes: [] }), false);
});

test("synthesisBar: cleared when well-grounded AND disconfirmation was sought", () => {
  const supports = [at("notebook", "01.ipynb"), at("query", "q:1"), at("paper", "PMID:1")]; // synthesis + 2 distinct results
  assert.equal(synthesisBar({ confidence: "high", supports, refutes: [], refutesSearched: "alt hypotheses" }), false);
  assert.equal(synthesisBar({ confidence: "high", supports, refutes: [at("paper", "PMID:2")] }), false);
});

test("synthesisBar: flagged when high/medium synthesis lacks grounding or disconfirmation", () => {
  const wellGrounded = [at("notebook", "01.ipynb"), at("query", "q:1"), at("paper", "PMID:1")];
  const singleSource = [at("notebook", "01.ipynb"), at("paper", "PMID:1")];
  // Well-grounded but never searched for disconfirming evidence → flagged.
  assert.equal(synthesisBar({ confidence: "high", supports: wellGrounded, refutes: [] }), true);
  // Legacy placeholder text is not a real search note.
  assert.equal(
    synthesisBar({ confidence: "high", supports: wellGrounded, refutes: [], refutesSearched: "not recorded" }),
    true,
  );
  // Disconfirmation sought but only a single grounded source → flagged.
  assert.equal(
    synthesisBar({ confidence: "medium", supports: singleSource, refutes: [], refutesSearched: "alt" }),
    true,
  );
});

test("synthesisBar: low confidence is never flagged", () => {
  assert.equal(
    synthesisBar({ confidence: "low", supports: [at("notebook", "01.ipynb"), at("paper", "PMID:1")], refutes: [] }),
    false,
  );
});
