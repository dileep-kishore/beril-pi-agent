/**
 * Shared scientific-method vocabulary used across skills, cards, and the
 * refutation pass. Confidence is COMPUTED from the strongest artifact behind a
 * claim — never a verbalized number — so claims cannot sound more certain than
 * the evidence supports. The names mirror the (future, out-of-scope) KG
 * StatementCard fields so a later emitter is a thin mapping, not a redesign.
 */

/** Per-CLAIM status — a separate axis from the project LIFECYCLE states. */
export type ClaimStatus = "open" | "supported" | "refuted" | "needs-replication" | "blocked" | "needs-evidence";

export const CLAIM_STATUSES: readonly ClaimStatus[] = [
  "open",
  "supported",
  "refuted",
  "needs-replication",
  "blocked",
  "needs-evidence",
] as const;

/** Computed confidence in a claim, keyed to artifact strength. */
export type ConfidenceTier = "high" | "medium" | "low";

/** A typed, re-openable pointer to the artifact behind a claim. */
export interface EvidencePointer {
  kind: "query" | "notebook" | "figure" | "paper";
  /** notebook path (+ optional `#cell-N`), figure path, query hash, or PMID/DOI. */
  locator: string;
  /** The exact, verbatim source sentence/number this claim rests on. */
  exact: string;
  /** One-line why-this-matters. */
  relevance: string;
}

/** A re-runnable data/code result (vs literature, which alone stays `low`). */
function isResult(p: EvidencePointer): boolean {
  return p.kind === "query" || p.kind === "notebook";
}

/**
 * Map supporting evidence → a confidence tier (pure, deterministic).
 * - high   — ≥2 independent artifact-backed results.
 * - medium — exactly one re-runnable result (a paper may accompany it).
 * - low    — literature-only, or nothing (caller treats empty as needs-evidence).
 */
export function tierForEvidence(supports: EvidencePointer[]): ConfidenceTier {
  const results = supports.filter(isResult).length;
  if (results >= 2) return "high";
  if (results === 1) return "medium";
  return "low";
}
