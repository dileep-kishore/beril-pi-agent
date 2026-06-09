import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { type Component, Text } from "@earendil-works/pi-tui";
import type { ClaimRow } from "../claim-ledger.ts";
import type { LitRecord } from "../lit.ts";
import type { ClaimStatus, ConfidenceTier, EvidencePointer } from "../science.ts";
import { linesCard, markdownCard, textCard } from "./card.ts";
import { type DiscoverSnapshot, discoverLines, discoverTitle } from "./discover.ts";
import { GLYPH } from "./glyphs.ts";
import { hyperlink } from "./links.ts";
import { domainStyle } from "./palette.ts";
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
  return new Text(theme.fg("warning", message), 0, 0);
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
 */
export function errorCard(theme: Theme, message: string): Component {
  return textCard(theme, {
    title: `${GLYPH.bad} Error`,
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
  const title = `Query ${GLYPH.bullet} ${p.returned_rows} ${noun}${limitNote}`;
  const accentStyle = domainStyle(theme, "data");
  if (!p.rows?.length) {
    return linesCard(theme, { title, accentStyle, lines: [theme.fg("muted", "(no rows returned)")] });
  }
  return markdownCard(theme, { title, accentStyle, markdown: markdownTable(p.rows, { maxRows: expanded ? 60 : 8 }) });
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
    title: `Table ${GLYPH.bullet} ${view.table}`,
    accentStyle: domainStyle(theme, "data"),
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
    title: discoverTitle(snapshot),
    accentStyle: domainStyle(theme, "data"),
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
    const pmid = r.pmid ? ` · [PMID ${r.pmid}](https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/)` : "";
    return `- **${r.title ?? "(untitled)"}**${authors}. ${venue}${pmid}`;
  });
  const more = records.length > shown.length ? `\n\n_… ${records.length - shown.length} more_` : "";
  return (bullets.join("\n") || "_(no results)_") + more;
}

export function litCard(theme: Theme, records: LitRecord[], expanded: boolean): Component {
  return markdownCard(theme, {
    title: `Literature ${GLYPH.bullet} ${records.length} result${records.length === 1 ? "" : "s"}`,
    accentStyle: domainStyle(theme, "literature"),
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

/** Short-form notebook hash digest (full hashes stay in `details`). */
export function hashCard(theme: Theme, hashes: Record<string, string>): Component {
  const entries = Object.entries(hashes);
  const accentStyle = domainStyle(theme, "governance");
  if (!entries.length)
    return linesCard(theme, { title: "Notebook hashes", accentStyle, lines: [theme.fg("muted", "(no notebooks)")] });
  const lines = entries.map(([nb, h]) => {
    const short = h.replace(/^sha256:/, "").slice(0, 12);
    return `${theme.fg("text", nb)}  ${theme.fg("dim", `sha256:${short}…`)}`;
  });
  return linesCard(theme, {
    title: `Notebook hashes ${GLYPH.bullet} ${entries.length}`,
    accentStyle,
    lines,
    maxBodyLines: 12,
  });
}

export function lifecycleCard(theme: Theme, project: string, status: string): Component {
  return linesCard(theme, {
    title: "Lifecycle",
    accentStyle: domainStyle(theme, "governance"),
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
    title: "Researcher",
    accentStyle: domainStyle(theme, id.complete ? "governance" : "destructive"),
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
  return linesCard(theme, { title, accentStyle: domainStyle(theme, "destructive"), lines, maxBodyLines: 16 });
}

/** Notebook scaffold result → created (success) + skipped-existing (dim). */
export function scaffoldCard(theme: Theme, r: { created: string[]; skipped: string[] }): Component {
  const lines = [
    ...r.created.map((p) => `${theme.fg("success", GLYPH.add)} ${theme.fg("text", p)}`),
    ...r.skipped.map((p) => theme.fg("dim", `${GLYPH.bullet} ${p} (exists)`)),
  ];
  if (!lines.length) lines.push(theme.fg("muted", "(no notebooks)"));
  return linesCard(theme, {
    title: `Notebooks scaffolded ${GLYPH.bullet} ${r.created.length} new`,
    accentStyle: domainStyle(theme, "analysis"),
    lines,
    maxBodyLines: 24,
  });
}

export interface NotebookInfo {
  path: string;
  cells: number;
  has_outputs: boolean;
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
    return `${theme.fg("text", n.path)}  ${theme.fg("dim", `${n.cells} cells`)}  ${mark}`;
  });
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
export function notebookRunCard(theme: Theme, r: { executed: NotebookRun[]; ok: boolean }): Component {
  const lines = r.executed.map((e) =>
    e.ok
      ? `${theme.fg("success", GLYPH.ok)} ${theme.fg("text", e.notebook)}`
      : `${theme.fg("error", GLYPH.bad)} ${theme.fg("text", e.notebook)} ${theme.fg("dim", e.error ? `— ${e.error.split("\n")[0]}` : "")}`,
  );
  if (!lines.length) lines.push(theme.fg("muted", "(nothing executed)"));
  const title = r.ok
    ? `Notebooks executed ${GLYPH.bullet} ${r.executed.length} ${GLYPH.ok}`
    : "Notebooks executed · some failed";
  return linesCard(theme, {
    title,
    accentStyle: domainStyle(theme, r.ok ? "analysis" : "destructive"),
    lines,
    maxBodyLines: 30,
  });
}

/** Map a claim status to a glyph + theme colour key. */
function statusGlyph(theme: Theme, status: ClaimStatus): string {
  const m: Record<ClaimStatus, [string, ThemeColor]> = {
    supported: [GLYPH.ok, "success"],
    refuted: [GLYPH.bad, "error"],
    "needs-replication": [GLYPH.pending, "warning"],
    blocked: [GLYPH.bad, "muted"],
    "needs-evidence": [GLYPH.pending, "warning"],
    open: [GLYPH.bullet, "muted"],
  };
  const [g, color] = m[status];
  return theme.fg(color, `${g} ${status}`);
}

const TIER_COLOR: Record<ConfidenceTier, ThemeColor> = { high: "success", medium: "warning", low: "muted" };

/** A quiet, dim confidence/caveat footer line to append under a result card body. */
export function confidenceFooter(theme: Theme, tier: ConfidenceTier, caveat?: string): string {
  const c = theme.fg(TIER_COLOR[tier], `confidence: ${tier}`);
  return theme.fg("dim", `${GLYPH.bullet} `) + c + (caveat ? theme.fg("dim", ` — ${caveat}`) : "");
}

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

function evidenceLines(theme: Theme, items: EvidencePointer[]): string[] {
  return items.map(
    (p) =>
      `  ${theme.fg("dim", `[${p.kind}]`)} ${theme.fg("text", p.locator)} ${theme.fg("muted", `— ${p.relevance}`)}`,
  );
}

/** A claim with its supporting AND refuting evidence, each a re-openable pointer. */
export function evidenceCard(theme: Theme, v: EvidenceView): Component {
  const lines: string[] = [
    `${statusGlyph(theme, v.status)}  ${theme.fg(TIER_COLOR[v.confidence], `confidence: ${v.confidence}`)}`,
    theme.fg("text", v.claim),
    "",
    theme.fg("success", `Supports (${v.supports.length})`),
    ...(v.supports.length ? evidenceLines(theme, v.supports) : [theme.fg("muted", "  (none)")]),
    "",
    theme.fg("error", `Refutes (${v.refutes.length})`),
    ...(v.refutes.length
      ? evidenceLines(theme, v.refutes)
      : [theme.fg("muted", `  none found${v.refutesSearched ? ` — searched ${v.refutesSearched}` : ""}`)]),
  ];
  if (v.unresolved?.length) {
    lines.push("", theme.fg("warning", "Unresolved"));
    for (const u of v.unresolved) lines.push(`  ${theme.fg("dim", GLYPH.bullet)} ${theme.fg("text", u)}`);
  }
  return linesCard(theme, {
    title: `Evidence ${GLYPH.bullet} ${v.status}`,
    accentStyle: domainStyle(theme, "analysis"),
    lines,
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
    partial: [GLYPH.pending, "warning"],
    "not-answerable": [GLYPH.bad, "error"],
  };
  const [g, color] = vc[v.verdict];
  const lines: string[] = [`${theme.fg(color, `${g} ${v.verdict}`)}  ${theme.fg("muted", v.question)}`, ""];
  for (const c of v.checked) {
    const cov = c.coverage != null ? ` ${theme.fg("dim", `${Math.round(c.coverage * 100)}% non-null`)}` : "";
    const mark = c.exists ? theme.fg("success", GLYPH.ok) : theme.fg("error", GLYPH.bad);
    lines.push(`  ${mark} ${theme.fg("text", c.table + (c.column ? `.${c.column}` : ""))}${cov}`);
  }
  if (v.blockers.length) {
    lines.push("", theme.fg("error", "Blockers"));
    for (const b of v.blockers) lines.push(`  ${theme.fg("dim", GLYPH.bullet)} ${theme.fg("text", b)}`);
  }
  if (v.opportunities.length) {
    lines.push("", theme.fg("success", "Opportunities"));
    for (const o of v.opportunities) lines.push(`  ${theme.fg("dim", GLYPH.arrow)} ${theme.fg("text", o)}`);
  }
  return linesCard(theme, {
    title: `Feasibility ${GLYPH.bullet} ${v.verdict}`,
    accentStyle: domainStyle(theme, "data"),
    lines,
    maxBodyLines: 30,
  });
}

/**
 * The claim ledger as a `Status | Confidence | Supports | Refutes | Stale?`
 * table — one row per hypothesis/finding the read-only `claim_ledger` tool
 * parses out of `RESEARCH_PLAN.md` / `REPORT.md`. `ClaimRow` lives in the pure
 * `claim-ledger.ts` parser; this card only frames it.
 */
export function claimLedgerCard(theme: Theme, rows: ClaimRow[]): Component {
  const accentStyle = domainStyle(theme, "governance");
  if (!rows.length) {
    return linesCard(theme, {
      title: "Claim ledger",
      accentStyle,
      lines: [theme.fg("muted", "(no hypotheses/findings parsed yet)")],
    });
  }
  const table = rows.map((r) => ({
    Hypothesis: r.hypothesis,
    Status: r.status,
    Confidence: r.confidence,
    Supports: r.supports,
    Refutes: r.refutes,
    Stale: r.stale ? "yes" : "",
  }));
  return markdownCard(theme, {
    title: `Claim ledger ${GLYPH.bullet} ${rows.length}`,
    accentStyle,
    markdown: markdownTable(table as unknown as Record<string, unknown>[], { maxRows: 60 }),
  });
}
