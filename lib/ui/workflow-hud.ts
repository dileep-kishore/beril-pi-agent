import type { Theme } from "@earendil-works/pi-coding-agent";
import { RESEARCH_STEPS, nextAction, stepIndex } from "../research-steps.ts";
import { GLYPH } from "./glyphs.ts";

/**
 * The always-visible "workflow HUD" shown above the editor: where the active
 * project sits in `explore → plan → analyze → review → submit`, and what to do
 * next. This is the answer to the scientists' "I've lost track of where we are"
 * — a persistent map of the research arc rather than status buried in the scroll.
 *
 * Connection and project now live in the statusline (`footer.ts`), so the HUD is
 * just the phase rail + the single most useful next action — no longer a second
 * copy of the footer. Pure: takes the current state + a theme and returns the
 * widget's lines (the `beril-env` extension owns the state and the `setWidget`
 * call). Unit-tested with a pass-through theme.
 */
export interface HudState {
  /** Full connection label for the `setStatus` chip (RPC fallback), e.g. "BERDL off-cluster ✓ ready". */
  connection?: string;
  /** Compact connection label for the statusline, e.g. "BERDL off-cluster". */
  location?: string;
  ready?: boolean;
  /** Active project id, when one is known. */
  project?: string;
  /** Lifecycle state of the active project; undefined before a project exists. */
  state?: string;
  /** Set once the active project has been submitted, to mark the arc done. */
  submitted?: boolean;
}

type HudTheme = Pick<Theme, "fg" | "bold">;

/** The step rail: done steps dim, the current step accented, future steps muted. */
function stepRail(theme: HudTheme, state: string | undefined): string {
  const idx = state ? stepIndex(state) : -1;
  const sep = theme.fg("dim", ` ${GLYPH.arrow} `);
  return RESEARCH_STEPS.map((step, i) => {
    if (idx === RESEARCH_STEPS.length) return theme.fg("dim", `${step}`); // complete: all behind us
    if (i === idx) return theme.bold(theme.fg("accent", `${GLYPH.here} ${step}`));
    if (idx >= 0 && i < idx) return theme.fg("dim", step);
    return theme.fg("muted", step);
  }).join(sep);
}

/** Build the workflow HUD lines. Always shows a next-action hint; adds the rail once a project exists. */
export function workflowHud(theme: HudTheme, s: HudState): string[] {
  const lines: string[] = [];

  if (s.project || s.state) {
    const rail = stepRail(theme, s.state);
    lines.push(s.submitted ? `${rail}   ${theme.fg("success", `${GLYPH.up} submitted`)}` : rail);
  }

  // The "what's next" hint always shows (a getting-started nudge before any project).
  lines.push(theme.fg("muted", `Next: ${nextAction(s.state ?? "")}`));
  return lines;
}
