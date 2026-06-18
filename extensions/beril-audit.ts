import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
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

export default function berilAudit(pi: ExtensionAPI) {
  pi.on("tool_execution_start", async (event, ctx) => {
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

  pi.on("input", async (event, _ctx) => {
    if (event.text.trim().startsWith("/aside")) return;
  });

  pi.registerTool({
    name: "project_provenance",
    label: "Show project provenance",
    description: "Write and display a project's provenance.json runtime snapshot.",
    parameters: Type.Object({
      project: Type.String({ description: "Project id (directory under projects/)." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx: ExtensionContext) {
      const snapshot = await buildProvenanceSnapshot(ctx.cwd, params.project, ctx);
      const saved = await writeProvenanceSnapshot(ctx.cwd, params.project, snapshot);
      return {
        content: [{ type: "text", text: `Updated provenance for ${params.project}.` }],
        details: saved,
      };
    },
    renderCall(args, theme) {
      return callLine(theme, `provenance · ${args.project}`);
    },
    renderResult(result, { isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      if (isPartial) return partialLine(theme, "Reading provenance...");
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
      if (isPartial) return partialLine(theme, "Reading trace...");
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
    description: "Show/update provenance.json for a project.",
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
