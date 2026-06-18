/**
 * The scientist-facing research checklist and its mapping from lifecycle state.
 *
 * Scientists asked for a visible checklist of the research steps to help them
 * keep a mental model of where a project is and how it is progressing. The
 * lifecycle machine already tracks state; this renders that state as an
 * always-visible breadcrumb so the scientist can see where a project sits in the
 * overall process at a glance.
 */

import { GLYPH } from "./ui/glyphs.ts";

/** The research checklist, in order, as a scientist thinks of it. */
export const RESEARCH_STEPS = ["explore", "plan", "analyze", "review", "submit"] as const;

/**
 * Lifecycle state → the index of the step the project is currently *at* (the
 * actionable step). `analysis` (report drafted) points at `review` because that
 * is the next thing the scientist does; `complete` is past the last step.
 */
const STATE_STEP: Record<string, number> = {
  exploration: 0,
  proposed: 1,
  active: 2,
  analysis: 3,
  reviewed: 4,
  complete: RESEARCH_STEPS.length,
};

/**
 * Render the checklist as a compact breadcrumb with the current step marked,
 * e.g. `explore · plan · ▸analyze · review · submit`. A `complete` project shows
 * the full checklist with a trailing `✓`. An unknown state returns the plain
 * checklist with nothing marked (never throws).
 */
export function stepBreadcrumb(state: string): string {
  const current = STATE_STEP[state];
  const trail = RESEARCH_STEPS.map((step, i) => (i === current ? `${GLYPH.here}${step}` : step)).join(
    ` ${GLYPH.bullet} `,
  );
  return current === RESEARCH_STEPS.length ? `${trail} ${GLYPH.ok}` : trail;
}

/**
 * The index of the step a project is currently *at*: 0..N-1 for an active step,
 * `RESEARCH_STEPS.length` for a `complete` project, or `-1` for an unknown state.
 * (`-1` keeps "nothing is the current step" distinct from "the first step".)
 */
export function stepIndex(state: string): number {
  return state in STATE_STEP ? STATE_STEP[state] : -1;
}

/**
 * The current step's label for a lifecycle state — `"explore"`…`"submit"`, or
 * `"complete"` for a finished project, or `undefined` for an unknown state.
 * Used by the statusline's compact phase segment.
 */
export function currentStep(state: string): string | undefined {
  const idx = stepIndex(state);
  if (idx < 0) return undefined;
  if (idx >= RESEARCH_STEPS.length) return "complete";
  return RESEARCH_STEPS[idx];
}

/**
 * The Pi session display name for a project at a lifecycle state — `<project>` or
 * `<project> · <phase>` (e.g. `aquila · analyze`). Wired to `pi.setSessionName` so
 * a resumed session reads meaningfully in Pi's selector instead of a raw UUID.
 * Uses the text-presentation bullet (never a raw "·") to keep the glyph invariant.
 */
export function sessionName(project: string, state?: string): string {
  const phase = state ? currentStep(state) : undefined;
  return phase ? `${project} ${GLYPH.bullet} ${phase}` : project;
}

/**
 * The single most useful next action for a lifecycle state, phrased for a
 * scientist. Kept independent of exact slash-command names where a step has no
 * single command, so the hint stays accurate as the surface grows.
 */
export function nextAction(state: string): string {
  switch (state) {
    case "exploration":
      return "frame the question, then query the data and draft a research plan";
    case "proposed":
      return "scaffold and run the analysis notebooks";
    case "active":
      return "finish the notebooks, draft /paper-plan, then /synthesize the report";
    case "analysis":
      return "review the report (/berdl-review), then /submit";
    case "reviewed":
      return "submit the approved project (/submit)";
    case "complete":
      return "project complete — archived to the lakehouse";
    default:
      return "frame the question, then check the connection (/berdl-status) and discover the data";
  }
}
