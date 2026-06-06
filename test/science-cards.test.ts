import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { formatLitMarkdown, peekMarkdown, queryCard } from "../lib/ui/science-cards.ts";

// Pass-through theme so rendered widths are easy to assert (no ANSI inflation).
const theme = {
  fg: (_c: string, s: string) => s,
  bold: (s: string) => s,
  italic: (s: string) => s,
  strikethrough: (s: string) => s,
  underline: (s: string) => s,
} as unknown as Theme;

test("formatLitMarkdown renders a bullet with authors, venue, and a PMID link", () => {
  const md = formatLitMarkdown(
    [{ pmid: "123", title: "A study", journal: "Nature", year: "2024", authors: ["Ng A", "Lee B"] }],
    10,
  );
  assert.ok(md.includes("**A study**"), "bold title");
  assert.ok(md.includes("Ng A, Lee B"), "authors");
  assert.ok(md.includes("*Nature* (2024)"), "venue");
  assert.ok(md.includes("pubmed.ncbi.nlm.nih.gov/123"), "PMID link");
});

test("formatLitMarkdown truncates >3 authors with et al. and notes overflow", () => {
  const records = Array.from({ length: 8 }, (_, i) => ({
    title: `T${i}`,
    authors: ["A", "B", "C", "D"],
  }));
  const md = formatLitMarkdown(records, 5);
  assert.ok(md.includes("A, B, C et al."), "author list capped at 3 + et al.");
  assert.ok(/3 more/.test(md), "notes the 3 omitted of 8");
});

test("formatLitMarkdown falls back gracefully for empty/sparse records", () => {
  assert.equal(formatLitMarkdown([], 5), "_(no results)_");
  assert.ok(formatLitMarkdown([{}], 5).includes("(untitled)"));
});

test("peekMarkdown has Columns and Sample sections, tolerating emptiness", () => {
  const md = peekMarkdown([{ col: "gene", type: "string" }], [{ gene: "recA" }]);
  assert.ok(md.includes("**Columns**"));
  assert.ok(md.includes("**Sample**"));
  assert.ok(md.includes("| col | type |"));
  const empty = peekMarkdown([], []);
  assert.ok(empty.includes("schema unavailable"));
  assert.ok(empty.includes("no sample rows"));
});

test("queryCard renders a framed, width-exact data card", () => {
  const card = queryCard(theme, { returned_rows: 2, rows: [{ a: 1 }, { a: 2 }], limit_applied: 100 }, false);
  const lines = card.render(60);
  for (const line of lines) assert.equal(visibleWidth(line), 60);
  assert.ok(lines[0].includes("Query · 2 rows · limit 100"), "title reflects the row count + limit");
});

test("queryCard shows a no-rows card when the result is empty", () => {
  const card = queryCard(theme, { returned_rows: 0, rows: [], limit_applied: null }, false);
  const lines = card.render(40);
  assert.ok(lines.some((l) => l.includes("no rows returned")));
});
