import assert from "node:assert/strict";
import { test } from "node:test";
import { cardHeader } from "../lib/ui/status-line-header.ts";

// A pass-through theme: styling is identity, so the structural text is easy to assert.
const stubTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Parameters<typeof cardHeader>[0];

test("header contains the title", () => {
  const out = cardHeader(stubTheme, { title: "Evidence" });
  assert.ok(out.includes("Evidence"), "title appears in the header");
});

test("summary is rendered after a colon", () => {
  const out = cardHeader(stubTheme, { title: "Evidence", summary: "sum" });
  assert.ok(out.includes(": sum"), 'summary appears as ": sum"');
});

test("meta entries are joined with a bullet separator", () => {
  const out = cardHeader(stubTheme, { title: "Evidence", meta: ["a", "b"] });
  assert.ok(out.includes("a · b"), 'meta appears as "a · b"');
});

test("a newline in the title is flattened away", () => {
  const out = cardHeader(stubTheme, { title: "line one\nline two" });
  assert.ok(!out.includes("\n"), "no newline survives in the output");
});
