import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { berilExec } from "../lib/beril-exec.ts";
import {
  type ProvenanceSnapshot,
  appendProjectTrace,
  buildProvenanceSnapshot,
  readProjectTrace,
  writeProvenanceSnapshot,
} from "../lib/project-audit.ts";
import { projectCompletions } from "../lib/project-completions.ts";
import { linesCard } from "../lib/ui/card.ts";
import { domainStyle } from "../lib/ui/palette.ts";
import { callLine, errorCard, partialLine, toolErrorText } from "../lib/ui/science-cards.ts";

function projectFromArgs(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const value = (args as { project?: unknown }).project;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

// Audit tools must never write a project's audit files just by being viewed —
// otherwise inspecting a STALE project bumps its provenance.json/TRACE.jsonl
// mtimes and `beril lifecycle current` misroutes it as the active project.
const AUDIT_TOOLS = new Set(["project_provenance", "project_trace"]);

export default function berilAudit(pi: ExtensionAPI) {
  // The trace is written ONLY here, when a research tool runs against a project.
  // /aside is untraceable by construction: it runs the model with `tools: []`
  // (see lib/aside.ts), so it never emits `tool_execution_start` and never
  // reaches this writer. The audit tools skip themselves — auditing the auditor
  // is what bumps mtime on inspection and causes a misroute.
  pi.on("tool_execution_start", async (event, ctx) => {
    if (AUDIT_TOOLS.has(event.toolName)) return;
    const project = projectFromArgs(event.args);
    if (!project) return;
    try {
      await appendProjectTrace(ctx.cwd, project, {
        event: "tool_execution_start",
        tool: event.toolName,
        tool_call_id: event.toolCallId,
        input: event.args,
      });
    } catch {
      // Best-effort audit trail; never interrupt the underlying tool call.
    }
  });

  // Write the ACTIVE project's runtime snapshot at the start of a turn, not on
  // view. Writing the already-current project cannot cause a misroute; viewing a
  // stale one no longer touches its files (the tool below is read-only).
  pi.on("before_agent_start", async (_event, ctx) => {
    if (!ctx.isProjectTrusted()) return undefined; // fail-closed on an untrusted project
    try {
      const cur = await berilExec<{ project?: string }>(pi, ["lifecycle", "current"]);
      if (!cur.project) return undefined;
      const snapshot = await buildProvenanceSnapshot(ctx.cwd, cur.project, ctx);
      await writeProvenanceSnapshot(ctx.cwd, cur.project, snapshot);
    } catch {
      // best-effort: snapshotting the active project must never block a turn
    }
    return undefined;
  });

  pi.registerTool({
    name: "project_provenance",
    label: "Show project provenance",
    description: "Show a project's provenance.json runtime snapshot (read-only).",
    parameters: Type.Object({
      project: Type.String({ description: "Project id (directory under projects/)." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx: ExtensionContext) {
      const path = join(ctx.cwd, "projects", params.project, "provenance.json");
      let snapshot: ProvenanceSnapshot | undefined;
      try {
        snapshot = JSON.parse(await readFile(path, "utf8")) as ProvenanceSnapshot;
      } catch {
        snapshot = undefined;
      }
      if (!snapshot) {
        return {
          content: [{ type: "text", text: `No provenance recorded yet for ${params.project}.` }],
          details: { project: params.project },
        };
      }
      return {
        content: [{ type: "text", text: `Provenance for ${params.project}.` }],
        details: snapshot,
      };
    },
    renderCall(args, theme) {
      return callLine(theme, `provenance · ${args.project}`);
    },
    renderResult(result, { isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      if (isPartial) return partialLine(theme, "Reading provenance…");
      const d = result.details as { project: string; updated_at?: string; runtime?: Record<string, unknown> };
      const lines = [
        `updated ${d.updated_at ?? "unknown"}`,
        ...Object.entries(d.runtime ?? {}).map(([key, value]) => `${key}: ${value ?? "unknown"}`),
        "",
        "Verify: include provenance.json with study artifacts when comparing runs.",
      ];
      return linesCard(theme, {
        title: `Provenance · ${d.project}`,
        accentStyle: domainStyle(theme, "governance"),
        lines,
        maxBodyLines: 24,
      });
    },
  });

  pi.registerTool({
    name: "project_trace",
    label: "Show project trace",
    description: "Read recent rows from a project's TRACE.jsonl audit trail.",
    parameters: Type.Object({
      project: Type.String({ description: "Project id (directory under projects/)." }),
      limit: Type.Optional(Type.Integer({ description: "Maximum recent rows to return.", default: 20 })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx: ExtensionContext) {
      const rows = await readProjectTrace(ctx.cwd, params.project, params.limit ?? 20);
      return {
        content: [{ type: "text", text: `${rows.length} trace row(s) for ${params.project}.` }],
        details: { project: params.project, rows },
      };
    },
    renderCall(args, theme) {
      return callLine(theme, `trace · ${args.project}`);
    },
    renderResult(result, { isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      if (isPartial) return partialLine(theme, "Reading trace…");
      const d = result.details as { project: string; rows: { at?: string; event?: string; tool?: string }[] };
      const lines = d.rows.length
        ? d.rows.map((r) => `${r.at ?? "unknown"}  ${r.event ?? "event"}${r.tool ? `  ${r.tool}` : ""}`)
        : ["(no trace rows yet)"];
      return linesCard(theme, {
        title: `Trace · ${d.project}`,
        accentStyle: domainStyle(theme, "governance"),
        lines,
        maxBodyLines: 24,
      });
    },
  });

  pi.registerCommand("provenance", {
    description: "Show provenance.json for a project (read-only).",
    getArgumentCompletions: projectCompletions,
    async handler(args: string, ctx: ExtensionCommandContext) {
      const project = args.trim();
      if (!project) {
        if (ctx.hasUI) ctx.ui.notify("Usage: /provenance <project>", "warning");
        return;
      }
      pi.sendUserMessage(`Call project_provenance for project "${project}" and summarize the runtime context.`);
    },
  });

  pi.registerCommand("trace", {
    description: "Show recent TRACE.jsonl rows for a project.",
    getArgumentCompletions: projectCompletions,
    async handler(args: string, ctx: ExtensionCommandContext) {
      const project = args.trim();
      if (!project) {
        if (ctx.hasUI) ctx.ui.notify("Usage: /trace <project>", "warning");
        return;
      }
      pi.sendUserMessage(`Call project_trace for project "${project}" and summarize recent audit events.`);
    },
  });
}
