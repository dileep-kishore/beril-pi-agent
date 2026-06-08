import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { berilExec } from "../lib/beril-exec.ts";
import { clampSampleLimit, describeSql, formatPeek, isPlausibleTable, sampleSql } from "../lib/peek.ts";
import { requireReady } from "../lib/readiness.ts";
import { renderTable } from "../lib/render.ts";
import { type DiscoverSnapshot, discoverSummary } from "../lib/ui/discover.ts";
import {
  type QueryView,
  callLine,
  destructiveResultCard,
  discoverCard,
  kvLines,
  partialLine,
  peekCard,
  queryCard,
} from "../lib/ui/science-cards.ts";

const EXPORT_FORMATS = ["parquet", "delta", "json", "csv"] as const;
const EXPORT_MODES = ["overwrite", "append"] as const;

interface QueryPayload {
  returned_rows: number;
  rows: Record<string, unknown>[];
  limit_applied: number | null;
}

/** One-line, ANSI-trimmed SQL preview for a dimmed tool-call summary. */
function sqlPreview(query: string): string {
  const sql = query.replace(/\s+/g, " ").trim();
  return sql.length > 60 ? `${sql.slice(0, 59)}…` : sql;
}

export default function berilData(pi: ExtensionAPI) {
  pi.registerTool({
    name: "berdl_query",
    label: "Query BERDL",
    description:
      "Run a bounded, read-only SQL SELECT against the BERDL lakehouse. Returns up to `limit` rows (default 100).",
    parameters: Type.Object({
      query: Type.String({ description: "A single read-only SQL statement." }),
      limit: Type.Optional(Type.Integer({ description: "Row cap (default 100; -1 disables).", default: 100 })),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      await requireReady(pi);
      const limit = params.limit ?? 100;
      const payload = await berilExec<QueryPayload>(pi, ["query", "--query", params.query, "--limit", String(limit)]);
      const note = payload.limit_applied != null ? ` (limit ${payload.limit_applied})` : "";
      const text = `${payload.returned_rows} row(s)${note}\n${renderTable(payload.rows)}`;
      return { content: [{ type: "text", text }], details: payload };
    },
    renderCall(args, theme) {
      return callLine(theme, `query · ${sqlPreview(args.query)} (limit ${args.limit ?? 100})`);
    },
    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) return partialLine(theme, "Querying…");
      return queryCard(theme, result.details as QueryView, expanded);
    },
  });

  pi.registerTool({
    name: "berdl_discover",
    label: "Discover BERDL collections",
    description:
      "Explore BERDL access-awarely in two cheap steps. Default (no args): the accessible-collections INVENTORY — databases grouped by tenant, fast. Pass `database` to list THAT database's tables (names + descriptions, no column schemas). To read a table's columns + sample rows, use `berdl_peek`. Never scans every table.",
    parameters: Type.Object({
      database: Type.Optional(
        Type.String({ description: "Scope to one database to list its tables. Omit for the inventory." }),
      ),
      max_databases: Type.Optional(Type.Integer({ description: "Cap databases in the inventory." })),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      await requireReady(pi);
      const args = ["discover"];
      if (params.database) args.push("--database", params.database);
      if (params.max_databases != null) args.push("--max-databases", String(params.max_databases));
      const snap = await berilExec<DiscoverSnapshot>(pi, args);
      // Hand the model a compact summary (full snapshot stays in details for the
      // card) so it leads with the structure instead of echoing raw JSON.
      return { content: [{ type: "text", text: discoverSummary(snap) }], details: snap };
    },
    renderCall(args, theme) {
      return callLine(
        theme,
        args.database ? `discover · tables in ${args.database}` : "discover · accessible collections",
      );
    },
    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) return partialLine(theme, "Discovering collections…");
      return discoverCard(theme, result.details as DiscoverSnapshot, expanded);
    },
  });

  pi.registerTool({
    name: "berdl_peek",
    label: "Preview BERDL table",
    description:
      "Preview a BERDL table in one call: its column schema (types + comments) and a few sample rows. Use to SEE what a table actually contains before building a query or analysis on it. Does not count rows (avoids full scans on large tables).",
    parameters: Type.Object({
      table: Type.String({ description: "Fully-qualified table, e.g. kbase.ke_pangenome.genome." }),
      limit: Type.Optional(Type.Integer({ description: "Sample rows to show (default 5, max 50).", default: 5 })),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      await requireReady(pi);
      const table = params.table.trim();
      if (!isPlausibleTable(table)) {
        throw new Error(`Not a valid table identifier: "${table}". Expected db.table or catalog.db.table.`);
      }
      const limit = clampSampleLimit(params.limit);
      // Schema first, then a bounded sample. DESCRIBE can return many rows
      // (columns + partition metadata); cap generously so the schema isn't truncated.
      const describe = await berilExec<QueryPayload>(pi, ["query", "--query", describeSql(table), "--limit", "500"]);
      const sample = await berilExec<QueryPayload>(pi, [
        "query",
        "--query",
        sampleSql(table, limit),
        "--limit",
        String(limit),
      ]);
      const text = formatPeek(table, describe.rows, sample.rows);
      return { content: [{ type: "text", text }], details: { table, columns: describe.rows, sample: sample.rows } };
    },
    renderCall(args, theme) {
      return callLine(theme, `peek · ${args.table.trim()}`);
    },
    renderResult(result, { isPartial }, theme) {
      if (isPartial) return partialLine(theme, "Previewing table…");
      const d = result.details as {
        table: string;
        columns: Record<string, unknown>[];
        sample: Record<string, unknown>[];
      };
      return peekCard(theme, d);
    },
  });

  pi.registerCommand("berdl-preview", {
    description: "Preview a BERDL table's schema and a few sample rows (berdl_peek).",
    async handler(args: string, ctx: ExtensionCommandContext) {
      const table = args.trim();
      if (!table) {
        if (ctx.hasUI) ctx.ui.notify("Usage: /berdl-preview <db.table>", "warning");
        return;
      }
      pi.sendUserMessage(
        `Use the berdl_peek tool to preview the table "${table}", then briefly summarize what it contains and whether it looks usable for analysis.`,
      );
    },
  });

  pi.registerTool({
    name: "berdl_export",
    label: "Export query to MinIO",
    description:
      "Run a SQL query and write the FULL result set to a MinIO path. DESTRUCTIVE: mode 'overwrite' (default) replaces existing data. Requires confirmation.",
    parameters: Type.Object({
      query: Type.String({ description: "SQL statement whose result set is exported." }),
      path: Type.String({ description: "Destination s3a:// path." }),
      format: Type.Optional(StringEnum([...EXPORT_FORMATS], { description: "Output format (default parquet)." })),
      mode: Type.Optional(StringEnum([...EXPORT_MODES], { description: "Write mode (default overwrite)." })),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      await requireReady(pi);
      const args = ["export", "--query", params.query, "--path", params.path];
      if (params.format) args.push("--format", params.format);
      if (params.mode) args.push("--mode", params.mode);
      const manifest = await berilExec<Record<string, unknown>>(pi, args);
      const summary = `Exported the query result to ${params.path} (${params.format ?? "parquet"}, ${params.mode ?? "overwrite"}).`;
      return { content: [{ type: "text", text: summary }], details: { ...manifest, path: params.path } };
    },
    renderCall(args, theme) {
      return callLine(theme, `export → ${args.path} (${args.mode ?? "overwrite"}, destructive)`);
    },
    renderResult(result, { isPartial }, theme) {
      if (isPartial) return partialLine(theme, "Exporting…");
      const manifest = result.details as Record<string, unknown>;
      return destructiveResultCard(theme, "Export complete", kvLines(theme, manifest));
    },
  });
}
