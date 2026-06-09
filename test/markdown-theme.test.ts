import assert from "node:assert/strict";
import { test } from "node:test";
import { type ThemeStyler, markdownTheme } from "../lib/ui/markdown-theme.ts";

// Records which fg token each markdown slot maps to.
function recordingTheme(): { styler: ThemeStyler; fgCalls: string[] } {
  const fgCalls: string[] = [];
  const styler: ThemeStyler = {
    fg: (color, text) => {
      fgCalls.push(color);
      return text;
    },
    bold: (t) => `**${t}**`,
    italic: (t) => `_${t}_`,
    strikethrough: (t) => `~${t}~`,
    underline: (t) => t,
  };
  return { styler, fgCalls };
}

test("each markdown slot maps to its matching md* theme token", () => {
  const { styler, fgCalls } = recordingTheme();
  const md = markdownTheme(styler);
  md.heading("h");
  md.link("l");
  md.code("c");
  md.listBullet("•");
  assert.deepEqual(fgCalls, ["mdHeading", "mdLink", "mdCode", "mdListBullet"]);
});

test("emphasis slots delegate to the theme's text stylers", () => {
  const { styler } = recordingTheme();
  const md = markdownTheme(styler);
  assert.equal(md.bold("x"), "**x**");
  assert.equal(md.italic("x"), "_x_");
  assert.equal(md.strikethrough("x"), "~x~");
});

test("provides a syntax highlighter for code fences", () => {
  const { styler } = recordingTheme();
  assert.equal(typeof markdownTheme(styler).highlightCode, "function");
});
