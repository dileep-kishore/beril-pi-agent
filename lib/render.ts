/** Render up to `maxRows` of tabular data as a monospace text block. Pure; UI-agnostic. */
export function renderTable(rows: Record<string, unknown>[], maxRows = 20): string {
  if (rows.length === 0) return "(0 rows)";
  const cols = Object.keys(rows[0]);
  const head = cols.join(" | ");
  const sep = cols.map(() => "---").join(" | ");
  const body = rows.slice(0, maxRows).map((r) => cols.map((c) => String(r[c] ?? "")).join(" | "));
  const more = rows.length > maxRows ? `\n… ${rows.length - maxRows} more rows` : "";
  return [head, sep, ...body].join("\n") + more;
}
