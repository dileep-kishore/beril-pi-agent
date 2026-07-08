import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { berilExec, isConnectivityError, isPermissionError, permissionGuidance } from "../lib/beril-exec.ts";
import { discoverHint, queryHint } from "../lib/hints.ts";
import { clampSampleLimit, describeSql, formatPeek, isPlausibleTable, sampleSql } from "../lib/peek.ts";
import { requireReady } from "../lib/readiness.ts";
import { renderTable } from "../lib/render.ts";
import { type DiscoverSnapshot, discoverSummary } from "../lib/ui/discover.ts";
import { type ValidationResult, validationCard } from "../lib/ui/koros-cards.ts";
import {
  type QueryView,
  callLine,
  destructiveResultCard,
  discoverCard,
  errorCard,
  feasibilityCard,
  feasibilityVerdict,
  kvLines,
  partialLine,
  peekCard,
  queryCard,
  toolErrorText,
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
  // Add model-facing next-step hints without changing the structured `details`
  // payload that cards, hashes, and downstream checks rely on.
  pi.on("tool_result", (event, _ctx) => {
    if (event.isError) return undefined;

    let hint: string | undefined;
    if (event.toolName === "berdl_query") {
      const details = event.details as { returned_rows?: number; limit_applied?: number | null } | undefined;
      hint = queryHint(details?.returned_rows ?? 0, details?.limit_applied ?? null);
    } else if (event.toolName === "berdl_discover") {
      hint = discoverHint(event.details);
    } else {
      return undefined;
    }

    if (!hint) return undefined;
    return { content: [...event.content, { type: "text", text: hint }] };
  });

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
      let payload: QueryPayload;
      try {
        payload = await berilExec<QueryPayload>(pi, ["query", "--query", params.query, "--limit", String(limit)]);
      } catch (err) {
        if (isPermissionError(err)) throw new Error(permissionGuidance(err));
        throw err;
      }
      const note = payload.limit_applied != null ? ` (limit ${payload.limit_applied})` : "";
      const text = `${payload.returned_rows} row(s)${note}\n${renderTable(payload.rows)}`;
      return { content: [{ type: "text", text }], details: payload };
    },
    renderCall(args, theme) {
      return callLine(theme, `query · ${sqlPreview(args.query)} (limit ${args.limit ?? 100})`);
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
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
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
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
      let describe: QueryPayload;
      let sample: QueryPayload;
      try {
        describe = await berilExec<QueryPayload>(pi, ["query", "--query", describeSql(table), "--limit", "500"]);
        sample = await berilExec<QueryPayload>(pi, [
          "query",
          "--query",
          sampleSql(table, limit),
          "--limit",
          String(limit),
        ]);
      } catch (err) {
        if (isPermissionError(err)) throw new Error(permissionGuidance(err));
        throw err;
      }
      const text = formatPeek(table, describe.rows, sample.rows);
      return { content: [{ type: "text", text }], details: { table, columns: describe.rows, sample: sample.rows } };
    },
    renderCall(args, theme) {
      return callLine(theme, `peek · ${args.table.trim()}`);
    },
    renderResult(result, { isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      if (isPartial) return partialLine(theme, "Previewing table…");
      const d = result.details as {
        table: string;
        columns: Record<string, unknown>[];
        sample: Record<string, unknown>[];
      };
      return peekCard(theme, d);
    },
  });

  pi.registerTool({
    name: "berdl_feasibility",
    label: "Check data feasibility",
    description:
      "Before planning, check whether a research question is answerable with the available BERDL data. Pass the question, the candidate tables, and (optionally) the key columns each must have. Runs CHEAP probes only — column existence via DESCRIBE and a bounded non-null coverage count — never a full scan. Returns a per-check breakdown so you can render an honest 'answerable / partial / not-answerable' verdict and name the limiting tables BEFORE writing a plan.",
    parameters: Type.Object({
      question: Type.String({ description: "The research question, 1-2 sentences." }),
      checks: Type.Array(
        Type.Object({
          table: Type.String({ description: "Fully-qualified table, e.g. kbase.ke_pangenome.genome." }),
          column: Type.Optional(
            Type.String({ description: "A key column whose presence/coverage gates the question." }),
          ),
        }),
        { description: "The tables (and optional key columns) the question depends on." },
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      await requireReady(pi);
      const checked: { table: string; column?: string; coverage?: number; exists: boolean }[] = [];
      for (const c of params.checks) {
        const table = c.table.trim();
        if (!isPlausibleTable(table)) {
          checked.push({ table, column: c.column, exists: false });
          continue;
        }
        let cols: QueryPayload;
        try {
          cols = await berilExec<QueryPayload>(pi, ["query", "--query", describeSql(table), "--limit", "500"]);
        } catch (err) {
          // A transport outage (Spark Connect unreachable) means we COULDN'T CHECK —
          // not that the table is absent. Recording `exists: false` here would render
          // "<table> is absent" and a false "not-answerable" verdict, telling a
          // scientist their data can't answer the question during an infra outage.
          // Abort and let the tool surface the real connectivity error instead.
          if (isConnectivityError(err)) throw err;
          if (isPermissionError(err)) throw new Error(permissionGuidance(err));
          // A genuine resolution error (e.g. table not found) is a legitimate
          // feasibility finding — record it as absent and keep probing the rest.
          checked.push({ table, column: c.column, exists: false });
          continue;
        }
        const names = new Set(cols.rows.map((r) => String(r.col_name ?? r.column ?? r.name ?? "").toLowerCase()));
        if (!c.column) {
          checked.push({ table, exists: cols.rows.length > 0 });
          continue;
        }
        const exists = names.has(c.column.toLowerCase());
        let coverage: number | undefined;
        if (exists) {
          // Bounded coverage: non-null fraction over a capped sample (no full scan).
          const sql = `SELECT avg(CASE WHEN \`${c.column}\` IS NOT NULL THEN 1.0 ELSE 0.0 END) AS cov FROM (SELECT \`${c.column}\` FROM ${table} LIMIT 5000)`;
          try {
            const cov = await berilExec<QueryPayload>(pi, ["query", "--query", sql, "--limit", "1"]);
            const raw = cov.rows[0]?.cov;
            const num = typeof raw === "number" ? raw : Number(raw);
            if (Number.isFinite(num)) coverage = num;
          } catch (err) {
            // A transport outage means coverage was NOT measured — not that it's
            // adequate. Leaving it undefined would let the column read as a clean,
            // fully-populated "answerable" check (the verdict only flags sparsity
            // when coverage != null). Surface connectivity errors like the DESCRIBE
            // probe does; tolerate only genuine query failures (coverage undefined).
            if (isConnectivityError(err)) throw err;
            if (isPermissionError(err)) throw new Error(permissionGuidance(err));
          }
        }
        checked.push({ table, column: c.column, exists, coverage });
      }
      const text = checked
        .map(
          (c) =>
            `${c.exists ? "ok" : "MISSING"} ${c.table}${c.column ? `.${c.column}` : ""}${c.coverage != null ? ` (${Math.round(c.coverage * 100)}% non-null)` : ""}`,
        )
        .join("\n");
      return {
        content: [{ type: "text", text: text || "(no checks)" }],
        details: { question: params.question, checked },
      };
    },
    renderCall(args, theme) {
      return callLine(theme, `feasibility · ${args.checks?.length ?? 0} check(s)`);
    },
    renderResult(result, { isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      if (isPartial) return partialLine(theme, "Probing data feasibility…");
      const d = result.details as {
        question: string;
        checked: { table: string; column?: string; coverage?: number; exists: boolean }[];
      };
      const missing = d.checked.filter((c) => !c.exists);
      const sparse = d.checked.filter((c) => c.exists && c.coverage != null && c.coverage < 0.5);
      const verdict = feasibilityVerdict(d.checked);
      return feasibilityCard(theme, {
        verdict,
        question: d.question,
        blockers: [
          ...missing.map((c) => `${c.table}${c.column ? `.${c.column}` : ""} is absent`),
          ...sparse.map(
            (c) => `${c.table}.${c.column} is ${Math.round((c.coverage as number) * 100)}% non-null (sparse)`,
          ),
        ],
        opportunities: [],
        checked: d.checked,
      });
    },
  });

  pi.registerTool({
    name: "berdl_validate",
    label: "Check data validity",
    description:
      "Profile rows for the data-validity traps that silently corrupt analyses: zero-as-missing sentinels (0 ≠ measured), numbers stored as strings (lexicographic ordering inverts comparisons), near-constant columns, sparse coverage, and pseudoreplication (rows collapsing to few independent groups — pass group_col). Run it on the data feeding an analysis BEFORE building on it (pass sql to sample, or rows_json from a prior query). This is the data-validity JUDGMENT gate: report the findings, let the scientist decide, then record the verdict with gate_record.",
    parameters: Type.Object({
      sql: Type.Optional(Type.String({ description: "SELECT whose result rows are profiled (sampled, capped)." })),
      rows_json: Type.Optional(
        Type.String({ description: "A JSON array of flat row objects (e.g. from a prior berdl_query)." }),
      ),
      group_col: Type.Optional(
        Type.String({ description: "Independence-group column to check for pseudoreplication." }),
      ),
      axis: Type.Optional(Type.String({ description: "Categorical axis column to check group coverage on." })),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      let rows: unknown;
      if (params.sql) {
        await requireReady(pi);
        let payload: QueryPayload;
        try {
          payload = await berilExec<QueryPayload>(pi, ["query", "--query", params.sql, "--limit", "1000"]);
        } catch (err) {
          if (isPermissionError(err)) throw new Error(permissionGuidance(err));
          throw err;
        }
        rows = payload.rows;
      } else if (params.rows_json) {
        try {
          rows = JSON.parse(params.rows_json);
        } catch {
          throw new Error("rows_json is not valid JSON.");
        }
      } else {
        throw new Error("berdl_validate needs either sql or rows_json.");
      }
      if (!Array.isArray(rows) || rows.length === 0) throw new Error("No rows to validate.");
      const file = join(tmpdir(), `beril-validate-${randomUUID()}.json`);
      await writeFile(file, JSON.stringify(rows), "utf8");
      let result: ValidationResult;
      try {
        const args = ["validate", "--rows-json", file];
        if (params.group_col) args.push("--group-col", params.group_col);
        if (params.axis) args.push("--axis", params.axis);
        result = await berilExec<ValidationResult>(pi, args);
      } finally {
        await unlink(file).catch(() => {});
      }
      const findings = result.findings ?? [];
      const text = findings.length
        ? `${result.verdict}: ${findings.map((f) => `[${f.severity}] ${f.column ? `${f.column}: ` : ""}${f.detail}`).join("; ")}`
        : `pass: ${result.n_rows} rows profiled, no data-validity traps found.`;
      return { content: [{ type: "text", text }], details: result };
    },
    renderCall(args, theme) {
      const scope = args.sql ? sqlPreview(args.sql) : "rows from a prior query";
      return callLine(theme, `validate · ${scope}`);
    },
    renderResult(result, { isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      if (isPartial) return partialLine(theme, "Profiling data validity…");
      return validationCard(theme, result.details as ValidationResult);
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
    renderResult(result, { isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      if (isPartial) return partialLine(theme, "Exporting…");
      const manifest = result.details as Record<string, unknown>;
      return destructiveResultCard(theme, "Export complete", kvLines(theme, manifest));
    },
  });
}
