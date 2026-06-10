import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { GLYPH } from "../lib/ui/glyphs.ts";
import { stepRail } from "../lib/ui/step-rail.ts";

const theme = {
  fg: (_c: string, s: string) => s,
  bold: (s: string) => s,
  getColorMode: () => "truecolor",
} as unknown as Theme;

test("step rail marks done / current / future for an active project", () => {
  const rail = stepRail(theme, "active");
  // analyze is the current step.
  assert.ok(rail.includes(`${GLYPH.here} analyze`), "analyze is current (▸)");
  // explore and plan are done.
  assert.ok(rail.includes(`${GLYPH.ok} explore`), "explore is done (✓)");
  assert.ok(rail.includes(`${GLYPH.ok} plan`), "plan is done (✓)");
  // submit is still ahead.
  assert.ok(rail.includes(`${GLYPH.pending} submit`), "submit is future (○)");
});
