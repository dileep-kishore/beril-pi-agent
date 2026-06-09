import assert from "node:assert/strict";
import { test } from "node:test";
import { type ColorModeTheme, domainHex, domainStyle, hexFg } from "../lib/ui/palette.ts";

const truecolor: ColorModeTheme = { getColorMode: () => "truecolor" };
const palette256: ColorModeTheme = { getColorMode: () => "256color" };

test("hexFg emits a truecolor escape for the exact rgb and resets fg only", () => {
  const out = hexFg(truecolor, "#36c5d0", "x"); // 0x36,0xc5,0xd0 = 54,197,208
  assert.ok(out.includes("\x1b[38;2;54;197;208m"), "has truecolor open");
  assert.ok(out.includes("x"), "keeps the text");
  assert.ok(out.endsWith("\x1b[39m"), "resets fg (not all attrs) so bold composes");
});

test("hexFg downgrades to the 256-colour cube when not truecolor", () => {
  const out = hexFg(palette256, "#36c5d0", "x");
  assert.match(out, /38;5;\d{1,3}m/, `has 256 open: ${JSON.stringify(out)}`);
  assert.ok(!out.includes("38;2;"), "no truecolor escape in 256 mode");
});

test("domainHex returns a stable per-domain hue (incl. the violet plan has no theme key for)", () => {
  assert.equal(domainHex("plan"), "#b08cff");
  assert.equal(domainHex("data"), "#36c5d0");
  assert.notEqual(domainHex("literature"), domainHex("data"));
});

test("domainStyle returns a styler that colours its argument", () => {
  const style = domainStyle(truecolor, "literature");
  const out = style("lit");
  assert.ok(out.includes("lit"));
  assert.ok(out.includes("\x1b[38;2;"), "applies a truecolor fg");
});

test("256-downgrade never emits an out-of-range color index (>255)", () => {
  // 0xff channels used to push the 6×6×6 cube term to 6 → an invalid 38;5;>255 escape.
  for (const hex of ["#ffffff", "#ff0000", "#00ff00", "#0000ff", "#5f87ff", "#b08cff"]) {
    const out = hexFg(palette256, hex, "x");
    const idx = Number(out.match(/38;5;(\d+)m/)?.[1]);
    assert.ok(idx >= 16 && idx <= 255, `${hex} → ${idx} must be in [16,255]`);
  }
});
