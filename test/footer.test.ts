import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { type FooterData, type FooterTheme, footerLine } from "../lib/ui/footer.ts";

// Pass-through theme: styling is identity, so visibleWidth == raw length.
const theme: FooterTheme = { fg: (_color, text) => text };

const full: FooterData = {
  connection: "BERDL off-cluster",
  ready: true,
  project: "microbial-discovery",
  phase: "analyze",
  context: { tokens: 1000, percent: 38 },
  model: "opus-4.8",
};

test("footer composes all segments with the model right-aligned", () => {
  const line = footerLine(theme, full, 90);
  assert.ok(line.includes("BERDL off-cluster ✓"), "connection + ok glyph");
  assert.ok(line.includes("▣ microbial-discovery"), "project");
  assert.ok(line.includes("▸ analyze"), "phase");
  assert.ok(line.includes("ctx 38%"), "context percent");
  assert.ok(line.trimEnd().endsWith("opus-4.8"), "model is right-aligned at the end");
  assert.ok(visibleWidth(line) <= 90, "fits the width");
});

test("not-ready connection shows the ✗ glyph", () => {
  const line = footerLine(theme, { connection: "BERDL off-cluster", ready: false }, 40);
  assert.ok(line.includes("BERDL off-cluster ✗"));
});

test("footer never exceeds the width, even when narrow", () => {
  for (const width of [8, 20, 40]) {
    assert.ok(visibleWidth(footerLine(theme, full, width)) <= width, `width ${width}`);
  }
});

test("empty data renders an empty line", () => {
  assert.equal(footerLine(theme, {}, 40), "");
});
