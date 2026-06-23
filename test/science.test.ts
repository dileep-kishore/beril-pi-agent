import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type EvidencePointer,
  faithfulnessForPointer,
  groundednessForEvidence,
  tierForEvidence,
} from "../lib/science.ts";

const ptr = (kind: EvidencePointer["kind"]): EvidencePointer => ({
  kind,
  locator: "x",
  exact: "y",
  relevance: "z",
});

const at = (kind: EvidencePointer["kind"], locator: string, exact = "n"): EvidencePointer => ({
  kind,
  locator,
  exact,
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

test("groundednessForEvidence: no support → ungrounded, never throws", () => {
  assert.equal(groundednessForEvidence([]), "ungrounded");
});

test("groundednessForEvidence: one re-runnable result → single-source", () => {
  assert.equal(groundednessForEvidence([at("notebook", "nb/01.ipynb")]), "single-source");
  assert.equal(groundednessForEvidence([at("query", "q:abc")]), "single-source");
});

test("groundednessForEvidence: two distinct result locators → well-grounded", () => {
  assert.equal(groundednessForEvidence([at("notebook", "nb/01.ipynb"), at("query", "q:abc")]), "well-grounded");
});

test("groundednessForEvidence: two pointers with the same locator are one source", () => {
  assert.equal(
    groundednessForEvidence([at("notebook", "nb/01.ipynb"), at("notebook", "nb/01.ipynb")]),
    "single-source",
  );
});

test("groundednessForEvidence: same locator differing only by whitespace dedupes", () => {
  assert.equal(
    groundednessForEvidence([at("notebook", "nb/01.ipynb"), at("notebook", " nb/01.ipynb ")]),
    "single-source",
  );
});

test("groundednessForEvidence: web/paper pointers are ungrounded, never well-grounded", () => {
  assert.equal(groundednessForEvidence([at("paper", "PMID:1"), at("web", "http://x")]), "ungrounded");
  assert.equal(groundednessForEvidence([at("paper", "PMID:1"), at("paper", "PMID:2")]), "ungrounded");
});

test("groundednessForEvidence: one result + a paper → single-source (paper does not count)", () => {
  assert.equal(groundednessForEvidence([at("query", "q:abc"), at("paper", "PMID:1")]), "single-source");
});

test("faithfulnessForPointer: a non-empty exact quote → verified", () => {
  assert.equal(faithfulnessForPointer(at("notebook", "nb/01.ipynb", "rho=0.38")), "verified");
});

test("faithfulnessForPointer: empty or whitespace exact → unverified", () => {
  assert.equal(faithfulnessForPointer(at("notebook", "nb/01.ipynb", "")), "unverified");
  assert.equal(faithfulnessForPointer(at("notebook", "nb/01.ipynb", "   ")), "unverified");
});
