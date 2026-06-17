import assert from "node:assert/strict";
import { test } from "node:test";
import { findLabelledEntry, scienceLabel } from "../lib/session-reroll.ts";

test("scienceLabel creates stable labels for scientific seams", () => {
  assert.equal(scienceLabel("lifecycle", "demo", "analysis"), "beril:demo:analysis");
  assert.equal(scienceLabel("checkpoint", "demo", "First result?"), "beril:demo:checkpoint:first-result");
});

test("findLabelledEntry returns the newest matching entry", () => {
  const entries = [{ id: "old" }, { id: "new" }];
  const labels = new Map([
    ["old", "beril:demo:analysis"],
    ["new", "beril:demo:checkpoint:first-result"],
  ]);
  const entry = findLabelledEntry(entries, (id) => labels.get(id), "first-result");
  assert.equal(entry?.id, "new");
});
