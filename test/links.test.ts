import assert from "node:assert/strict";
import { test } from "node:test";
import { hyperlink, supportsHyperlinks } from "../lib/ui/links.ts";

test("a supported terminal wraps text in an OSC-8 link", () => {
  const out = hyperlink("PMID 123", "https://pubmed.ncbi.nlm.nih.gov/123/", { TERM: "xterm-256color" });
  assert.ok(out.includes("\x1b]8;;https://pubmed.ncbi.nlm.nih.gov/123/"), "opens the link to the url");
  assert.ok(out.includes("PMID 123"), "keeps the visible text");
  assert.ok(out.endsWith("\x1b]8;;\x07"), "closes the link");
});

test("links are suppressed for dumb/no-color/empty terminals and missing urls", () => {
  assert.equal(hyperlink("t", "https://x", { TERM: "dumb" }), "t");
  assert.equal(hyperlink("t", "https://x", { TERM: "xterm", NO_COLOR: "1" }), "t");
  assert.equal(hyperlink("t", "https://x", {}), "t");
  assert.equal(hyperlink("t", undefined, { TERM: "xterm" }), "t");
});

test("supportsHyperlinks gates on TERM and NO_COLOR", () => {
  assert.equal(supportsHyperlinks({ TERM: "xterm-256color" }), true);
  assert.equal(supportsHyperlinks({ TERM: "dumb" }), false);
  assert.equal(supportsHyperlinks({ NO_COLOR: "1", TERM: "xterm" }), false);
});
