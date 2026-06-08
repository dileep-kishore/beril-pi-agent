import type { Theme } from "@earendil-works/pi-coding-agent";
import { GLYPH } from "./glyphs.ts";

/**
 * Render a BERDL discover snapshot as a structured, scannable list instead of a
 * raw `JSON.stringify` fence — the one "make the data visible" artifact that was
 * the least digested. Two shapes, both from `discover_berdl_collections.py`:
 *
 *   inventory  → tenants, each with its databases (name + description)
 *   scoped     → one database's tables (name + row count + description)
 *
 * Pure: takes a theme + the snapshot and returns pre-styled lines (the card
 * frames them). Schema is read defensively — discover accumulates per-item
 * errors rather than failing, so fields can be missing.
 */

export type DiscoverTheme = Pick<Theme, "fg" | "bold">;

interface Table {
  name?: string;
  description?: string;
  row_count?: number | null;
}
interface Collection {
  id?: string;
  name?: string;
  description?: string;
  tables?: Table[];
}
interface Tenant {
  id?: string;
  name?: string;
  collections?: Collection[];
}
export interface DiscoverSnapshot {
  tenants?: Tenant[];
  scope?: { database?: string };
}

function isScoped(snap: DiscoverSnapshot): boolean {
  return typeof snap.scope?.database === "string" && snap.scope.database.length > 0;
}

function dbName(c: Collection): string {
  return c.name || c.id || "(unnamed)";
}

function fmtRows(n: number | null | undefined): string {
  if (n == null) return "";
  return n < 1000 ? `${n} rows` : `${(n / 1000).toFixed(1)}k rows`;
}

/** A one-line title summarising the snapshot, for the card header. */
export function discoverTitle(snap: DiscoverSnapshot): string {
  const tenants = snap.tenants ?? [];
  if (isScoped(snap)) {
    const tables = tenants[0]?.collections?.[0]?.tables ?? [];
    return `Tables in ${snap.scope?.database} · ${tables.length}`;
  }
  const dbs = tenants.reduce((n, t) => n + (t.collections?.length ?? 0), 0);
  const tNoun = tenants.length === 1 ? "tenant" : "tenants";
  const dNoun = dbs === 1 ? "database" : "databases";
  return `Collections · ${tenants.length} ${tNoun} · ${dbs} ${dNoun}`;
}

/**
 * A compact, plain-markdown summary of the snapshot — the text handed to the
 * model as the tool result `content`, so it gets the structure without the raw
 * JSON it would otherwise echo back. The full object stays in `details` for the
 * (themed) card.
 */
export function discoverSummary(snap: DiscoverSnapshot): string {
  const tenants = snap.tenants ?? [];
  const head = discoverTitle(snap);

  if (isScoped(snap)) {
    const tables = tenants[0]?.collections?.[0]?.tables ?? [];
    if (!tables.length) return `${head}\n(no tables)`;
    const rows = tables.map((t) => {
      const count = t.row_count != null ? ` (${fmtRows(t.row_count)})` : "";
      const desc = t.description ? ` — ${t.description}` : "";
      return `- ${t.name ?? "(unnamed)"}${count}${desc}`;
    });
    return `${head}\n${rows.join("\n")}`;
  }

  if (!tenants.length) return `${head}\n(no accessible collections)`;
  const groups = tenants.map((t) => {
    const dbs = (t.collections ?? []).map(dbName).join(", ") || "(no databases)";
    return `- ${t.name || t.id || "(tenant)"}: ${dbs}`;
  });
  return `${head}\n${groups.join("\n")}`;
}

/** The structured body lines for the discover card. */
export function discoverLines(theme: DiscoverTheme, snap: DiscoverSnapshot): string[] {
  const tenants = snap.tenants ?? [];

  if (isScoped(snap)) {
    const tables = tenants[0]?.collections?.[0]?.tables ?? [];
    if (!tables.length) return [theme.fg("muted", "(no tables)")];
    return tables.map((t) => {
      const name = theme.fg("text", t.name || "(unnamed)");
      const rows = t.row_count != null ? theme.fg("dim", `  ${fmtRows(t.row_count)}`) : "";
      const desc = t.description ? theme.fg("dim", `  ${t.description}`) : "";
      return `${name}${rows}${desc}`;
    });
  }

  if (!tenants.length) return [theme.fg("muted", "(no accessible collections)")];

  const lines: string[] = [];
  tenants.forEach((tenant, i) => {
    if (i > 0) lines.push("");
    const collections = tenant.collections ?? [];
    lines.push(theme.bold(theme.fg("accent", tenant.name || tenant.id || "(tenant)")));
    if (!collections.length) {
      lines.push(theme.fg("dim", "  (no databases)"));
      return;
    }
    for (const c of collections) {
      const name = theme.fg("text", dbName(c));
      const desc = c.description ? theme.fg("dim", `  ${c.description}`) : "";
      lines.push(`  ${GLYPH.bullet} ${name}${desc}`);
    }
  });
  return lines;
}
