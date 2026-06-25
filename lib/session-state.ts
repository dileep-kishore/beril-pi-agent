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
 * settled fact (calibrated trust / `tierForEvidence` stay untouched). The
 * shaping/rendering core (`buildSnapshot`, `formatReinjection`) is PURE: no fs,
 * no UI, no throwing. The one I/O helper (`readResearchState`) reads the snapshot
 * back through the CLI and is the single loader both world-model and memory share.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { berilExec } from "./beril-exec.ts";
import type { ClaimTally } from "./claim-ledger.ts";
import { currentStep } from "./research-steps.ts";

/** Caps for the bounded world-model orientation sections (entries / chars). */
const MAX_LIST = 8;
const MAX_ENTRY = 160;
const MAX_QUESTION = 240;

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
  /**
   * The lightweight investigation "world model" — orientation only, NOT findings.
   * The agent maintains these mid-arc so a compaction keeps the thread; they are
   * re-verifiable prompts to the agent, never settled results (no `findings[]`,
   * which would duplicate claims.json). All bounded + clamped. Omitted when empty.
   */
  /** `<= 240` chars, single line: the research question under investigation. */
  question?: string;
  /** `<= 8` single-line entries (`<= 160` chars each): still-open questions. */
  openQuestions?: string[];
  /** `<= 8` single-line entries: working assumptions that would change the analysis. */
  assumptions?: string[];
  /** `<= 8` single-line entries: tried-and-abandoned avenues, so they aren't re-attempted. */
  deadEnds?: string[];
}

/** Inputs the memory extension gathers before shaping a snapshot. */
export interface SnapshotInput {
  project: string;
  phase: string;
  claims: ClaimTally;
  lastCheckpoint?: string;
  question?: string;
  openQuestions?: string[];
  assumptions?: string[];
  deadEnds?: string[];
}

/** Collapse to a single line and clamp to `max` chars (with an ellipsis when cut). */
function clampLine(s: string, max: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

/**
 * Single-line + clamp each entry, drop blanks, then cap the list length. Tolerates
 * a non-array (returns []) so a malformed snapshot can never crash the snapshotter.
 */
function clampList(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((s): s is string => typeof s === "string")
    .map((s) => clampLine(s, MAX_ENTRY))
    .filter((s) => s.length > 0)
    .slice(0, MAX_LIST);
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
  const question = input.question && clampLine(input.question, MAX_QUESTION);
  if (question) snap.question = question;
  const openQuestions = clampList(input.openQuestions);
  if (openQuestions.length) snap.openQuestions = openQuestions;
  const assumptions = clampList(input.assumptions);
  if (assumptions.length) snap.assumptions = assumptions;
  const deadEnds = clampList(input.deadEnds);
  if (deadEnds.length) snap.deadEnds = deadEnds;
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
  // The world-model orientation sections: still framed as where-we-left-off, not
  // findings. They are re-verifiable prompts, so they sit ABOVE the re-verify guard.
  if (s.question) lines.push(`Working question: ${s.question}`);
  if (s.openQuestions?.length) {
    lines.push("Open questions to resolve:");
    for (const q of s.openQuestions) lines.push(`  - ${q}`);
  }
  if (s.assumptions?.length) {
    lines.push("Working assumptions (unverified):");
    for (const a of s.assumptions) lines.push(`  - ${a}`);
  }
  if (s.deadEnds?.length) {
    lines.push("Dead ends already tried (do not re-attempt blindly):");
    for (const d of s.deadEnds) lines.push(`  - ${d}`);
  }
  lines.push(
    "Treat the above as where we left off, not as proof. Re-open the plan/report and",
    "re-run checks before asserting any result as settled.",
  );
  return lines.join("\n");
}

/**
 * Re-read a project's stored research_state snapshot via the CLI (best-effort;
 * `{}` when there is none or the read errors). The single loader shared by the
 * world-model tool and the memory flush so the `beril lifecycle session-state
 * --get` contract lives in exactly one place.
 */
export async function readResearchState(
  pi: Pick<ExtensionAPI, "exec">,
  project: string,
): Promise<Partial<ResearchStateSnapshot>> {
  try {
    const res = await berilExec<ResearchStateSnapshot | Record<string, never>>(pi, [
      "lifecycle",
      "session-state",
      project,
      "--get",
    ]);
    return res && typeof res === "object" ? (res as Partial<ResearchStateSnapshot>) : {};
  } catch {
    return {};
  }
}
