/**
 * Cross-session research-state snapshot — the small, auditable, tool-derived
 * block that survives a context compaction.
 *
 * A long research arc (explore → plan → analyze → review → submit) loses its
 * thread when Pi compacts the conversation. This module is the PURE core of the
 * memory extension: it shapes a snapshot from facts the TS side already has
 * cheaply (lifecycle phase, the claim tally, the scientist's last checkpoint
 * choice) and renders it back as plainly-labelled *background* context.
 *
 * The snapshot carries ONLY counts + identifiers — never a claim's hypothesis
 * text or a verdict — so an unverified claim can never be laundered back in as
 * settled fact (calibrated trust / `tierForEvidence` stay untouched). PURE: no
 * fs, no UI, no throwing.
 */

import type { ClaimTally } from "./claim-ledger.ts";
import { currentStep } from "./research-steps.ts";

/** The persisted research-state block — small, tool-derived, anti-laundering. */
export interface ResearchStateSnapshot {
  project: string;
  /** Lifecycle status, e.g. "analysis". */
  phase: string;
  /** The scientist-facing step for `phase` (`currentStep`), coerced to "". */
  step: string;
  claims: { total: number; supported: number; refuted: number };
  /** `<= 160` chars, single line: the scientist's last checkpoint choice. Omitted when unknown. */
  lastCheckpoint?: string;
}

/** Inputs the memory extension gathers before shaping a snapshot. */
export interface SnapshotInput {
  project: string;
  phase: string;
  claims: ClaimTally;
  lastCheckpoint?: string;
}

/** Collapse to a single line and clamp to `max` chars (with an ellipsis when cut). */
function clampLine(s: string, max: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

/**
 * Shape the persisted snapshot from gathered inputs. Derives `step` from the
 * lifecycle phase (unknown phase → ""), copies the tally, and clamps/omits the
 * optional single-line fields. Deterministic and length-bounded; never throws.
 */
export function buildSnapshot(input: SnapshotInput): ResearchStateSnapshot {
  const snap: ResearchStateSnapshot = {
    project: input.project,
    phase: input.phase,
    step: currentStep(input.phase) ?? "",
    claims: {
      total: input.claims.total,
      supported: input.claims.supported,
      refuted: input.claims.refuted,
    },
  };
  const checkpoint = input.lastCheckpoint && clampLine(input.lastCheckpoint, 160);
  if (checkpoint) snap.lastCheckpoint = checkpoint;
  return snap;
}

/**
 * Render the snapshot as plain-ASCII *background* context for the first turn
 * after a compaction. It is deliberately phrased as orientation, NOT findings:
 * the guard strings ("NOT established findings" / "re-verify") keep the agent
 * from treating a read-only tally as proof. Contains no claim hypothesis text.
 */
export function formatReinjection(s: ResearchStateSnapshot): string {
  const step = s.step || s.phase || "current";
  const lines = [
    "[beril cross-session context — orientation only, NOT established findings]",
    `Resuming project "${s.project}" at the ${step} step (lifecycle: ${s.phase}).`,
    `Claim ledger so far: ${s.claims.total} claim(s), ${s.claims.supported} supported, ${s.claims.refuted} refuted`,
    "(read-only tally; re-verify before relying on any of them).",
  ];
  if (s.lastCheckpoint) lines.push(`Last checkpoint decision: ${s.lastCheckpoint}.`);
  lines.push(
    "Treat the above as where we left off, not as proof. Re-open the plan/report and",
    "re-run checks before asserting any result as settled.",
  );
  return lines.join("\n");
}
