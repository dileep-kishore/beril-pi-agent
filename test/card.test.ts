import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { type CardTheme, frameCard } from "../lib/ui/card.ts";

// A pass-through theme: styling is identity, so visibleWidth == raw length and the
// border math is easy to assert. Accepts any ThemeColor.
const fakeTheme: CardTheme = {
  fg: (_color, text) => text,
  bold: (text) => text,
};

test("every framed line is exactly `width` visible columns", () => {
  for (const width of [12, 20, 40, 80]) {
    const lines = frameCard(fakeTheme, { title: "Data", body: ["row one", "row two"] }, width);
    for (const line of lines) {
      assert.equal(visibleWidth(line), width, `line "${line}" should be ${width} wide`);
    }
  }
});

test("card has a titled top border and a closing bottom border", () => {
  const lines = frameCard(fakeTheme, { title: "Query · 3 rows", body: ["a"] }, 40);
  assert.ok(lines[0].startsWith("╭"), "top starts with ╭");
  assert.ok(lines[0].includes("Query · 3 rows"), "title appears on the top border");
  assert.ok(lines.at(-1)?.startsWith("╰"), "bottom starts with ╰");
  assert.ok(lines.at(-1)?.endsWith("╯"), "bottom ends with ╯");
});

test("body lines are padded by VISIBLE width, ignoring ANSI", () => {
  // 3 visible chars wrapped in colour codes — padding must use visibleWidth(=3), not raw length.
  const ansi = "\x1b[31mred\x1b[0m";
  const lines = frameCard(fakeTheme, { title: "T", body: [ansi] }, 30);
  for (const line of lines) assert.equal(visibleWidth(line), 30);
});

test("maxBodyLines collapses overflow into a muted footer", () => {
  const body = Array.from({ length: 10 }, (_, i) => `line ${i}`);
  const lines = frameCard(fakeTheme, { title: "T", body, maxBodyLines: 4 }, 40);
  // 4 body rows (3 shown + 1 "more") + 2 borders.
  assert.equal(lines.length, 6);
  assert.ok(
    lines.some((l) => /more line\(s\)/.test(l)),
    "shows a more-lines footer",
  );
});

test("a very long title is truncated but the border stays width-exact", () => {
  const lines = frameCard(fakeTheme, { title: "x".repeat(200), body: ["b"] }, 30);
  for (const line of lines) assert.equal(visibleWidth(line), 30);
  assert.ok(lines[0].includes("─╮"), "filler dashes + corner remain after a long title");
});

test("never throws and stays width-exact at the minimum width", () => {
  const lines = frameCard(fakeTheme, { title: "wide title here", body: ["content"] }, 4);
  // width clamps up to the floor; all lines share one consistent width.
  const w = visibleWidth(lines[0]);
  for (const line of lines) assert.equal(visibleWidth(line), w);
});

test("accentStyle overrides the theme accent for the border + title", () => {
  // A styler that injects a zero-width marker so we can see where it was applied.
  const mark = "​";
  const styled = (s: string) => `${mark}${s}${mark}`;
  const lines = frameCard(fakeTheme, { title: "Data", accentStyle: styled, body: ["row"] }, 40);
  assert.ok(lines[0].includes(mark), "top border is painted by accentStyle");
  assert.ok(lines.at(-1)?.includes(mark), "bottom border is painted by accentStyle");
  // The marker is zero-width, so the frame stays exactly `width` columns.
  for (const line of lines) assert.equal(visibleWidth(line), 40);
});
