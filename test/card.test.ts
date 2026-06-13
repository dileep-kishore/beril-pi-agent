import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { type CardTheme, frameCard, sectionDivider } from "../lib/ui/card.ts";

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
  assert.ok(
    lines.some((l) => /Ctrl\+O/.test(l)),
    "the footer tells the user how to expand",
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

test("accentStyle paints the title, while the border stays neutral", () => {
  // A styler that injects a zero-width marker so we can see where it was applied.
  const mark = "​";
  const styled = (s: string) => `${mark}${s}${mark}`;
  const lines = frameCard(fakeTheme, { title: "Data", accentStyle: styled, body: ["row"] }, 40);
  assert.ok(lines[0].includes(mark), "the title (on the top border) is painted by accentStyle");
  assert.ok(!lines.at(-1)?.includes(mark), "the bottom border is NOT painted by accentStyle (it recedes)");
  // The marker is zero-width, so the frame stays exactly `width` columns.
  for (const line of lines) assert.equal(visibleWidth(line), 40);
});

test("labeled sections render width-exact with a divider row", () => {
  for (const width of [20, 40, 80]) {
    const lines = frameCard(
      fakeTheme,
      {
        title: "Evidence",
        body: ["intro"],
        sections: [
          { label: "A", lines: ["x"] },
          { label: "B", lines: ["y"] },
        ],
      },
      width,
    );
    for (const line of lines) assert.equal(visibleWidth(line), width, `line "${line}" should be ${width} wide`);
    assert.ok(
      lines.some((l) => l.includes("┤")),
      "a section divider row is present",
    );
  }
});

test("sectionDivider re-paints the trailing structure after a pre-colored label", () => {
  // A pre-colored label (as science cards pass via roleStyle/theme.fg) ends in an
  // fg reset; the divider must re-establish the border colour after it so the
  // trailing dashes + ┤ don't fall back to the terminal-default colour.
  const ESC = "\x1b";
  const border = (s: string) => `${ESC}[2m${s}${ESC}[22m`; // dim on/off (ANSI → zero visible width)
  const label = `${ESC}[32mSupports${ESC}[39m`; // pre-colored, ends in an fg-only reset
  const row = sectionDivider(border, label, 40);
  assert.ok(row.includes(label), "the pre-colored label is emitted untouched");
  assert.ok(row.startsWith(`${ESC}[2m├─ ${ESC}[22m`), "the leading ├─ is painted by the border");
  // The fragment after the label re-opens the border paint and ends with ┤ + its close.
  const afterLabel = row.slice(row.indexOf(label) + label.length);
  assert.ok(afterLabel.includes(`${ESC}[2m`), "trailing structure re-opens the border paint");
  assert.ok(afterLabel.endsWith(`┤${ESC}[22m`), "trailing dashes + ┤ are re-painted by the border");
  assert.equal(visibleWidth(row), 40, "still exactly width");
});

test("state sets the border colour and stays width-exact (no accent)", () => {
  const lines = frameCard(fakeTheme, { title: "Failed", body: ["boom"], state: "error" }, 40);
  for (const line of lines) assert.equal(visibleWidth(line), 40);
});

test("headerMeta renders after the title and stays width-exact", () => {
  for (const width of [20, 40, 80]) {
    const lines = frameCard(fakeTheme, { title: "Query", body: ["row"], headerMeta: "3 rows" }, width);
    for (const line of lines) assert.equal(visibleWidth(line), width, `line "${line}" should be ${width} wide`);
  }
  const lines = frameCard(fakeTheme, { title: "Query", body: ["row"], headerMeta: "3 rows" }, 40);
  assert.ok(lines[0].includes("3 rows"), "top line includes the header meta");
});
