import type { Theme } from "@earendil-works/pi-coding-agent";
import { RESEARCH_STEPS, stepIndex } from "../research-steps.ts";
import { GLYPH } from "./glyphs.ts";

/**
 * The shared step rail for the research arc `explore → plan → analyze → review →
 * submit`, used by both the workflow HUD and the welcome panel so the two never
 * drift. Done steps read dim with a `✔`, the current step is bold + accent-colored
 * with a `▸` "you are here", and future steps are muted with a `○` pending mark —
 * the glyph>word>color channel ordering the unified theme uses everywhere. The
 * current-step accent matches the statusline so "where you are" is one colour
 * (aqua) across the whole UI.
 */
export function stepRail(theme: Pick<Theme, "fg" | "bold">, state: string | undefined): string {
  const idx = state ? stepIndex(state) : -1;
  const sep = theme.fg("dim", ` ${GLYPH.arrow} `);
  return RESEARCH_STEPS.map((step, i) => {
    if (idx === RESEARCH_STEPS.length) return theme.fg("dim", `${GLYPH.ok} ${step}`); // complete: all behind us
    if (i === idx) return theme.bold(theme.fg("accent", `${GLYPH.here} ${step}`));
    if (idx >= 0 && i < idx) return theme.fg("dim", `${GLYPH.ok} ${step}`);
    return theme.fg("muted", `${GLYPH.pending} ${step}`);
  }).join(sep);
}
