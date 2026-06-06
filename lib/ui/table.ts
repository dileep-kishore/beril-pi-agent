/**
 * Render row data as a GitHub-flavored markdown table.
 *
 * The pi-tui `Markdown` component renders GFM tables (width-aware cell wrapping),
 * so the cleanest way to show query/peek results as a *formatted* table inside a
 * card is to emit markdown and let `Markdown` lay it out — instead of the plain
 * monospace block in `lib/render.ts` (kept for non-card/plain contexts). Pure.
 */
export interface MarkdownTableOptions {
  /** Cap rows rendered; a trailing "… N more row(s)" note is appended. Default 15. */
  maxRows?: number;
  /** Cap per-cell characters (long values truncated with …). Default 32. */
  maxColWidth?: number;
}

function escapeCell(value: unknown, maxColWidth: number): string {
  let s = value === null || value === undefined ? "" : String(value);
  // Pipes break GFM table columns; newlines break the single-line cell contract.
  s = s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  if (s.length > maxColWidth) s = `${s.slice(0, Math.max(1, maxColWidth - 1))}…`;
  return s;
}

export function markdownTable(rows: Record<string, unknown>[], options: MarkdownTableOptions = {}): string {
  if (rows.length === 0) return "_(0 rows)_";
  const maxRows = options.maxRows ?? 15;
  const maxColWidth = options.maxColWidth ?? 32;
  const cols = Object.keys(rows[0]);
  if (cols.length === 0) return `_(${rows.length} row(s), no columns)_`;

  const header = `| ${cols.join(" | ")} |`;
  const sep = `| ${cols.map(() => "---").join(" | ")} |`;
  const body = rows.slice(0, maxRows).map((r) => `| ${cols.map((c) => escapeCell(r[c], maxColWidth)).join(" | ")} |`);
  const more = rows.length > maxRows ? `\n\n_… ${rows.length - maxRows} more row(s)_` : "";
  return [header, sep, ...body].join("\n") + more;
}
