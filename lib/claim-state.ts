import { createHash } from "node:crypto";
import { type ClaimRow, parseClaimLedger, parseEvidence } from "./claim-ledger.ts";
import {
  type ClaimStatus,
  type ClaimType,
  type ConfidenceTier,
  type EvidencePointer,
  type GroundednessTier,
  claimTypeForEvidence,
  groundednessForEvidence,
  tierMismatch,
} from "./science.ts";

export interface ClaimStateRow {
  claim_id: string;
  /**
   * Content-addressed claim identity: sha256 of the normalized claim text + its
   * sorted support locators. Stable across plan re-parses; CHANGES when the claim
   * or its evidence set changes — tamper-evidence (nanopub Trusty-URI idea).
   */
  claim_uid: string;
  claim: string;
  /** Where the evidence comes from (data / literature / synthesis). */
  claim_type: ClaimType;
  status: ClaimStatus;
  confidence: ConfidenceTier;
  /** Computed second axis: distinct re-runnable sources behind the claim. */
  groundedness: GroundednessTier;
  /** Set when the WRITTEN confidence (high/medium) outruns the evidence (single-source/ungrounded). */
  tier_mismatch?: boolean;
  supports: EvidencePointer[];
  refutes: EvidencePointer[];
  refutesSearched?: string;
  stale?: boolean;
  reviewer_notes?: string;
}

export interface ClaimState {
  project: string;
  updated_at: string;
  report_hash?: string;
  rows: ClaimStateRow[];
}

export interface BuildClaimStateInput {
  project: string;
  planMd: string;
  reportMd: string;
  existing?: ClaimState;
  now?: string;
}

export interface ClaimStateSummary {
  total: number;
  supported: number;
  refuted: number;
  unsupported: number;
  emptyRefutes: number;
  /** Claims whose written confidence outruns their evidence. Optional so legacy literals stay valid. */
  tierMismatch?: number;
}

function normalizeClaim(text: string): string {
  return text
    .replace(/^H\d+:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.]\s*$/, "");
}

function planHypotheses(planMd: string): ClaimRow[] {
  const rows: ClaimRow[] = [];
  const re = /^\s*[-*]\s*\*\*\s*(H\d+)\s*:?\s*\*\*\s*:?\s*(.+?)\s*$/gim;
  for (const m of planMd.matchAll(re)) {
    rows.push({
      hypothesis: `${m[1].toUpperCase()}: ${m[2].trim()}`,
      status: "open",
      confidence: "low",
      supports: 0,
      refutes: 0,
    });
  }
  return rows;
}

function claimId(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  return slug || "claim";
}

/** Normalize for the claim UID: collapse whitespace, trim, lowercase (spec contract 9). */
function claimUidNormalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Content-addressed claim UID = sha256 of `normalize(claim) + "\n" + sorted
 * support locators joined by "\n"`. Deterministic in the (claim, evidence-set)
 * pair, so the same claim over the same supports always hashes the same, and any
 * change to either shifts the hash.
 */
function claimUid(claim: string, supports: EvidencePointer[]): string {
  const locators = (supports ?? []).map((p) => p.locator ?? "").sort();
  const material = `${claimUidNormalize(claim)}\n${locators.join("\n")}`;
  return `sha256:${createHash("sha256").update(material).digest("hex")}`;
}

function reportHash(reportMd: string): string | undefined {
  if (!reportMd) return undefined;
  return `sha256:${createHash("sha256").update(reportMd).digest("hex")}`;
}

function fallbackPointers(kind: EvidencePointer["kind"], count: number): EvidencePointer[] {
  return Array.from({ length: count }, (_, i) => ({
    kind,
    locator: `${kind}:${i + 1}`,
    exact: "",
    relevance: "parsed from REPORT.md",
  }));
}

interface FindingBlock {
  title: string;
  status?: ClaimStatus;
  confidence?: ConfidenceTier;
  supports: EvidencePointer[];
  refutes: EvidencePointer[];
  refutesSearched?: string;
}

function statusFrom(text: string): ClaimStatus | undefined {
  const m = text.match(/\b(open|supported|refuted|needs-replication|blocked|needs-evidence)\b/i);
  return m?.[1].toLowerCase() as ClaimStatus | undefined;
}

function confidenceFrom(text: string): ConfidenceTier | undefined {
  const m = text.match(/\b(high|medium|low)\b/i);
  return m?.[1].toLowerCase() as ConfidenceTier | undefined;
}

function pointerFromLine(line: string, kind: EvidencePointer["kind"]): EvidencePointer | undefined {
  const body = line.replace(/^.*?:/, "").trim();
  if (!body || /^none\b/i.test(body)) return undefined;
  const [locatorRaw, relevanceRaw] = body.split(/\s+[—-]\s+/, 2);
  return {
    kind,
    locator: locatorRaw.trim(),
    exact: body,
    relevance: relevanceRaw?.trim() || "parsed from REPORT.md",
  };
}

function parseFindingBlocks(reportMd: string): FindingBlock[] {
  const lines = reportMd.split(/\r?\n/);
  const blocks: FindingBlock[] = [];
  let current: { title: string; lines: string[] } | undefined;
  const flush = () => {
    if (!current) return;
    const body = current.lines.join("\n");
    const supports = current.lines
      .filter((l) => /^\s*supports?\s*:/i.test(l))
      .map((l) => pointerFromLine(l, "notebook"))
      .filter((p): p is EvidencePointer => Boolean(p));
    const refuteLines = current.lines.filter((l) => /^\s*refutes?\s*:/i.test(l));
    const refutes = refuteLines.map((l) => pointerFromLine(l, "paper")).filter((p): p is EvidencePointer => Boolean(p));
    const searched = refuteLines
      .map((l) =>
        l
          .match(/\bsearched\s+(.+?)\s*$/i)?.[1]
          ?.replace(/[.]\s*$/, "")
          .trim(),
      )
      .find(Boolean);
    blocks.push({
      title: current.title,
      status: statusFrom(body),
      confidence: confidenceFrom(body),
      supports,
      refutes,
      refutesSearched: searched,
    });
  };
  for (const line of lines) {
    const heading = line.match(/^#{2,4}\s+Finding\s+\d+\s*:\s*(.+?)\s*$/i);
    if (heading) {
      flush();
      current = { title: heading[1].trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  flush();
  return blocks;
}

function existingByClaim(existing?: ClaimState): Map<string, ClaimStateRow> {
  const map = new Map<string, ClaimStateRow>();
  for (const row of existing?.rows ?? []) map.set(normalizeClaim(row.claim).toLowerCase(), row);
  return map;
}

function rowToState(
  row: ClaimRow,
  existing: Map<string, ClaimStateRow>,
  reportMd: string,
  block?: FindingBlock,
): ClaimStateRow {
  const claim = normalizeClaim(row.hypothesis);
  const prior = existing.get(claim.toLowerCase());
  const view = parseEvidence(reportMd, claim);
  const supports = block?.supports.length
    ? block.supports
    : view?.supports.length
      ? view.supports
      : prior?.supports?.length
        ? prior.supports
        : fallbackPointers("notebook", row.supports);
  const refutes = block?.refutes.length
    ? block.refutes
    : view?.refutes.length
      ? view.refutes
      : prior?.refutes?.length
        ? prior.refutes
        : fallbackPointers("paper", row.refutes);
  const confidence = block?.confidence ?? row.confidence;
  const groundedness = groundednessForEvidence(supports);
  return {
    claim_id: prior?.claim_id ?? claimId(row.hypothesis),
    claim_uid: claimUid(claim, supports),
    claim,
    claim_type: claimTypeForEvidence(supports),
    status: block?.status ?? row.status,
    confidence,
    groundedness,
    tier_mismatch: tierMismatch(confidence, groundedness),
    supports,
    refutes,
    refutesSearched:
      block?.refutesSearched ??
      view?.refutesSearched ??
      prior?.refutesSearched ??
      (refutes.length === 0 ? "not recorded" : undefined),
    stale: row.stale,
    reviewer_notes: prior?.reviewer_notes,
  };
}

export function buildClaimState(input: BuildClaimStateInput): ClaimState {
  const rows = planHypotheses(input.planMd);
  const parsedRows = rows.length ? rows : parseClaimLedger(input.planMd, input.reportMd);
  const existing = existingByClaim(input.existing);
  const blocks = parseFindingBlocks(input.reportMd);
  return {
    project: input.project,
    updated_at: input.now ?? new Date().toISOString(),
    report_hash: reportHash(input.reportMd),
    rows: parsedRows.map((row, i) => rowToState(row, existing, input.reportMd, blocks[i])),
  };
}

export function claimStateSummary(rows: ClaimStateRow[]): ClaimStateSummary {
  let supported = 0;
  let refuted = 0;
  let unsupported = 0;
  let emptyRefutes = 0;
  let tierMismatchCount = 0;
  for (const row of rows) {
    if (row.status === "supported") supported++;
    else if (row.status === "refuted") refuted++;
    else unsupported++;
    if (row.refutes.length === 0) emptyRefutes++;
    if (row.tier_mismatch) tierMismatchCount++;
  }
  return {
    total: rows.length,
    supported,
    refuted,
    unsupported,
    emptyRefutes,
    tierMismatch: tierMismatchCount,
  };
}

export function serializeClaimState(state: ClaimState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}
