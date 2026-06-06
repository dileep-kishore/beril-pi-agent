import assert from "node:assert/strict";
import { test } from "node:test";
import { markdownTable } from "../lib/ui/table.ts";

test("empty input renders an italic zero-rows marker", () => {
  assert.equal(markdownTable([]), "_(0 rows)_");
});

test("renders a GFM header, separator, and one row per record", () => {
  const md = markdownTable([
    { gene: "recA", count: 12 },
    { gene: "gyrA", count: 7 },
  ]);
  const lines = md.split("\n");
  assert.equal(lines[0], "| gene | count |");
  assert.equal(lines[1], "| --- | --- |");
  assert.equal(lines[2], "| recA | 12 |");
  assert.equal(lines[3], "| gyrA | 7 |");
});

test("escapes pipes and newlines, renders null/undefined as empty", () => {
  const md = markdownTable([{ note: "a|b\nc", missing: null }]);
  assert.ok(md.includes("a\\|b c"), "pipe escaped and newline flattened");
  assert.ok(md.includes("|  |"), "null becomes an empty cell");
});

test("truncates long cells with an ellipsis", () => {
  const md = markdownTable([{ seq: "A".repeat(100) }], { maxColWidth: 10 });
  assert.ok(md.includes("…"), "long value truncated");
  assert.ok(!md.includes("A".repeat(100)), "full value not shown");
});

test("caps rows and notes how many more there are", () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ i }));
  const md = markdownTable(rows, { maxRows: 5 });
  const dataRows = md.split("\n").filter((l) => /^\| \d+ \|$/.test(l));
  assert.equal(dataRows.length, 5);
  assert.ok(/45 more row\(s\)/.test(md), "notes the omitted rows");
});
