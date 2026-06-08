import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Text } from "@earendil-works/pi-tui";
import type { LitRecord } from "../lit.ts";
import { linesCard, markdownCard } from "./card.ts";
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

/** Discover snapshot → a structured tenant/database/table list (never raw JSON). */
export function discoverCard(theme: Theme, snapshot: DiscoverSnapshot, expanded: boolean): Component {
  return linesCard(theme, {
    title: discoverTitle(snapshot),
    accentStyle: domainStyle(theme, "data"),
    lines: discoverLines(theme, snapshot),
    maxBodyLines: expanded ? 200 : 16,
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
