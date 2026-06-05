import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { berilExec } from "../lib/beril-exec.ts";
import { requireReady } from "../lib/readiness.ts";
import { renderTable } from "../lib/render.ts";

interface QueryPayload {
  returned_rows: number;
  rows: Record<string, unknown>[];
  limit_applied: number | null;
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
  });

  pi.registerTool({
    name: "berdl_discover",
    label: "Discover BERDL collections",
    description: "List accessible BERDL databases/collections (access-aware). Use before querying to find tables.",
    parameters: Type.Object({
      max_databases: Type.Optional(Type.Integer({ description: "Cap databases scanned." })),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      await requireReady(pi);
      const args = ["discover"];
      if (params.max_databases != null) args.push("--max-databases", String(params.max_databases));
      const snap = await berilExec<Record<string, unknown>>(pi, args);
      return { content: [{ type: "text", text: JSON.stringify(snap, null, 2) }], details: snap };
    },
  });
}
