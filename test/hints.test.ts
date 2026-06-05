import assert from "node:assert/strict";
import { test } from "node:test";
import { discoverHint, queryHint } from "../lib/hints.ts";

test("queryHint advises truncation when returned rows hit the limit", () => {
  const hint = queryHint(100, 100);
  assert.equal(typeof hint, "string");
  assert.ok((hint as string).length > 0);
});

test("queryHint is silent when the result is under the limit", () => {
  assert.equal(queryHint(7, 100), undefined);
});

test("queryHint is silent when no limit was applied", () => {
  assert.equal(queryHint(7, null), undefined);
});

test("discoverHint nudges querying a discovered table when one is present", () => {
  const snapshot = {
    schema_version: 1,
    tenants: [
      {
        id: "kbase",
        name: "KBase",
        collections: [{ id: "db1", name: "DB One", tables: [{ name: "t1", columns: [] }] }],
      },
    ],
  };
  const hint = discoverHint(snapshot);
  assert.equal(typeof hint, "string");
  assert.ok((hint as string).length > 0);
});

test("discoverHint is silent when nothing useful is present", () => {
  assert.equal(discoverHint({}), undefined);
  assert.equal(discoverHint(null), undefined);
  // A snapshot whose tenants have no collections is not useful.
  assert.equal(discoverHint({ tenants: [{ id: "t", collections: [] }] }), undefined);
  // The old fabricated top-level `databases` key must NOT trigger a hint.
  assert.equal(discoverHint({ databases: [{ name: "db1" }] }), undefined);
});
