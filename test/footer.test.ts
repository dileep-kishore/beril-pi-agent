import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { type FooterData, type FooterTheme, footerLines } from "../lib/ui/footer.ts";

// Pass-through theme: styling is identity, so visibleWidth == raw length.
const theme: FooterTheme = { fg: (_color, text) => text };

const full: FooterData = {
  connection: "BERDL off-cluster",
  ready: true,
  cwd: "beril-pi-agent",
  project: "microbial-discovery",
  phase: "analyze",
  context: { tokens: 12_300, percent: 38, contextWindow: 200_000 },
  model: "opus-4.8",
};

test("footer is two lines: environment on top, work below", () => {
  const lines = footerLines(theme, full, 120);
  assert.equal(lines.length, 2);
  // Line 1 — environment.
  assert.ok(lines[0].includes("BERDL off-cluster ✓"), "connection + ok glyph");
  assert.ok(lines[0].includes("beril-pi-agent"), "working dir");
  // Line 2 — work: project, phase, a context gauge with % + tokens + window, model.
  assert.ok(lines[1].includes("▣ microbial-discovery"), "project");
  assert.ok(lines[1].includes("▸ analyze"), "phase");
  assert.ok(lines[1].includes("ctx") && lines[1].includes("38%"), "context percent");
  assert.ok(lines[1].includes("12.3k"), "absolute tokens");
  assert.ok(lines[1].includes("/ 200.0k"), "context window");
  assert.ok(lines[1].includes("opus-4.8"), "model");
});

test("not-ready connection shows the ✗ glyph", () => {
  const lines = footerLines(theme, { connection: "BERDL off-cluster", ready: false }, 40);
  assert.ok(lines[0].includes("BERDL off-cluster ✗"));
});

test("a bare session (no project) still shows two informative lines", () => {
  const lines = footerLines(
    theme,
    {
      connection: "BERDL off-cluster",
      ready: true,
      cwd: "beril-pi-agent",
      context: { tokens: 4000, percent: 4, contextWindow: 200_000 },
      model: "gpt-5.5",
    },
    120,
  );
  assert.equal(lines.length, 2, "environment line + context/model line");
  assert.ok(lines[0].includes("BERDL off-cluster ✓") && lines[0].includes("beril-pi-agent"));
  assert.ok(lines[1].includes("ctx") && lines[1].includes("gpt-5.5"));
});

test("no line ever exceeds the width, even when narrow", () => {
  for (const width of [8, 20, 40, 80]) {
    for (const line of footerLines(theme, full, width)) {
      assert.ok(visibleWidth(line) <= width, `width ${width}: "${line}"`);
    }
  }
});

test("empty data renders no lines", () => {
  assert.deepEqual(footerLines(theme, {}, 40), []);
});
