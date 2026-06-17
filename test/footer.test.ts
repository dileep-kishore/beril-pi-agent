import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { type FooterData, type FooterTheme, footerLines } from "../lib/ui/footer.ts";

// Pass-through theme: styling is identity, so visibleWidth == raw length.
const theme: FooterTheme = { fg: (_color, text) => text };

const full: FooterData = {
  brand: "BERIL",
  connection: "BERDL off-cluster",
  ready: true,
  cwd: "beril-pi-agent",
  branch: "main",
  project: "microbial-discovery",
  phase: "analyze",
  claims: { total: 3, supported: 2, refuted: 1 },
  context: { tokens: 12_300, percent: 38, contextWindow: 200_000 },
  model: "opus-4.8",
  orcid: true,
};

test("footer is a single chevron-grouped line carrying every segment", () => {
  const lines = footerLines(theme, full, 160);
  assert.equal(lines.length, 1, "one statusline");
  const line = lines[0];
  assert.ok(line.includes("BERIL"), "product brand");
  assert.ok(line.includes("BERDL off-cluster ✓"), "BERDL connection layer + ok glyph");
  assert.ok(line.includes("beril-pi-agent (main)"), "working dir + git branch");
  assert.ok(line.includes("◆ microbial-discovery"), "project");
  assert.ok(line.includes("▸ analyze"), "phase");
  assert.ok(line.includes("3 claims") && line.includes("2✓") && line.includes("1⊖"), "claim tally");
  assert.ok(line.includes("ctx") && line.includes("38%"), "context percent");
  assert.ok(line.includes("12.3k") && line.includes("200.0k"), "tokens + window");
  assert.ok(line.includes("ORCID ✓"), "researcher chip");
  assert.ok(line.includes("opus-4.8"), "model");
  assert.ok(line.includes("›"), "groups joined by a chevron");
});

test("claims/branch/orcid are omitted when absent (no empty chrome)", () => {
  const line = footerLines(
    theme,
    { connection: "BERDL off-cluster", ready: true, cwd: "beril-pi-agent", model: "x" },
    120,
  )[0];
  assert.ok(!line.includes("("), "no empty (branch)");
  assert.ok(!line.includes("claim"), "no claim tally");
  assert.ok(!line.includes("ORCID"), "no researcher chip");
});

test("not-ready connection shows the △ warn glyph (not a failure ✗)", () => {
  const lines = footerLines(theme, { connection: "BERDL off-cluster", ready: false }, 40);
  assert.ok(lines[0].includes("BERDL off-cluster △"));
  assert.ok(!lines[0].includes("✗"));
});

test("a bare session (no project) still shows one informative line", () => {
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
  assert.equal(lines.length, 1, "a single statusline");
  assert.ok(lines[0].includes("BERDL off-cluster ✓") && lines[0].includes("beril-pi-agent"));
  assert.ok(lines[0].includes("ctx") && lines[0].includes("gpt-5.5"));
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
