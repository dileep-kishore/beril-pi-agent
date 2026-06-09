import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  confidenceFooter,
  discoverCard,
  envCard,
  errorCard,
  evidenceCard,
  formatLitMarkdown,
  kvLines,
  peekMarkdown,
  queryCard,
  toolErrorText,
} from "../lib/ui/science-cards.ts";

// Pass-through theme so rendered widths are easy to assert (no ANSI inflation).
// `getColorMode` is required by the per-domain `palette.ts` styler.
const theme = {
  fg: (_c: string, s: string) => s,
  bold: (s: string) => s,
  italic: (s: string) => s,
  strikethrough: (s: string) => s,
  underline: (s: string) => s,
  getColorMode: () => "truecolor",
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

test("discoverCard renders a structured, width-exact list (not JSON)", () => {
  const card = discoverCard(
    theme,
    { tenants: [{ id: "kbase", name: "KBase", collections: [{ id: "kbase.x", name: "X", tables: [] }] }] },
    false,
  );
  const lines = card.render(60);
  for (const line of lines) assert.equal(visibleWidth(line), 60);
  const text = lines.join("\n");
  assert.ok(text.includes("Collections · 1 tenant · 1 database"), "summary title");
  assert.ok(text.includes("KBase") && text.includes("X"));
  assert.ok(!text.includes('"tables"'), "no JSON keys");
});

test("envCard surfaces readiness, checks, and next steps", () => {
  const card = envCard(theme, {
    location: "off-cluster",
    ready: false,
    checks: { token: true, tunnels: false },
    next_steps: ["open the SSH tunnels"],
  });
  const text = card.render(60).join("\n");
  assert.ok(text.includes("BERDL · off-cluster"), "title");
  assert.ok(text.includes("not ready"), "status");
  assert.ok(text.includes("token") && text.includes("tunnels"), "per-check lines");
  assert.ok(text.includes("open the SSH tunnels"), "next steps when not ready");
});

test("toolErrorText joins text content parts and ignores non-text/empty", () => {
  assert.equal(toolErrorText({ content: [{ type: "text", text: "boom" }] }), "boom");
  assert.equal(toolErrorText({ content: [{ type: "image" }, { type: "text", text: "x" }] }), "x");
  assert.equal(toolErrorText({}), "");
});

test("errorCard frames the real error message (width-exact), not a success card", () => {
  const card = errorCard(theme, "NCBI request failed: 429 Too Many Requests");
  const lines = card.render(60);
  for (const line of lines) assert.equal(visibleWidth(line), 60);
  const text = lines.join("\n");
  assert.ok(text.includes("Error"), "titled Error");
  assert.ok(text.includes("429"), "carries the real message, not 'undefined'");
});

test("errorCard degrades to a generic message when the error text is empty", () => {
  const text = errorCard(theme, "").render(60).join("\n");
  assert.ok(text.includes("failed"), "shows a fallback rather than a blank card");
});

test("kvLines renders labeled scalar fields and skips nested objects", () => {
  const lines = kvLines(theme, { path: "s3a://x", count: 42, nested: { a: 1 }, missing: null });
  const text = lines.join("\n");
  assert.ok(text.includes("path") && text.includes("s3a://x"));
  assert.ok(text.includes("count") && text.includes("42"));
  assert.ok(text.includes("missing") && text.includes("—"), "null renders as em-dash");
  assert.ok(!text.includes("nested"), "object-valued keys are skipped");
});

test("evidenceCard renders with empty refutes (shows 'none found')", () => {
  const card = evidenceCard(theme, {
    claim: "core genes under stronger purifying selection",
    status: "supported",
    confidence: "high",
    supports: [{ kind: "notebook", locator: "02.ipynb", exact: "dN/dS=0.08", relevance: "main result" }],
    refutes: [],
    refutesSearched: "accessory-gene dN/dS",
  });
  assert.ok(card);
});

test("confidenceFooter is a string with the tier", () => {
  assert.match(confidenceFooter(theme, "medium", "n=37"), /confidence: medium/);
});
