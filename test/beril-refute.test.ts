import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRefuteArgs } from "../extensions/beril-refute.ts";

test("parses project", () => {
  assert.deepEqual(parseRefuteArgs("amr_atlas"), { project: "amr_atlas", model: undefined });
});

test("parses --model", () => {
  assert.deepEqual(parseRefuteArgs("amr_atlas --model claude-opus-4-8"), {
    project: "amr_atlas",
    model: "claude-opus-4-8",
  });
});

test("missing project → undefined", () => {
  assert.equal(parseRefuteArgs("   "), undefined);
});
