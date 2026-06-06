import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Text } from "@earendil-works/pi-tui";
import type { LitRecord } from "../lit.ts";
import { linesCard, markdownCard } from "./card.ts";
import { markdownTable } from "./table.ts";

/**
 * The science artifacts as cards — one builder per tool result, so the data,
 * literature, and governance state a scientist actually cares about render as
 * titled, framed panels (the command itself recedes to a dimmed `callLine`).
 *
 * Titles are plain text (colour + bold carry the emphasis) to stay width-safe
 * across terminals; accents follow the theme tokens (`borderAccent` for reads,
 * `warning` for destructive/irreversible results, `success` for confirmations).
 * The formatting-heavy helpers (`formatLitMarkdown`, `peekMarkdown`) are pure and
 * unit-tested; the builders frame them with the WS1 card primitives.
 */

/** A dimmed one-line tool-call summary so the *command* recedes and the result card leads. */
export function callLine(theme: Theme, summary: string): Component {
  return new Text(theme.fg("dim", summary), 0, 0);
}

/** A transient one-liner while a tool is still streaming. */
export function partialLine(theme: Theme, message: string): Component {
  return new Text(theme.fg("warning", message), 0, 0);
}

export interface QueryView {
  returned_rows: number;
  rows: Record<string, unknown>[];
  limit_applied: number | null;
}

/** Bounded SQL result → a data card with a GFM table body. */
export function queryCard(theme: Theme, p: QueryView, expanded: boolean): Component {
  const noun = p.returned_rows === 1 ? "row" : "rows";
  const limitNote = p.limit_applied != null ? ` · limit ${p.limit_applied}` : "";
  const title = `Query · ${p.returned_rows} ${noun}${limitNote}`;
  if (!p.rows?.length) {
    return linesCard(theme, { title, lines: [theme.fg("muted", "(no rows returned)")] });
  }
  return markdownCard(theme, { title, markdown: markdownTable(p.rows, { maxRows: expanded ? 60 : 8 }) });
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
    title: `Table · ${view.table}`,
    markdown: peekMarkdown(view.columns, view.sample),
  });
}

/** Discover snapshot → a syntax-highlighted JSON card (schema-agnostic). */
export function discoverCard(theme: Theme, snapshot: Record<string, unknown>, expanded: boolean): Component {
  const json = JSON.stringify(snapshot, null, 2);
  return markdownCard(theme, {
    title: "Collections",
    markdown: `\`\`\`json\n${json}\n\`\`\``,
    maxBodyLines: expanded ? 80 : 12,
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
    title: `Literature · ${records.length} result${records.length === 1 ? "" : "s"}`,
    markdown: formatLitMarkdown(records, expanded ? 25 : 6),
  });
}

/** Single fetched article → a one-record literature card. */
export function articleCard(theme: Theme, record: LitRecord): Component {
  return markdownCard(theme, { title: "Article", markdown: formatLitMarkdown([record], 1) });
}

/** Short-form notebook hash digest (full hashes stay in `details`). */
export function hashCard(theme: Theme, hashes: Record<string, string>): Component {
  const entries = Object.entries(hashes);
  if (!entries.length)
    return linesCard(theme, { title: "Notebook hashes", lines: [theme.fg("muted", "(no notebooks)")] });
  const lines = entries.map(([nb, h]) => {
    const short = h.replace(/^sha256:/, "").slice(0, 12);
    return `${theme.fg("text", nb)}  ${theme.fg("dim", `sha256:${short}…`)}`;
  });
  return linesCard(theme, { title: `Notebook hashes · ${entries.length}`, lines, maxBodyLines: 12 });
}

export function lifecycleCard(theme: Theme, project: string, status: string): Component {
  return linesCard(theme, {
    title: "Lifecycle",
    accent: "success",
    lines: [`${theme.fg("text", project)} ${theme.fg("dim", "→")} ${theme.fg("success", status)}`],
  });
}

export function userCard(
  theme: Theme,
  id: { name?: string; affiliation?: string; orcid?: string; complete?: boolean },
): Component {
  const v = (s?: string) => (s ? theme.fg("text", s) : theme.fg("muted", "(unset)"));
  const status = id.complete ? theme.fg("success", "complete") : theme.fg("warning", "incomplete (run `beril setup`)");
  return linesCard(theme, {
    title: "Researcher",
    accent: id.complete ? "success" : "warning",
    lines: [
      `Name        ${v(id.name)}`,
      `Affiliation ${v(id.affiliation)}`,
      `ORCID       ${v(id.orcid)}`,
      `Identity    ${status}`,
    ],
  });
}

/** Generic destructive-result card (export / submit) — accent warning. */
export function destructiveResultCard(theme: Theme, title: string, lines: string[]): Component {
  return linesCard(theme, { title, accent: "warning", lines, maxBodyLines: 12 });
}

/** Notebook scaffold result → created (success) + skipped-existing (dim). */
export function scaffoldCard(theme: Theme, r: { created: string[]; skipped: string[] }): Component {
  const lines = [
    ...r.created.map((p) => `${theme.fg("success", "+")} ${theme.fg("text", p)}`),
    ...r.skipped.map((p) => theme.fg("dim", `· ${p} (exists)`)),
  ];
  if (!lines.length) lines.push(theme.fg("muted", "(no notebooks)"));
  return linesCard(theme, { title: `Notebooks scaffolded · ${r.created.length} new`, lines, maxBodyLines: 24 });
}

export interface NotebookInfo {
  path: string;
  cells: number;
  has_outputs: boolean;
}

/** Notebook listing → each with cell count and a saved-outputs indicator. */
export function notebookListCard(theme: Theme, notebooks: NotebookInfo[]): Component {
  if (!notebooks.length) {
    return linesCard(theme, { title: "Notebooks", lines: [theme.fg("muted", "(none — scaffold first)")] });
  }
  const lines = notebooks.map((n) => {
    const mark = n.has_outputs ? theme.fg("success", "✓ outputs") : theme.fg("warning", "○ no outputs");
    return `${theme.fg("text", n.path)}  ${theme.fg("dim", `${n.cells} cells`)}  ${mark}`;
  });
  return linesCard(theme, { title: `Notebooks · ${notebooks.length}`, lines, maxBodyLines: 24 });
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
      ? `${theme.fg("success", "✓")} ${theme.fg("text", e.notebook)}`
      : `${theme.fg("error", "✗")} ${theme.fg("text", e.notebook)} ${theme.fg("dim", e.error ? `— ${e.error.split("\n")[0]}` : "")}`,
  );
  if (!lines.length) lines.push(theme.fg("muted", "(nothing executed)"));
  const title = r.ok ? `Notebooks executed · ${r.executed.length} ✓` : "Notebooks executed · some failed";
  return linesCard(theme, { title, accent: r.ok ? "success" : "warning", lines, maxBodyLines: 30 });
}
