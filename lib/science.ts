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

/**
 * Computed GROUNDEDNESS — the second axis of calibrated trust, counting the
 * distinct independent RE-RUNNABLE sources behind a claim (vs `ConfidenceTier`,
 * which is the writer-assigned strength). A claim can carry a high confidence
 * yet be `single-source`; that gap is the signal a reviewer watches for.
 */
export type GroundednessTier = "well-grounded" | "single-source" | "ungrounded";

/** A typed, re-openable pointer to the artifact behind a claim. */
export interface EvidencePointer {
  kind: "query" | "notebook" | "figure" | "paper" | "web" | "docs";
  /** notebook path (+ `#cell-N`), figure path, query hash, PMID/DOI, or a web/docs source URL. */
  locator: string;
  /** The exact, verbatim source sentence/number this claim rests on. */
  exact: string;
  /** One-line why-this-matters. */
  relevance: string;
}

/** A claim with its supporting AND refuting evidence, each a re-openable pointer. */
export interface EvidenceView {
  claim: string;
  status: ClaimStatus;
  confidence: ConfidenceTier;
  supports: EvidencePointer[];
  refutes: EvidencePointer[];
  unresolved?: string[];
  /** What was searched when refutes is empty (so "none found" is auditable). */
  refutesSearched?: string;
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

/**
 * Map supporting evidence → a groundedness tier (pure, deterministic).
 *
 * Counts the DISTINCT independent re-runnable sources: only query/notebook
 * locators count (`isResult`), deduped by a whitespace-normalized locator, so two
 * pointers into the same notebook are ONE source and literature/web alone is
 * `ungrounded`. ≥2 distinct → `well-grounded`; exactly 1 → `single-source`;
 * 0 → `ungrounded`. Tolerates `[]` and malformed rows (never throws).
 */
export function groundednessForEvidence(supports: EvidencePointer[]): GroundednessTier {
  const locators = new Set<string>();
  for (const p of supports ?? []) {
    if (!isResult(p)) continue;
    const key = `${p.locator ?? ""}`.replace(/\s+/g, "").toLowerCase();
    if (key) locators.add(key);
  }
  if (locators.size >= 2) return "well-grounded";
  if (locators.size === 1) return "single-source";
  return "ungrounded";
}

/**
 * A written confidence outruns its evidence when the claim is asserted high/medium
 * but the distinct re-runnable sources only support `single-source`/`ungrounded`.
 * Pure — derived from the artifacts, never a model-supplied field. The single
 * source of this rule, shared by the claim ledger and the science cards.
 */
export function tierMismatch(confidence: ConfidenceTier, groundedness: GroundednessTier): boolean {
  return (confidence === "high" || confidence === "medium") && groundedness !== "well-grounded";
}

/**
 * The kind of thing a claim rests on. Separate from confidence: it says WHERE the
 * evidence comes from, not how strong it is. Kosmos found synthesis claims (which
 * weave data + literature into a new conclusion) empirically the weakest — 57.9%
 * accuracy vs ~85% for the direct kinds — so surfacing the type lets a reviewer
 * spend their scrutiny where it is most warranted.
 */
export type ClaimType = "data" | "literature" | "synthesis";

/** A literature/web pointer — the two kinds that make a claim "literature". */
function isLiterature(p: EvidencePointer): boolean {
  return p.kind === "paper" || p.kind === "web";
}

/**
 * Classify a claim by its supporting evidence (pure, deterministic):
 * - `data`       — ≥1 re-runnable result and no paper/web.
 * - `literature` — no result and ≥1 paper/web.
 * - `synthesis`  — both kinds together, or nothing at all (a bare assertion is,
 *   for scrutiny purposes, the weakest synthesis case). Tolerates `[]`.
 */
export function claimTypeForEvidence(supports: EvidencePointer[]): ClaimType {
  let results = 0;
  let literature = 0;
  for (const p of supports ?? []) {
    if (isResult(p)) results++;
    else if (isLiterature(p)) literature++;
  }
  if (results >= 1 && literature === 0) return "data";
  if (results === 0 && literature >= 1) return "literature";
  return "synthesis";
}

/**
 * The Kosmos synthesis bar: a SYNTHESIS claim asserted high/medium must clear a
 * higher grounding threshold before we let its written tier stand unflagged. It
 * is flagged (returns `true`) unless it BOTH rests on ≥2 distinct re-runnable
 * sources (`well-grounded`) AND has actively looked for disconfirming evidence
 * (a recorded refute, or a recorded search that found none). Pure and additive:
 * a flag rendered ALONGSIDE `tierMismatch`, never a change to the tiers themselves.
 */
export function synthesisBar(view: {
  confidence: ConfidenceTier;
  supports: EvidencePointer[];
  refutes: EvidencePointer[];
  refutesSearched?: string;
}): boolean {
  if (claimTypeForEvidence(view.supports) !== "synthesis") return false;
  if (view.confidence !== "high" && view.confidence !== "medium") return false;
  const wellGrounded = groundednessForEvidence(view.supports) === "well-grounded";
  const searchNote = (view.refutesSearched ?? "").trim().toLowerCase();
  const soughtDisconfirmation = (view.refutes ?? []).length > 0 || Boolean(searchNote && searchNote !== "not recorded");
  return !(wellGrounded && soughtDisconfirmation);
}
