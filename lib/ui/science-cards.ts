import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { type Component, Text, visibleWidth } from "@earendil-works/pi-tui";
import type { ClaimRow } from "../claim-ledger.ts";
import type { ClaimStateRow, ClaimStateSummary } from "../claim-state.ts";
import type { LitRecord } from "../lit.ts";
import type { ReviewPreflightView } from "../review-preflight.ts";
import {
  type ClaimStatus,
  type ConfidenceTier,
  type EvidencePointer,
  type EvidenceView,
  type GroundednessTier,
  groundednessForEvidence,
  tierMismatch,
} from "../science.ts";
import { classifySysError } from "../syserror.ts";
import { linesCard, markdownCard, textCard } from "./card.ts";
import { type DiscoverSnapshot, discoverLines, discoverTitle } from "./discover.ts";
import { GLYPH } from "./glyphs.ts";
import { sysErrorCard } from "./koros-cards.ts";
import { hyperlink } from "./links.ts";
import { domainStyle, roleStyle } from "./palette.ts";
import { type CardState, statusIcon } from "./render-utils.ts";
import { cardHeader } from "./status-line-header.ts";
import { markdownTable } from "./table.ts";

/**
 * The science artifacts as cards — one builder per tool result, so the data,
 * literature, and governance state a scientist actually cares about render as
 * titled, framed panels (the command itself recedes to a dimmed `callLine`).
 *
 * Each domain carries its own frame colour (`palette.ts`) so a literature card no
 * longer reads identical to a data card; the body still adopts the user's theme.
 * Status glyphs come from one shared legend (`glyphs.ts`). Nothing here renders
 * raw JSON — structured lists (`discoverLines`) and labeled fields (`kvLines`)
 * replace the old `JSON.stringify` dumps. The formatting-heavy helpers are pure
 * and unit-tested; the builders frame them with the WS1 card primitives.
 */

/** A dimmed one-line tool-call summary so the *command* recedes and the result card leads. */
export function callLine(theme: Theme, summary: string): Component {
  return new Text(theme.fg("dim", summary), 0, 0);
}

/** A transient one-liner while a tool is still streaming. */
export function partialLine(theme: Theme, message: string): Component {
  return new Text(theme.fg("muted", `${GLYPH.inProgress} ${message}`), 0, 0);
}

/** A tool result's text content joined into one string — the message to surface on failure. */
export function toolErrorText(result: { content?: { type: string; text?: string }[] }): string {
  return (result.content ?? [])
    .filter((c): c is { type: "text"; text: string } => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n")
    .trim();
}

/**
 * A failed tool → a red-framed card surfacing the actual error message.
 *
 * On error, pi replaces the tool's `details` with `{}` and puts the message in
 * `content` (and sets `context.isError`). Every science-card `renderResult` must
 * branch on that and call this — otherwise it frames the success card against the
 * empty `{}` and shows "undefined / (schema unavailable)" instead of the error.
 * The message is shown verbatim (width-aware wrapped, no markdown) so SQL,
 * identifiers, and stderr aren't mangled.
 *
 * One deliberate divert: an INFRASTRUCTURE failure (rate limit, auth, billing,
 * transport outage — matched conservatively on structured tokens only) renders
 * as the neutral `sysErrorCard` instead, so plumbing trouble can never be read
 * as a scientific result ("the data can't answer this").
 */
export function errorCard(theme: Theme, message: string): Component {
  const infra = classifySysError(message);
  if (infra) return sysErrorCard(theme, infra);
  return textCard(theme, {
    title: `${GLYPH.bad} Error`,
    // `state: "error"` paints the BORDER red (the title is red via accentStyle); a
    // failure is the one card that should pop with a coloured frame, not recede.
    state: "error",
    accentStyle: domainStyle(theme, "error"),
    text: message.trim() || "The tool failed without a message.",
    maxBodyLines: 16,
  });
}

/** Labeled `key  value` lines for a flat manifest — replaces raw JSON in result cards. */
export function kvLines(theme: Theme, obj: Record<string, unknown>, labelWidth = 14): string[] {
  return Object.entries(obj)
    .filter(([, v]) => v == null || typeof v !== "object")
    .map(([k, v]) => `${theme.fg("muted", k.padEnd(labelWidth))}${theme.fg("text", v == null ? "—" : String(v))}`);
}

export interface QueryView {
  returned_rows: number;
  rows: Record<string, unknown>[];
  limit_applied: number | null;
}

/** Bounded SQL result → a data card with a GFM table body. */
export function queryCard(theme: Theme, p: QueryView, expanded: boolean): Component {
  const noun = p.returned_rows === 1 ? "row" : "rows";
  const limitNote = p.limit_applied != null ? ` ${GLYPH.bullet} limit ${p.limit_applied}` : "";
  const title = cardHeader(theme, { title: `Query ${GLYPH.bullet} ${p.returned_rows} ${noun}${limitNote}` });
  const accentStyle = domainStyle(theme, "data");
  if (!p.rows?.length) {
    return linesCard(theme, { title, accentStyle, state: "settled", lines: [theme.fg("muted", "(no rows returned)")] });
  }
  return markdownCard(theme, {
    title,
    accentStyle,
    state: "settled",
    markdown: markdownTable(p.rows, { maxRows: expanded ? 60 : 8 }),
  });
}

/** DESCRIBE columns + a sample → a one-glance table-preview body. Pure. */
export function peekMarkdown(columns: Record<string, unknown>[], sample: Record<string, unknown>[]): string {
  const cols = columns?.length ? markdownTable(columns, { maxRows: 60 }) : "_(schema unavailable)_";
  const rows = sample?.length ? markdownTable(sample, { maxRows: 10 }) : "_(no sample rows)_";
  return `**Columns**\n\n${cols}\n\n**Sample**\n\n${rows}`;
}

export function peekCard(
  theme: Theme,
  view: { table: string; columns: Record<string, unknown>[]; sample: Record<string, unknown>[] },
): Component {
  return markdownCard(theme, {
    title: cardHeader(theme, { title: `Table ${GLYPH.bullet} ${view.table}` }),
    accentStyle: domainStyle(theme, "data"),
    state: "settled",
    markdown: peekMarkdown(view.columns, view.sample),
  });
}

/**
 * Discover snapshot → a structured tenant/database/table list (never raw JSON).
 *
 * Discovery is the one artifact a scientist explicitly asks to *see*, so the
 * collapsed cap is generous (a full 7-tenant inventory fits) rather than the
 * 16-line cap that hid most collections behind "… N more line(s)".
 */
export function discoverCard(theme: Theme, snapshot: DiscoverSnapshot, expanded: boolean): Component {
  return linesCard(theme, {
    title: cardHeader(theme, { title: discoverTitle(snapshot) }),
    accentStyle: domainStyle(theme, "data"),
    state: "settled",
    lines: discoverLines(theme, snapshot),
    maxBodyLines: expanded ? 400 : 60,
  });
}

/** BERDL environment readiness → a data card with the per-check breakdown + next steps. */
export function envCard(
  theme: Theme,
  env: { location: string; ready: boolean; checks?: Record<string, boolean>; next_steps?: string[] },
): Component {
  const lines: string[] = [
    `${theme.fg("muted", "Location  ")}${theme.fg("text", env.location)}`,
    `${theme.fg("muted", "Status    ")}${
      env.ready ? theme.fg("success", `ready ${GLYPH.ok}`) : theme.fg("warning", `not ready ${GLYPH.bad}`)
    }`,
  ];
  for (const [name, ok] of Object.entries(env.checks ?? {})) {
    lines.push(`  ${ok ? theme.fg("success", GLYPH.ok) : theme.fg("error", GLYPH.bad)} ${theme.fg("text", name)}`);
  }
  if (!env.ready && env.next_steps?.length) {
    lines.push("", theme.fg("muted", "Next steps"));
    for (const step of env.next_steps) lines.push(`  ${theme.fg("dim", GLYPH.arrow)} ${theme.fg("text", step)}`);
  }
  return linesCard(theme, {
    title: `BERDL ${GLYPH.bullet} ${env.location}`,
    accentStyle: domainStyle(theme, "data"),
    lines,
    maxBodyLines: 20,
  });
}

/** Format literature records as a markdown bullet list. Pure. */
export function formatLitMarkdown(records: LitRecord[], limit: number): string {
  const shown = records.slice(0, limit);
  const bullets = shown.map((r) => {
    const authors = r.authors?.length
      ? ` — ${r.authors.slice(0, 3).join(", ")}${r.authors.length > 3 ? " et al." : ""}`
      : "";
    const venue = `*${r.journal ?? "?"}* (${r.year ?? "?"})`;
    // PMID link when present (PubMed); otherwise a DOI link (Europe-PMC-only records).
    const id = r.pmid
      ? ` · [PMID ${r.pmid}](https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/)`
      : r.doi
        ? ` · [DOI ${r.doi}](https://doi.org/${r.doi})`
        : "";
    return `- **${r.title ?? "(untitled)"}**${authors}. ${venue}${id}`;
  });
  const more = records.length > shown.length ? `\n\n_… ${records.length - shown.length} more_` : "";
  return (bullets.join("\n") || "_(no results)_") + more;
}

export function litCard(theme: Theme, records: LitRecord[], expanded: boolean): Component {
  return markdownCard(theme, {
    title: cardHeader(theme, {
      title: `Literature ${GLYPH.bullet} ${records.length} result${records.length === 1 ? "" : "s"}`,
    }),
    accentStyle: domainStyle(theme, "literature"),
    state: "settled",
    markdown: formatLitMarkdown(records, expanded ? 25 : 6),
  });
}

/** Single fetched article → a one-record literature card. */
export function articleCard(theme: Theme, record: LitRecord): Component {
  return markdownCard(theme, {
    title: "Article",
    accentStyle: domainStyle(theme, "literature"),
    markdown: formatLitMarkdown([record], 1),
  });
}

/** A single article's abstract → a literature card with its citation + abstract text. */
export function abstractCard(theme: Theme, record: LitRecord, abstract: string): Component {
  const body = abstract.trim() ? abstract.trim() : "_(no abstract available)_";
  return markdownCard(theme, {
    title: "Abstract",
    accentStyle: domainStyle(theme, "literature"),
    markdown: `${formatLitMarkdown([record], 1)}\n\n${body}`,
  });
}

/** A fetched web page → a card carrying the source URL + retrieval date, then the extracted text. */
export function webDocCard(
  theme: Theme,
  d: { title: string; byline: string; markdown: string; finalUrl: string; retrievedAt: string; siteName: string },
): Component {
  const head = [
    d.byline ? theme.fg("muted", d.byline) : "",
    `${theme.fg("muted", "source ")}${theme.fg("text", hyperlink(d.finalUrl, d.finalUrl))}`,
    `${theme.fg("muted", "retrieved ")}${theme.fg("dim", d.retrievedAt)}${d.siteName ? theme.fg("dim", ` · ${d.siteName}`) : ""}`,
    "",
  ].filter((l) => l !== "");
  const body = d.markdown.trim() ? d.markdown.trim() : "_(no readable content extracted)_";
  return markdownCard(theme, {
    title: cardHeader(theme, { title: `Web ${GLYPH.bullet} ${d.title}` }),
    accentStyle: domainStyle(theme, "literature"),
    state: "settled",
    markdown: `${head.join("\n")}\n${body}`,
    maxBodyLines: 40,
  });
}

/** A library-docs lookup → a card with the source + snippets, or an honest best-effort note. */
export function docsCard(
  theme: Theme,
  r: {
    ok: boolean;
    library: string;
    libraryId?: string;
    snippets: string;
    note?: string;
    retrievedAt: string;
    sourceUrl: string;
  },
): Component {
  const head = [
    `${theme.fg("muted", "library ")}${theme.fg("text", r.libraryId ?? r.library)}`,
    `${theme.fg("muted", "source ")}${theme.fg("text", hyperlink(r.sourceUrl, r.sourceUrl))}`,
    `${theme.fg("muted", "retrieved ")}${theme.fg("dim", r.retrievedAt)} ${theme.fg("dim", "· Context7")}`,
    "",
  ];
  const body = r.ok ? r.snippets : `_${r.note ?? "no docs returned"}_`;
  return markdownCard(theme, {
    title: cardHeader(theme, { title: `Docs ${GLYPH.bullet} ${r.library}` }),
    accentStyle: domainStyle(theme, r.ok ? "literature" : "neutral"),
    state: r.ok ? "settled" : "warning",
    markdown: `${head.join("\n")}\n${body}`,
    maxBodyLines: 50,
  });
}

/** Short-form notebook hash digest (full hashes stay in `details`). */
export function hashCard(theme: Theme, hashes: Record<string, string>): Component {
  const entries = Object.entries(hashes);
  const accentStyle = domainStyle(theme, "governance");
  if (!entries.length)
    return linesCard(theme, {
      title: cardHeader(theme, { title: "Notebook hashes" }),
      accentStyle,
      state: "settled",
      lines: [theme.fg("muted", "(no notebooks)")],
    });
  const lines = entries.map(([nb, h]) => {
    const short = h.replace(/^sha256:/, "").slice(0, 12);
    return `${theme.fg("text", nb)}  ${theme.fg("dim", `sha256:${short}…`)}`;
  });
  lines.push("", verifyLine(theme, "rerun notebook_hash before review/submit"));
  return linesCard(theme, {
    title: cardHeader(theme, { title: `Notebook hashes ${GLYPH.bullet} ${entries.length}` }),
    accentStyle,
    state: "settled",
    lines,
    maxBodyLines: 12,
  });
}

export function lifecycleCard(theme: Theme, project: string, status: string): Component {
  return linesCard(theme, {
    title: cardHeader(theme, { title: "Lifecycle" }),
    accentStyle: domainStyle(theme, "governance"),
    state: "settled",
    lines: [`${theme.fg("text", project)} ${theme.fg("dim", GLYPH.arrow)} ${theme.fg("success", status)}`],
  });
}

export function userCard(
  theme: Theme,
  id: { name?: string; affiliation?: string; orcid?: string; complete?: boolean },
): Component {
  const v = (s?: string) => (s ? theme.fg("text", s) : theme.fg("muted", "(unset)"));
  const orcid = id.orcid
    ? theme.fg("text", hyperlink(id.orcid, `https://orcid.org/${id.orcid}`))
    : theme.fg("muted", "(unset)");
  const status = id.complete ? theme.fg("success", "complete") : theme.fg("warning", "incomplete (run `beril setup`)");
  return linesCard(theme, {
    title: cardHeader(theme, { title: "Researcher" }),
    accentStyle: domainStyle(theme, id.complete ? "governance" : "destructive"),
    state: id.complete ? "settled" : "warning",
    lines: [
      `Name        ${v(id.name)}`,
      `Affiliation ${v(id.affiliation)}`,
      `ORCID       ${orcid}`,
      `Identity    ${status}`,
    ],
  });
}

/** Generic destructive-result card (export / submit) — amber frame. */
export function destructiveResultCard(theme: Theme, title: string, lines: string[]): Component {
  return linesCard(theme, {
    title: cardHeader(theme, { title }),
    accentStyle: domainStyle(theme, "destructive"),
    state: "warning",
    lines,
    maxBodyLines: 16,
  });
}

/** Notebook scaffold result → created (success) + skipped-existing (dim). */
export function scaffoldCard(theme: Theme, r: { created: string[]; skipped: string[] }): Component {
  const lines = [
    ...r.created.map((p) => `${theme.fg("success", GLYPH.add)} ${theme.fg("text", p)}`),
    ...r.skipped.map((p) => theme.fg("dim", `${GLYPH.bullet} ${p} (exists)`)),
  ];
  if (!lines.length) lines.push(theme.fg("muted", "(no notebooks)"));
  lines.push("", verifyLine(theme, "open RESEARCH_PLAN.md and inspect generated notebooks before running"));
  return linesCard(theme, {
    title: cardHeader(theme, { title: `Notebooks scaffolded ${GLYPH.bullet} ${r.created.length} new` }),
    accentStyle: domainStyle(theme, "analysis"),
    state: "settled",
    lines,
    maxBodyLines: 24,
  });
}

export interface NotebookInfo {
  path: string;
  cells: number;
  has_outputs: boolean;
  execution_ok?: boolean | null;
  executed_at?: string | null;
}

/** Notebook listing → each with cell count and a saved-outputs indicator. */
export function notebookListCard(theme: Theme, notebooks: NotebookInfo[]): Component {
  const accentStyle = domainStyle(theme, "analysis");
  if (!notebooks.length) {
    return linesCard(theme, { title: "Notebooks", accentStyle, lines: [theme.fg("muted", "(none — scaffold first)")] });
  }
  const lines = notebooks.map((n) => {
    const mark = n.has_outputs
      ? theme.fg("success", `${GLYPH.ok} outputs`)
      : theme.fg("warning", `${GLYPH.pending} no outputs`);
    const exec =
      n.execution_ok === true
        ? theme.fg("success", `${GLYPH.ok} ran`)
        : n.execution_ok === false
          ? theme.fg("error", `${GLYPH.bad} failed`)
          : theme.fg("dim", "not run");
    return `${theme.fg("text", n.path)}  ${theme.fg("dim", `${n.cells} cells`)}  ${mark}  ${exec}`;
  });
  lines.push("", verifyLine(theme, "open notebooks with no outputs, or rerun notebook_run"));
  return linesCard(theme, {
    title: `Notebooks ${GLYPH.bullet} ${notebooks.length}`,
    accentStyle,
    lines,
    maxBodyLines: 24,
  });
}

export interface NotebookRun {
  notebook: string;
  ok: boolean;
  error: string | null;
}

/** Notebook execution result → per-notebook ✓/✗ with the first error line. */
export function notebookRunCard(
  theme: Theme,
  r: { executed: NotebookRun[]; skipped?: { notebook: string; reason: string }[]; ok: boolean },
): Component {
  const lines = [
    ...(r.skipped ?? []).map((e) => theme.fg("dim", `${GLYPH.bullet} ${e.notebook} — ${e.reason}`)),
    ...r.executed.map((e) =>
      e.ok
        ? `${theme.fg("success", GLYPH.ok)} ${theme.fg("text", e.notebook)}`
        : `${theme.fg("error", GLYPH.bad)} ${theme.fg("text", e.notebook)} ${theme.fg("dim", e.error ? `— ${e.error.split("\n")[0]}` : "")}`,
    ),
  ];
  if (!lines.length) lines.push(theme.fg("muted", "(nothing executed)"));
  lines.push("", verifyLine(theme, "open executed notebooks and inspect saved outputs / first failed cell"));
  const title = cardHeader(theme, {
    title: r.ok
      ? `Notebooks executed ${GLYPH.bullet} ${r.executed.length} ${GLYPH.ok}`
      : "Notebooks executed · some failed",
    meta: [`${r.executed.length} run`],
  });
  return linesCard(theme, {
    title,
    accentStyle: domainStyle(theme, r.ok ? "analysis" : "destructive"),
    state: r.ok ? "success" : "error",
    lines,
    maxBodyLines: 30,
  });
}

/**
 * Map a claim status to its glyph + a colour-styled word. The glyph carries the
 * meaning even without colour; supports/refuted resolve through the colorblind-safe
 * role table (`palette.ts`), the operational states through theme tokens.
 */
function statusGlyph(theme: Theme, status: ClaimStatus): string {
  switch (status) {
    case "supported":
      return `${GLYPH.supports} ${roleStyle(theme, "supports")("supported")}`;
    case "refuted":
      return `${GLYPH.refutes} ${roleStyle(theme, "refutes")("refuted")}`;
    case "needs-replication":
      return `${GLYPH.replicate} ${theme.fg("warning", "needs-replication")}`;
    case "blocked":
      return `${GLYPH.blocked} ${theme.fg("error", "blocked")}`;
    case "needs-evidence":
      return `${GLYPH.unresolved} ${theme.fg("muted", "needs-evidence")}`;
    default:
      return `${GLYPH.pending} ${theme.fg("muted", "open")}`;
  }
}

/** A quiet confidence/caveat footer line: a filled-to-empty meter glyph + word, plus an optional dim caveat. */
export function confidenceFooter(theme: Theme, tier: ConfidenceTier, caveat?: string): string {
  const m: Record<ConfidenceTier, [string, ThemeColor]> = {
    high: [GLYPH.meterFull, "text"],
    medium: [GLYPH.meterHalf, "muted"],
    low: [GLYPH.meterLow, "dim"],
  };
  const [g, color] = m[tier];
  const c = `${g} ${theme.fg(color, `confidence: ${tier}`)}`;
  return c + (caveat ? theme.fg("dim", ` — ${caveat}`) : "");
}

/**
 * A quiet GROUNDEDNESS footer — the second calibrated-trust axis, rendered exactly
 * like `confidenceFooter`: a filled-to-empty meter glyph + WORD (never a number).
 * `mismatch` appends a plain-word caveat when the written confidence outruns the
 * evidence, so the gap reads as one phrase, not two competing numbers.
 */
export function groundingFooter(theme: Theme, g: GroundednessTier, mismatch?: boolean): string {
  const m: Record<GroundednessTier, [string, ThemeColor]> = {
    "well-grounded": [GLYPH.meterFull, "text"],
    "single-source": [GLYPH.meterHalf, "warning"],
    ungrounded: [GLYPH.meterLow, "dim"],
  };
  const [glyphChar, color] = m[g];
  const line = `${glyphChar} ${theme.fg(color, `grounding: ${g}`)}`;
  return line + (mismatch ? theme.fg("warning", " — written tier outruns evidence") : "");
}

/** Standard verification footer: one concrete way to check the artifact behind a card. */
export function verifyLine(theme: Theme, action: string): string {
  return `${theme.fg("muted", "Verify     ")}${theme.fg("text", action)}`;
}

// EvidenceView is the pure home; re-exported so existing importers keep working.
export type { EvidenceView };

/** Glyph for an evidence pointer's kind. */
const KIND_GLYPH: Record<EvidencePointer["kind"], string> = {
  query: GLYPH.kindQuery,
  notebook: GLYPH.kindNotebook,
  figure: GLYPH.kindFigure,
  paper: GLYPH.kindPaper,
  web: GLYPH.kindWeb,
  docs: GLYPH.kindDocs,
};

function evidenceLines(theme: Theme, items: EvidencePointer[]): string[] {
  return items.map((p) => {
    // Re-runnable results (query/notebook) read as text; literature/figures dim.
    const weight: ThemeColor = p.kind === "query" || p.kind === "notebook" ? "text" : "dim";
    return `  ${theme.fg("dim", KIND_GLYPH[p.kind])} ${theme.fg(weight, p.locator)} ${theme.fg("muted", `— ${p.relevance}`)}`;
  });
}

/** Map a claim status to the operational card state driving the border paint. */
function evidenceState(status: ClaimStatus): CardState {
  if (status === "refuted") return "error";
  if (status === "supported") return "success";
  return "settled";
}

/** A claim with its supporting AND refuting evidence, each a re-openable pointer. */
export function evidenceCard(theme: Theme, v: EvidenceView): Component {
  const evState = evidenceState(v.status);
  const grounding = groundednessForEvidence(v.supports);
  const mismatch = tierMismatch(v.confidence, grounding);
  const body: string[] = [
    `${statusGlyph(theme, v.status)}  ${confidenceFooter(theme, v.confidence)}`,
    // Only surface grounding when it DISAGREES with the written confidence — the
    // mismatch case. When they agree, the confidence footer already conveys it.
    ...(mismatch ? [groundingFooter(theme, grounding, mismatch)] : []),
    theme.fg("text", v.claim),
  ];
  const supportLines = v.supports.length ? evidenceLines(theme, v.supports) : [theme.fg("muted", "  (none)")];
  const refuteLines = v.refutes.length
    ? evidenceLines(theme, v.refutes)
    : [theme.fg("muted", `  none found${v.refutesSearched ? ` — searched ${v.refutesSearched}` : ""}`)];
  const sections = [
    { label: roleStyle(theme, "supports")(`${GLYPH.supports} Supports (${v.supports.length})`), lines: supportLines },
    { label: roleStyle(theme, "refutes")(`${GLYPH.refutes} Refutes (${v.refutes.length})`), lines: refuteLines },
  ];
  if (v.unresolved?.length) {
    sections.push({
      label: theme.fg("muted", `${GLYPH.unresolved} Unresolved (${v.unresolved.length})`),
      lines: v.unresolved.map((u) => `  ${theme.fg("dim", GLYPH.bullet)} ${theme.fg("text", u)}`),
    });
  }
  body.push("", verifyLine(theme, "open the listed source pointers, or rerun claim_ledger / evidence"));
  return linesCard(theme, {
    title: cardHeader(theme, {
      icon: statusIcon(theme, evState),
      title: "Evidence",
      summary: v.status,
      meta: [`${GLYPH.supports} ${v.supports.length}`, `${GLYPH.refutes} ${v.refutes.length}`],
    }),
    accentStyle: domainStyle(theme, "analysis"),
    state: evState,
    lines: body,
    sections,
    maxBodyLines: 40,
  });
}

export interface FeasibilityView {
  verdict: "answerable" | "partial" | "not-answerable";
  question: string;
  blockers: string[];
  opportunities: string[];
  checked: { table: string; column?: string; coverage?: number; exists: boolean }[];
}

/**
 * Decide a feasibility verdict from the probe results (pure, deterministic):
 * - any check missing entirely → `not-answerable`.
 * - any existing check whose coverage is below 0.5 → `partial`.
 * - otherwise → `answerable`.
 */
export function feasibilityVerdict(
  checked: { table: string; column?: string; coverage?: number; exists: boolean }[],
): FeasibilityView["verdict"] {
  const missing = checked.some((c) => !c.exists);
  if (missing) return "not-answerable";
  const sparse = checked.some((c) => c.exists && c.coverage != null && c.coverage < 0.5);
  if (sparse) return "partial";
  return "answerable";
}

export function feasibilityCard(theme: Theme, v: FeasibilityView): Component {
  const vc: Record<FeasibilityView["verdict"], [string, ThemeColor]> = {
    answerable: [GLYPH.ok, "success"],
    partial: [GLYPH.warn, "warning"],
    "not-answerable": [GLYPH.blocked, "error"],
  };
  const [g, color] = vc[v.verdict];
  const state: CardState = v.verdict === "answerable" ? "success" : v.verdict === "partial" ? "warning" : "error";
  const lines: string[] = [`${theme.fg(color, `${g} ${v.verdict}`)}  ${theme.fg("muted", v.question)}`, ""];
  for (const c of v.checked) {
    const cov = c.coverage != null ? ` ${theme.fg("dim", `${Math.round(c.coverage * 100)}% non-null`)}` : "";
    const mark = c.exists ? theme.fg("success", GLYPH.ok) : theme.fg("error", GLYPH.bad);
    lines.push(`  ${mark} ${theme.fg("text", c.table + (c.column ? `.${c.column}` : ""))}${cov}`);
  }
  const sections: { label: string; lines: string[] }[] = [];
  if (v.blockers.length) {
    sections.push({
      label: theme.fg("error", "Blockers"),
      lines: v.blockers.map((b) => `  ${theme.fg("dim", GLYPH.bullet)} ${theme.fg("text", b)}`),
    });
  }
  if (v.opportunities.length) {
    sections.push({
      label: theme.fg("success", "Opportunities"),
      lines: v.opportunities.map((o) => `  ${theme.fg("dim", GLYPH.arrow)} ${theme.fg("text", o)}`),
    });
  }
  return linesCard(theme, {
    title: cardHeader(theme, { title: `Feasibility ${GLYPH.bullet} ${v.verdict}` }),
    accentStyle: domainStyle(theme, "data"),
    state,
    lines,
    sections,
    maxBodyLines: 30,
  });
}

/** Status as a glyph + bare word (the colour-styled tag for a ledger cell). */
function statusTag(theme: Theme, status: ClaimStatus): string {
  return statusGlyph(theme, status);
}

/** The confidence tier as a meter glyph + colour-styled tier word for a ledger cell. */
function confidenceTag(theme: Theme, tier: ConfidenceTier): string {
  const m: Record<ConfidenceTier, [string, ThemeColor]> = {
    high: [GLYPH.meterFull, "text"],
    medium: [GLYPH.meterHalf, "muted"],
    low: [GLYPH.meterLow, "dim"],
  };
  const [g, color] = m[tier];
  return `${g} ${theme.fg(color, tier)}`;
}

/** Left-pad a (possibly ANSI-styled) cell to a target visible width. */
function padCell(cell: string, width: number): string {
  const pad = Math.max(0, width - visibleWidth(cell));
  return cell + " ".repeat(pad);
}

/**
 * The claim ledger as a `Hypothesis | Status | Confidence | Supports | Refutes |
 * Stale` table — one row per hypothesis/finding the read-only `claim_ledger` tool
 * parses out of `RESEARCH_PLAN.md` / `REPORT.md`. `ClaimRow` lives in the pure
 * `claim-ledger.ts` parser; this card only frames it.
 *
 * Hand-drawn (not `markdownTable`): the Status/Confidence/Stale cells carry glyphs
 * + per-role ANSI, which `markdownTable` would either escape or misalign (it sizes
 * columns by raw `.length`, counting the escape bytes). We align on `visibleWidth`.
 */
export function claimLedgerCard(theme: Theme, rows: ClaimRow[]): Component {
  const accentStyle = domainStyle(theme, "governance");
  if (!rows.length) {
    return linesCard(theme, {
      title: cardHeader(theme, { title: "Claim ledger" }),
      accentStyle,
      state: "settled",
      lines: [theme.fg("muted", "(no hypotheses/findings parsed yet)")],
    });
  }
  const cells = rows.map((r) => ({
    hypothesis: r.hypothesis,
    status: statusTag(theme, r.status),
    confidence: confidenceTag(theme, r.confidence),
    supports: `${GLYPH.supports} ${r.supports}`,
    refutes: `${GLYPH.refutes} ${r.refutes}`,
    stale: r.stale ? `${GLYPH.warn} stale` : "",
  }));
  const wHyp = Math.max(10, ...cells.map((c) => visibleWidth(c.hypothesis)));
  const wStatus = Math.max(...cells.map((c) => visibleWidth(c.status)));
  const wConf = Math.max(...cells.map((c) => visibleWidth(c.confidence)));
  const wSup = Math.max(...cells.map((c) => visibleWidth(c.supports)));
  const wRef = Math.max(...cells.map((c) => visibleWidth(c.refutes)));
  const lines = cells.map((c) =>
    [
      padCell(theme.fg("text", c.hypothesis), wHyp),
      padCell(c.status, wStatus),
      padCell(c.confidence, wConf),
      padCell(c.supports, wSup),
      padCell(c.refutes, wRef),
      c.stale ? theme.fg("warning", c.stale) : "",
    ]
      .join("  ")
      .trimEnd(),
  );
  lines.push("", verifyLine(theme, "open REPORT.md / RESEARCH_PLAN.md, then inspect a finding with evidence"));
  return linesCard(theme, {
    title: cardHeader(theme, { title: `Claim ledger ${GLYPH.bullet} ${rows.length}` }),
    accentStyle,
    state: "settled",
    lines,
    maxBodyLines: 60,
  });
}

export function claimStateCard(
  theme: Theme,
  rows: ClaimStateRow[],
  summary: ClaimStateSummary,
  persisted?: boolean,
): Component {
  const accentStyle = domainStyle(theme, "governance");
  const lines = [
    `${theme.fg("muted", "Claims     ")}${theme.fg("text", String(summary.total))}`,
    `${roleStyle(theme, "supports")("Supported  ")}${theme.fg("text", String(summary.supported))}`,
    `${roleStyle(theme, "refutes")("Refuted    ")}${theme.fg("text", String(summary.refuted))}`,
    `${theme.fg("muted", "Unsupported")}${theme.fg(summary.unsupported ? "warning" : "text", String(summary.unsupported).padStart(2))}`,
    `${theme.fg("muted", "Empty refutes")}${theme.fg(summary.emptyRefutes ? "warning" : "text", String(summary.emptyRefutes).padStart(1))}`,
    `${theme.fg("muted", "Synthesis bar")}${theme.fg(summary.synthesisBar ? "warning" : "text", String(summary.synthesisBar ?? 0).padStart(1))}`,
    `${theme.fg("muted", "Persisted  ")}${persisted ? theme.fg("success", "claims.json") : theme.fg("dim", "no")}`,
    "",
    ...rows.slice(0, 8).map((r) => `${statusTag(theme, r.status)}  ${theme.fg("text", r.claim)}`),
    "",
    verifyLine(theme, "open projects/<id>/claims.json, then inspect claim_ledger / evidence"),
  ];
  return linesCard(theme, {
    title: cardHeader(theme, { title: `Claim state ${GLYPH.bullet} ${summary.total}` }),
    accentStyle,
    state: summary.unsupported || summary.emptyRefutes ? "warning" : "settled",
    lines,
    maxBodyLines: 24,
  });
}

export function reviewPreflightCard(theme: Theme, v: ReviewPreflightView): Component {
  const lines = [
    `${theme.fg("muted", "Project       ")}${theme.fg("text", v.project)}`,
    `${theme.fg("muted", "Lifecycle     ")}${theme.fg("text", v.status ?? "unknown")}`,
    `${theme.fg("muted", "Report        ")}${v.report ? theme.fg("success", GLYPH.ok) : theme.fg("error", GLYPH.bad)}`,
    `${theme.fg("muted", "Hashes        ")}${theme.fg(v.notebookHashes ? "text" : "warning", String(v.notebookHashes))}`,
    `${theme.fg("muted", "Claims        ")}${theme.fg("text", String(v.claims.total))} ${theme.fg("dim", "total")}  ${roleStyle(theme, "supports")(`${v.claims.supported} supported`)}  ${roleStyle(theme, "refutes")(`${v.claims.refuted} refuted`)}`,
    `${theme.fg("muted", "Unsupported   ")}${theme.fg(v.claims.unsupported ? "warning" : "text", String(v.claims.unsupported))}`,
    `${theme.fg("muted", "Empty refutes ")}${theme.fg(v.claims.emptyRefutes ? "warning" : "text", String(v.claims.emptyRefutes))}`,
    `${theme.fg("muted", "Red-team      ")}${v.redTeam ? theme.fg("success", GLYPH.ok) : theme.fg("warning", GLYPH.warn)}`,
    `${theme.fg("muted", "Review        ")}${v.review ? theme.fg("success", GLYPH.ok) : theme.fg("warning", GLYPH.warn)}`,
    `${theme.fg("muted", "Review ready  ")}${v.reviewReady ? theme.fg("success", "review ready") : theme.fg("warning", "not ready")}`,
    `${theme.fg("muted", "Submit ready  ")}${v.submitReady ? theme.fg("success", "submit ready") : theme.fg("warning", "not ready")}`,
  ];
  if (v.blockers.length) {
    lines.push("", theme.fg("error", "Blockers"));
    for (const blocker of v.blockers) lines.push(`  ${theme.fg("dim", GLYPH.bullet)} ${theme.fg("text", blocker)}`);
  }
  if (v.warnings.length) {
    lines.push("", theme.fg("warning", "Warnings"));
    for (const warning of v.warnings) lines.push(`  ${theme.fg("dim", GLYPH.bullet)} ${theme.fg("text", warning)}`);
  }
  lines.push("", verifyLine(theme, "run claim_state, /berdl-refute, /berdl-review, then /submit when ready"));
  return linesCard(theme, {
    title: cardHeader(theme, { title: `Preflight ${GLYPH.bullet} ${v.project}` }),
    accentStyle: domainStyle(theme, v.submitReady ? "governance" : "destructive"),
    state: v.submitReady ? "settled" : "warning",
    lines,
    maxBodyLines: 32,
  });
}

/**
 * The red-team pass as its own ⊖-framed card (deliberately NOT an `errorCard`): a
 * surviving-disconfirming-checks list over a refutes-coloured frame, plus a dim
 * pointer to the full pass on disk. Pure builder — the caller decides when to
 * surface it.
 */
export function redTeamCard(theme: Theme, opts: { project: string; surviving: string[]; path: string }): Component {
  const lines = opts.surviving.length
    ? opts.surviving.map((s) => `  ${theme.fg("dim", GLYPH.refutes)} ${theme.fg("text", s)}`)
    : [theme.fg("muted", "  (no surviving disconfirming checks)")];
  lines.push("", theme.fg("dim", `full pass: ${opts.path}`));
  return linesCard(theme, {
    title: `${GLYPH.refutes} Red-team ${GLYPH.bullet} ${opts.project}`,
    accentStyle: roleStyle(theme, "refutes"),
    lines,
    maxBodyLines: 30,
  });
}
