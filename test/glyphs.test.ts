import assert from "node:assert/strict";
import { test } from "node:test";
import { GLYPH, glyph } from "../lib/ui/glyphs.ts";

test("every GLYPH key has an ASCII fallback entry", () => {
  // ASCII is private; glyph() in ascii tier proves the entry exists and is non-empty.
  const prev = process.env.BERIL_GLYPHS;
  process.env.BERIL_GLYPHS = "ascii";
  try {
    for (const key of Object.keys(GLYPH) as (keyof typeof GLYPH)[]) {
      assert.ok(glyph(key).length > 0, `missing ASCII entry for ${key}`);
    }
  } finally {
    if (prev === undefined) Reflect.deleteProperty(process.env, "BERIL_GLYPHS");
    else process.env.BERIL_GLYPHS = prev;
  }
});

test("glyph() returns the unicode mark by default", () => {
  const prevNoColor = process.env.NO_COLOR;
  const prevGlyphs = process.env.BERIL_GLYPHS;
  try {
    Reflect.deleteProperty(process.env, "NO_COLOR");
    Reflect.deleteProperty(process.env, "BERIL_GLYPHS");
    assert.equal(glyph("ok"), GLYPH.ok);
  } finally {
    if (prevNoColor === undefined) Reflect.deleteProperty(process.env, "NO_COLOR");
    else process.env.NO_COLOR = prevNoColor;
    if (prevGlyphs === undefined) Reflect.deleteProperty(process.env, "BERIL_GLYPHS");
    else process.env.BERIL_GLYPHS = prevGlyphs;
  }
});
