/**
 * Pure gating policy for the capability route-nudge.
 *
 * The nudge used to fire on every turn whenever the literal prompt matched a
 * keyword, with no awareness of where the project actually is. This module is
 * the state-aware half of the fix: given an already-matched capability and the
 * current lifecycle status, decide whether to nudge it, redirect to the
 * phase-correct move, or stay silent. It is pure (no IO, never throws) so the
 * extension stays a thin wrapper and the policy is unit-testable under
 * `node --test`.
 */

import type { Capability } from "./capabilities.ts";
import { routeNudge } from "./capabilities.ts";
import { stepIndex } from "./research-steps.ts";
import { recommendedCommand } from "./workflow.ts";

/**
 * The research step a capability belongs to, as an index into `RESEARCH_STEPS`
 * (`explore=0 … submit=4`). Explore-lane capabilities are reachable from the
 * start (step 0); the study/check capabilities require the project to have
 * advanced. Keyed by capability id so it stays correct if lanes are re-grouped.
 */
const REQUIRED_STEP: Record<string, number> = {
  start: 0,
  "world-model": 0,
  discover: 0,
  literature: 0,
  memory: 0,
  plan: 1,
  analyze: 2,
  paper: 2,
  synthesize: 2,
  refute: 3,
  review: 3,
  submit: 4,
};

/** The research-step index a capability requires; unmapped ids default to 0 (always reachable). */
export function requiredStep(cap: Capability): number {
  return REQUIRED_STEP[cap.id] ?? 0;
}

/**
 * Whether `cap` is a sensible suggestion from the current lifecycle `status`.
 * Reachable when its required step is at-or-one-ahead of the current step, so
 * we suggest the natural next move without leaping (e.g. `/submit` is not
 * reachable from `exploration`). An unknown/absent status (step index < 0) is
 * treated as "don't gate" — fall through to the keyword match — so the nudge
 * never goes silent just because the phase cache is cold.
 */
export function isReachable(cap: Capability, status: string | undefined): boolean {
  const idx = status === undefined ? -1 : stepIndex(status);
  if (idx < 0) return true;
  return requiredStep(cap) <= idx + 1;
}

export type NudgeDecision =
  | { kind: "nudge"; cap: Capability }
  | { kind: "redirect"; command: string }
  | { kind: "suppress" };

/**
 * Decide what to do with a keyword-matched capability given the project's
 * lifecycle status: nudge it when reachable, otherwise redirect to the
 * phase-correct next command. `suppress` is the defensive fallback when no
 * recommended command exists (none today — `recommendedCommand` always returns
 * a string — but kept so callers handle the empty case explicitly).
 */
export function decideNudge({
  cap,
  status,
  project,
}: {
  cap: Capability;
  status: string | undefined;
  project: string | undefined;
}): NudgeDecision {
  if (isReachable(cap, status)) return { kind: "nudge", cap };
  const command = recommendedCommand(status, project);
  if (command) return { kind: "redirect", command };
  return { kind: "suppress" };
}

/** Render a decision into the model-visible nudge/card body. */
export function phrase(decision: NudgeDecision): string {
  if (decision.kind === "nudge") return routeNudge(decision.cap);
  if (decision.kind === "redirect") {
    return `Next step for this project: ${decision.command}. That route is not reachable from the current phase yet — keep exploring data, literature, or alternatives if that fits better.`;
  }
  return "";
}
