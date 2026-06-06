/**
 * The scientist-facing research checklist and its mapping from lifecycle state.
 *
 * Scientists asked for a visible checklist of the research steps to help them
 * keep a mental model of where a project is and how it is progressing. The
 * lifecycle machine already tracks state; this renders that state as an
 * always-visible breadcrumb so the scientist can see where a project sits in the
 * overall process at a glance.
 */

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
  const trail = RESEARCH_STEPS.map((step, i) => (i === current ? `▸${step}` : step)).join(" · ");
  return current === RESEARCH_STEPS.length ? `${trail} ✓` : trail;
}
