import assert from "node:assert/strict";
import { test } from "node:test";
import { capPreviewLines, expandHint, moreItems, sanitizeLine } from "../lib/ui/render-utils.ts";

const stub = { fg: (_c: string, s: string) => s } as never;

test("moreItems pluralizes", () => {
  assert.equal(moreItems(1, "line"), "… 1 more line");
  assert.equal(moreItems(3, "row"), "… 3 more rows");
});

test("expandHint shows only when collapsed with more", () => {
  assert.notEqual(expandHint(stub, false, true), "");
  assert.equal(expandHint(stub, true, true), "");
});

test("capPreviewLines keeps head+tail with a middle marker", () => {
  const lines = Array.from({ length: 10 }, (_, i) => String(i + 1));
  const capped = capPreviewLines(lines, 4);
  assert.equal(capped.length, 5);
  assert.ok(capped.some((l) => l.includes("more lines")));
});

test("sanitizeLine converts tabs to two spaces", () => {
  assert.equal(sanitizeLine("a\tb"), "a  b");
});
