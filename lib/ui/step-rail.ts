import type { Theme } from "@earendil-works/pi-coding-agent";
import { RESEARCH_STEPS, stepIndex } from "../research-steps.ts";
import { GLYPH } from "./glyphs.ts";
import { roleStyle } from "./palette.ts";

/**
 * The shared step rail for the research arc `explore → plan → analyze → review →
 * submit`, used by both the workflow HUD and the welcome panel so the two never
 * drift. Done steps read dim with a `✓`, the current step is bold + info-colored
 * with a `▸` "you are here", and future steps are muted with a `○` pending mark —
 * the glyph>word>color channel ordering the unified theme uses everywhere.
 *
 * Needs both `Theme.fg`/`Theme.bold` and `getColorMode` (for `roleStyle`), so the
 * theme param is the real `Theme` — the pass-through stubs in tests satisfy it.
 */
export function stepRail(theme: Theme, state: string | undefined): string {
  const idx = state ? stepIndex(state) : -1;
  const sep = theme.fg("dim", ` ${GLYPH.arrow} `);
  return RESEARCH_STEPS.map((step, i) => {
    if (idx === RESEARCH_STEPS.length) return theme.fg("dim", `${GLYPH.ok} ${step}`); // complete: all behind us
    if (i === idx) return theme.bold(roleStyle(theme, "info")(`${GLYPH.here} ${step}`));
    if (idx >= 0 && i < idx) return theme.fg("dim", `${GLYPH.ok} ${step}`);
    return theme.fg("muted", `${GLYPH.pending} ${step}`);
  }).join(sep);
}
