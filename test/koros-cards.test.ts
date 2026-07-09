import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { commonsCard, figuresCard, gateReferenceCard, sysErrorCard, validationCard } from "../lib/ui/koros-cards.ts";

// Pass-through theme (no ANSI inflation), matching science-cards.test.ts.
const theme = {
  fg: (_c: string, s: string) => s,
  bold: (s: string) => s,
  italic: (s: string) => s,
  strikethrough: (s: string) => s,
  underline: (s: string) => s,
  getColorMode: () => "truecolor",
} as unknown as Theme;

const widthExact = (lines: string[], width: number) => {
  for (const line of lines) assert.equal(visibleWidth(line), width);
};

test("validationCard renders a width-exact card with the verdict and findings", () => {
  const lines = validationCard(theme, {
    n_rows: 120,
    columns: [{ name: "ph", dtype: "float", null_frac: 0.02, distinct: 88, flags: ["zero-sentinel"] }],
    findings: [
      { check: "zero-sentinel", severity: "warn", column: "ph", detail: "34% exact zeros — 0 may mean not-measured" },
    ],
    verdict: "warn",
  }).render(60);
  widthExact(lines, 60);
  const text = lines.join("\n");
  assert.ok(text.includes("Data validity"));
  assert.ok(text.includes("warn"));
  assert.ok(text.includes("ph"));
});

test("validationCard on a clean pass says so, never blank", () => {
  const text = validationCard(theme, { n_rows: 10, columns: [], findings: [], verdict: "pass" }).render(50).join("\n");
  assert.ok(text.includes("no traps found"));
});

test("commonsCard is reuse-framed and never says 'don't redo'", () => {
  for (const verdict of ["novel", "related", "overlap"] as const) {
    const lines = commonsCard(theme, {
      verdict,
      matches: [
        {
          score: 0.42,
          kind: "gap",
          project: "selection-2026",
          body: "codon-usage bias unexplored",
          created: "2026-07-01",
        },
      ],
    }).render(60);
    widthExact(lines, 60);
    const text = lines.join("\n");
    assert.ok(!/don'?t redo/i.test(text), `${verdict} avoids prohibition framing`);
    assert.ok(text.includes("open gap"), "gap matches are distinctly actionable");
  }
});

test("figuresCard lists figure basenames and points at /figures", () => {
  const lines = figuresCard(theme, ["/proj/figures/f1.png", "/proj/figures/f2.svg"]).render(60);
  const text = lines.join("\n");
  assert.ok(text.includes("f1.png") && text.includes("f2.svg"), "basenames shown");
  assert.ok(text.includes("/figures"), "points at the open command");
  const empty = figuresCard(theme, []).render(60).join("\n");
  assert.ok(empty.includes("no new figures"));
});

test("sysErrorCard reads as infrastructure, distinct from science", () => {
  const lines = sysErrorCard(theme, {
    kind: "rate-limit",
    detail: "The API rate limit was hit. Wait a moment, then retry.",
  }).render(60);
  widthExact(lines, 60);
  const text = lines.join("\n");
  assert.ok(text.includes("Infrastructure"));
  assert.ok(text.includes("not a scientific result"));
});

test("gateReferenceCard renders the catalog and merges a recorded verdict", () => {
  const lines = gateReferenceCard(theme, [{ gate: "data-validity", verdict: "pass", by: "0000-0001", at: "1" }]).render(
    72,
  );
  widthExact(lines, 72);
  const text = lines.join("\n");
  assert.ok(text.includes("Gates"));
  assert.ok(text.includes("data-validity"));
  assert.ok(text.includes("pass"));
});
