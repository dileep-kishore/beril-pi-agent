import type { Theme } from "@earendil-works/pi-coding-agent";
import { RESEARCH_STEPS, nextAction, stepIndex } from "../research-steps.ts";

/**
 * The always-visible "workflow HUD" shown above the editor: where the active
 * project sits in `explore → plan → analyze → review → submit`, and what to do
 * next. This is the answer to the scientists' "I've lost track of where we are"
 * — a persistent map of the research arc rather than status buried in the scroll.
 *
 * Pure: takes the current state + a theme and returns the widget's lines (the
 * `beril-env` extension owns the state and the `setWidget` call). Unit-tested
 * with a pass-through theme.
 */
export interface HudState {
  /** Connection label, e.g. "BERDL off-cluster ✓ ready" (rendered as given). */
  connection?: string;
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
  const sep = theme.fg("dim", " → ");
  return RESEARCH_STEPS.map((step, i) => {
    if (idx === RESEARCH_STEPS.length) return theme.fg("dim", `${step}`); // complete: all behind us
    if (i === idx) return theme.bold(theme.fg("accent", `▸ ${step}`));
    if (idx >= 0 && i < idx) return theme.fg("dim", step);
    return theme.fg("muted", step);
  }).join(sep);
}

/** Build the workflow HUD lines. Returns `[]` when there is nothing to show. */
export function workflowHud(theme: HudTheme, s: HudState): string[] {
  const lines: string[] = [];

  const head: string[] = [];
  if (s.project) head.push(theme.bold(theme.fg("accent", `▣ ${s.project}`)));
  if (s.connection) head.push(theme.fg(s.ready ? "success" : "warning", s.connection));
  if (head.length) lines.push(head.join(theme.fg("dim", "  ·  ")));

  if (s.project || s.state) {
    const rail = stepRail(theme, s.state);
    lines.push(s.submitted ? `${rail}   ${theme.fg("success", "↑ submitted")}` : rail);
  }

  // The "what's next" hint always shows (a getting-started nudge before any project).
  lines.push(theme.fg("muted", `Next: ${nextAction(s.state ?? "")}`));
  return lines;
}
