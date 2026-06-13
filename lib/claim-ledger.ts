/**
 * Lenient, regex-based reader of the plan/report conventions the research-plan
 * and synthesize skills produce, turned into one ledger row per claim. PURE —
 * no UI, no fs, no throwing: empty/garbled inputs yield `[]` so the read-only
 * `claim_ledger` card can render an honest "(nothing parsed yet)" instead of an
 * error. Confidence/status are READ from the report's "Confidence & Caveats"
 * lines (never recomputed here), and supports/refutes are counted from the
 * "Supporting vs Refuting" pointer bullets.
 */

import type { ClaimStatus, ConfidenceTier, EvidencePointer, EvidenceView } from "./science.ts";

/** One claim's distilled state, as the read-only ledger card consumes it. */
export interface ClaimRow {
  hypothesis: string;
  status: ClaimStatus;
  confidence: ConfidenceTier;
  supports: number;
  refutes: number;
  stale?: boolean;
}

/** A compact tally of a ledger — total claims, and how many are settled either way. */
export interface ClaimTally {
  total: number;
  supported: number;
  refuted: number;
}

/** Count a ledger into a statusline-sized tally (one home for the supported/refuted rule). */
export function tallyClaims(rows: ClaimRow[]): ClaimTally {
  let supported = 0;
  let refuted = 0;
  for (const r of rows) {
    if (r.status === "supported") supported++;
    else if (r.status === "refuted") refuted++;
  }
  return { total: rows.length, supported, refuted };
}

const STATUS_VALUES: readonly ClaimStatus[] = [
  "open",
  "supported",
  "refuted",
  "needs-replication",
  "blocked",
  "needs-evidence",
];
const TIER_VALUES: readonly ConfidenceTier[] = ["high", "medium", "low"];

/** A parsed finding signal from REPORT.md, before it is keyed to a hypothesis. */
interface FindingSignal {
  text: string;
  confidence: ConfidenceTier;
  status: ClaimStatus;
  supports: number;
  refutes: number;
}

/** `- **H1**: statement` → `{ id: "H1", text: "statement" }`. Tolerant of `*` / spacing. */
function parseHypotheses(planMd: string): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  const re = /^\s*[-*]\s*\*\*\s*(H\d+)\s*\*\*\s*:\s*(.+?)\s*$/gim;
  for (const m of planMd.matchAll(re)) out.push({ id: m[1].toUpperCase(), text: m[2].trim() });
  return out;
}

/** First recognized `ClaimStatus` token in a string (case-insensitive), else undefined. */
function findStatus(s: string): ClaimStatus | undefined {
  const lower = s.toLowerCase();
  for (const v of STATUS_VALUES) if (lower.includes(v)) return v;
  return undefined;
}

/** First recognized `ConfidenceTier` token in a string (case-insensitive), else undefined. */
function findTier(s: string): ConfidenceTier | undefined {
  const lower = s.toLowerCase();
  for (const v of TIER_VALUES) if (lower.includes(v)) return v;
  return undefined;
}

/**
 * Count pointer items on a `Supports:` / `Refutes:` line (and any bullet lines
 * that follow it). An explicit "none found …" reads as 0; otherwise count the
 * bullets, or treat a single inline pointer as 1.
 */
function countEvidence(headLine: string, followingBullets: string[]): number {
  const inline = headLine.replace(/^.*?(?:supports?|refutes?)\s*:/i, "").trim();
  if (/^none\b/i.test(inline) || /\bnone found\b/i.test(inline)) return 0;
  if (followingBullets.length) return followingBullets.length;
  return inline ? 1 : 0;
}

/**
 * Pull per-finding signals out of REPORT.md. The "Confidence & Caveats" block
 * gives `(tier, status)` per finding; the "Supporting vs Refuting" block gives
 * support/refute counts. The two are zipped positionally — the conventions
 * don't carry a shared id — so finding N's tier pairs with finding N's tally.
 */
function parseFindings(reportMd: string): FindingSignal[] {
  const lines = reportMd.split(/\r?\n/);

  // Confidence & Caveats: `Finding: {text} (**{tier}**: … Status: {status})`.
  const caveats: { text: string; confidence: ConfidenceTier; status: ClaimStatus }[] = [];
  const findingRe = /^\s*[-*]?\s*Finding\s*:\s*(.+)$/i;
  for (const line of lines) {
    const m = line.match(findingRe);
    if (!m) continue;
    const body = m[1];
    const tier = findTier(body);
    if (!tier) continue;
    const statusMatch = body.match(/status\s*:\s*([a-z-]+)/i);
    const status = (statusMatch && findStatus(statusMatch[1])) ?? findStatus(body) ?? "open";
    const text = body.replace(/\s*\(.*$/, "").trim() || body.trim();
    caveats.push({ text, confidence: tier, status });
  }

  // Supporting vs Refuting: count items under each `Supports:` / `Refutes:` head.
  const tallies: { supports: number; refutes: number }[] = [];
  let pending: { supports?: number; refutes?: number } = {};
  const flush = () => {
    if (pending.supports != null || pending.refutes != null) {
      tallies.push({ supports: pending.supports ?? 0, refutes: pending.refutes ?? 0 });
      pending = {};
    }
  };
  const bulletsAfter = (start: number): string[] => {
    const bullets: string[] = [];
    for (let j = start + 1; j < lines.length; j++) {
      const l = lines[j];
      if (/^\s*[-*]\s+/.test(l) && !/^\s*[-*]?\s*(?:supports?|refutes?)\s*:/i.test(l)) bullets.push(l);
      else break;
    }
    return bullets;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*[-*]?\s*supports?\s*:/i.test(line)) {
      if (pending.supports != null) flush();
      pending.supports = countEvidence(line, bulletsAfter(i));
    } else if (/^\s*[-*]?\s*refutes?\s*:/i.test(line)) {
      pending.refutes = countEvidence(line, bulletsAfter(i));
      flush();
    }
  }
  flush();

  const count = Math.max(caveats.length, tallies.length);
  const signals: FindingSignal[] = [];
  for (let i = 0; i < count; i++) {
    const c = caveats[i];
    const t = tallies[i];
    signals.push({
      text: c?.text ?? `Finding ${i + 1}`,
      confidence: c?.confidence ?? "low",
      status: c?.status ?? "open",
      supports: t?.supports ?? 0,
      refutes: t?.refutes ?? 0,
    });
  }
  return signals;
}

/** A short, single-line slug of finding text for the `hypothesis` cell. */
function slug(text: string, max = 60): string {
  const s = text.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Build the claim ledger from a plan + report. One row per hypothesis (`Hn`)
 * found in RESEARCH_PLAN.md; report findings are zipped onto hypotheses by
 * order, so the first finding's tier/status/tally lands on the first hypothesis.
 * Hypotheses with no matching finding default to `open` / `low` / 0 / 0. When
 * the report has findings but the plan has no parseable hypotheses, each finding
 * becomes its own row keyed by a slug of its text. Never throws.
 */
export function parseClaimLedger(planMd: string, reportMd: string): ClaimRow[] {
  const plan = typeof planMd === "string" ? planMd : "";
  const report = typeof reportMd === "string" ? reportMd : "";
  const hypotheses = parseHypotheses(plan);
  const findings = parseFindings(report);

  if (!hypotheses.length) {
    return findings.map((f) => ({
      hypothesis: slug(f.text),
      status: f.status,
      confidence: f.confidence,
      supports: f.supports,
      refutes: f.refutes,
    }));
  }

  return hypotheses.map((h, i) => {
    const f = findings[i];
    return {
      hypothesis: `${h.id}: ${slug(h.text)}`,
      status: f?.status ?? "open",
      confidence: f?.confidence ?? "low",
      supports: f?.supports ?? 0,
      refutes: f?.refutes ?? 0,
    };
  });
}

/** Infer an `EvidencePointer["kind"]` from a bullet's `[tag]` or `PMID` marker. */
function pointerKind(bullet: string): EvidencePointer["kind"] {
  const tag = bullet.match(/\[(query|notebook|figure|paper)\]/i);
  if (tag) return tag[1].toLowerCase() as EvidencePointer["kind"];
  if (/\bPMID[:\s]/i.test(bullet)) return "paper";
  return "query";
}

/** A path / notebook hash / PMID token in a bullet, if one is present. */
function pointerLocator(bullet: string): string | null {
  const pmid = bullet.match(/\bPMID[:\s]\s*(\d+)/i);
  if (pmid) return `PMID:${pmid[1]}`;
  const hash = bullet.match(/\b(?:sha256:)?[0-9a-f]{12,64}\b/i);
  if (hash) return hash[0];
  const path = bullet.match(/\b[\w./-]+\.(?:ipynb|py|png|svg|pdf|csv|parquet)\b/i);
  if (path) return path[0];
  return null;
}

/** Strip a leading bullet marker and surrounding whitespace from a line. */
function stripBullet(line: string): string {
  return line.replace(/^\s*[-*]\s+/, "").trim();
}

/** Parse the bullet lines under a `Supports:` / `Refutes:` head into pointers. */
function parsePointers(bullets: string[]): EvidencePointer[] {
  return bullets.map((b) => {
    const exact = stripBullet(b);
    return {
      kind: pointerKind(exact),
      locator: pointerLocator(exact) ?? exact,
      exact,
      relevance: "",
    };
  });
}

/**
 * Parse the first matching finding out of REPORT.md into a single `EvidenceView`
 * — the live, full-detail counterpart to the ledger row. PURE; never throws and
 * returns `null` for non-string input or when no findings are present.
 *
 * Picks the first finding whose text contains `finding` (case-insensitive),
 * else the first finding. `status`/`confidence` come from its Confidence &
 * Caveats line; `supports`/`refutes`/`unresolved` come from the bullet lines
 * under each `Supports:` / `Refutes:` / `Unresolved` head.
 */
export function parseEvidence(reportMd: string, finding?: string): EvidenceView | null {
  if (typeof reportMd !== "string") return null;
  const findings = parseFindings(reportMd);
  if (!findings.length) return null;

  const needle = finding?.trim().toLowerCase();
  const chosen = (needle ? findings.find((f) => f.text.toLowerCase().includes(needle)) : undefined) ?? findings[0];

  const lines = reportMd.split(/\r?\n/);
  const bulletsAfter = (start: number): string[] => {
    const bullets: string[] = [];
    for (let j = start + 1; j < lines.length; j++) {
      const l = lines[j];
      if (/^\s*[-*]\s+/.test(l) && !/^\s*[-*]?\s*(?:supports?|refutes?|unresolved)\s*:?/i.test(l)) bullets.push(l);
      else break;
    }
    return bullets;
  };

  let supports: EvidencePointer[] = [];
  let refutes: EvidencePointer[] = [];
  const unresolved: string[] = [];
  let refutesSearched: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*[-*]?\s*supports?\s*:/i.test(line)) {
      supports = parsePointers(bulletsAfter(i));
    } else if (/^\s*[-*]?\s*refutes?\s*:/i.test(line)) {
      refutes = parsePointers(bulletsAfter(i));
      const searched = line.match(/\bsearched\s+(.+?)\s*$/i);
      if (searched) refutesSearched = searched[1].replace(/[.]\s*$/, "").trim();
    } else if (/^\s*[-*]?\s*unresolved\s*:?/i.test(line)) {
      for (const b of bulletsAfter(i)) unresolved.push(stripBullet(b));
    }
  }

  return {
    claim: chosen.text,
    status: chosen.status,
    confidence: chosen.confidence,
    supports,
    refutes,
    ...(unresolved.length ? { unresolved } : {}),
    ...(refutesSearched ? { refutesSearched } : {}),
  };
}
