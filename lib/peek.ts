/**
 * Pure helpers for the `berdl_peek` tool — a one-shot table preview (column
 * schema + a few sample rows) so a scientist can *see* what a table contains
 * before trusting an analysis built on it — scientists asked to see a table's
 * description and a few sample rows before committing to it.
 *
 * Row counts are deliberately NOT computed here: an unbounded `COUNT(*)` is a
 * full scan on the large BERDL tables (`gene`, `genome_ani`, …) and the query
 * skill forbids it. A preview shows shape and content, not size.
 */
import { renderTable } from "./render.ts";

/** Max sample rows a preview will pull, regardless of what was requested. */
const MAX_SAMPLE = 50;
const DEFAULT_SAMPLE = 5;

/** A fully-qualified BERDL table: 1–3 dot-separated identifier segments. */
const TABLE_RE = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+){0,2}$/;

/**
 * Whether `table` is a plausible BERDL table identifier. Used as an injection
 * guard before interpolating into `DESCRIBE`/`SELECT` (these are not
 * parameterizable in Spark SQL), so it admits only identifier characters and
 * dots — never quotes, whitespace, or semicolons.
 */
export function isPlausibleTable(table: string): boolean {
  return TABLE_RE.test(table);
}

/** Clamp a requested sample size into [1, MAX_SAMPLE], defaulting when unset. */
export function clampSampleLimit(limit: number | undefined): number {
  if (limit == null || Number.isNaN(limit)) return DEFAULT_SAMPLE;
  return Math.max(1, Math.min(MAX_SAMPLE, Math.trunc(limit)));
}

/** SQL to read a table's column schema (returns col_name / data_type / comment rows). */
export function describeSql(table: string): string {
  return `DESCRIBE ${table}`;
}

/** SQL to pull a bounded sample of rows from a table. */
export function sampleSql(table: string, limit: number): string {
  return `SELECT * FROM ${table} LIMIT ${limit}`;
}

interface DescribeRow {
  col_name?: unknown;
  data_type?: unknown;
  comment?: unknown;
}

/**
 * Format a column-schema line. Spark `DESCRIBE` appends blank-named separator
 * rows and a `# Partition Information` section; we skip blank/`#` names so the
 * preview shows real columns only.
 */
function columnLines(describeRows: Record<string, unknown>[]): string[] {
  const lines: string[] = [];
  for (const raw of describeRows) {
    const row = raw as DescribeRow;
    const name = String(row.col_name ?? "").trim();
    if (!name || name.startsWith("#")) continue;
    const type = String(row.data_type ?? "").trim();
    const comment = String(row.comment ?? "").trim();
    lines.push(`  ${name}: ${type}${comment ? ` — ${comment}` : ""}`);
  }
  return lines;
}

/**
 * Compose the human/model-visible preview block: the table name, its columns
 * (type + comment when documented), and a small sample of rows. Undocumented
 * columns are shown plainly rather than guessed at.
 */
export function formatPeek(
  table: string,
  describeRows: Record<string, unknown>[],
  sampleRows: Record<string, unknown>[],
): string {
  const cols = columnLines(describeRows);
  const colBlock = cols.length ? `Columns:\n${cols.join("\n")}` : "Columns: (schema unavailable)";
  const sampleBlock = `Sample (${sampleRows.length} row${sampleRows.length === 1 ? "" : "s"}):\n${renderTable(sampleRows)}`;
  return `${table}\n${colBlock}\n\n${sampleBlock}`;
}
