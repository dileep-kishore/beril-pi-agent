import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { berilExec } from "../lib/beril-exec.ts";
import {
  type NotebookInfo,
  type NotebookRun,
  callLine,
  errorCard,
  notebookListCard,
  notebookRunCard,
  partialLine,
  scaffoldCard,
  toolErrorText,
} from "../lib/ui/science-cards.ts";

// Notebook execution can run for many minutes (Spark queries, large scans), so
// give it a generous ceiling rather than the default 120s exec timeout.
const RUN_TIMEOUT_MS = 3_600_000;

/**
 * The analysis phase: turn an approved research plan into executed notebooks.
 * The judgment (how to design good notebooks) lives in the analysis-notebooks
 * skill; these tools/commands own the execution, shelling to `beril notebook`.
 *
 * Notebook execution writes only the project's own notebooks (outputs saved in
 * place), so it is deliberately NOT in the destructive registry — it is core
 * research work, not an irreversible remote mutation.
 */
export default function berilAnalysis(pi: ExtensionAPI) {
  pi.registerTool({
    name: "notebook_scaffold",
    label: "Scaffold analysis notebooks",
    description:
      "Generate numbered analysis notebooks for a project from its RESEARCH_PLAN.md (idempotent — never overwrites existing notebooks). Use after the research plan is approved, before running the analysis.",
    parameters: Type.Object({
      project: Type.String({ description: "Project id (directory under projects/)." }),
      from_plan: Type.Optional(Type.Boolean({ description: "Parse RESEARCH_PLAN.md's analysis plan (default true)." })),
    }),
    async execute(_id, params) {
      const args = ["notebook", "scaffold", params.project];
      if (params.from_plan !== false) args.push("--from-plan");
      const r = await berilExec<{ project: string; created: string[]; skipped: string[] }>(pi, args);
      const text = `Scaffolded ${r.created.length} notebook(s)${r.skipped.length ? `, skipped ${r.skipped.length} existing` : ""}.`;
      return { content: [{ type: "text", text }], details: r };
    },
    renderCall(args, theme) {
      return callLine(theme, `notebook scaffold · ${args.project}`);
    },
    renderResult(result, { isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      if (isPartial) return partialLine(theme, "Scaffolding notebooks…");
      return scaffoldCard(theme, result.details as { created: string[]; skipped: string[] });
    },
  });

  pi.registerTool({
    name: "notebook_list",
    label: "List analysis notebooks",
    description: "List a project's notebooks with cell counts and whether each carries saved outputs.",
    parameters: Type.Object({
      project: Type.String({ description: "Project id." }),
    }),
    async execute(_id, params) {
      const r = await berilExec<{ project: string; notebooks: NotebookInfo[] }>(pi, [
        "notebook",
        "list",
        params.project,
      ]);
      const withOutputs = r.notebooks.filter((n) => n.has_outputs).length;
      const text = `${r.notebooks.length} notebook(s), ${withOutputs} with saved outputs.`;
      return { content: [{ type: "text", text }], details: r };
    },
    renderCall(args, theme) {
      return callLine(theme, `notebook list · ${args.project}`);
    },
    renderResult(result, { isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      if (isPartial) return partialLine(theme, "Listing notebooks…");
      return notebookListCard(theme, (result.details as { notebooks: NotebookInfo[] }).notebooks);
    },
  });

  pi.registerTool({
    name: "notebook_run",
    label: "Run analysis notebooks",
    description:
      "Execute a project's analysis notebooks (or one named notebook), saving outputs in place. Long-running; reads the lakehouse via the project's Spark session. Use after scaffolding, then /synthesize to interpret the results.",
    parameters: Type.Object({
      project: Type.String({ description: "Project id." }),
      notebook: Type.Optional(
        Type.String({ description: "A single notebook path/name under notebooks/ (default: all)." }),
      ),
    }),
    async execute(_id, params, signal, onUpdate) {
      onUpdate?.({ content: [{ type: "text", text: "Executing notebooks (this can take a while)…" }], details: {} });
      const args = ["notebook", "run", params.project];
      if (params.notebook) args.push(params.notebook);
      // Exit 1 = some cells failed but a JSON report is still emitted; exit 2 =
      // usage/env error (no jupyter). Read stdout directly so a partial failure
      // surfaces per-notebook rather than collapsing into a thrown error.
      const res = await pi.exec("beril", args, { timeout: RUN_TIMEOUT_MS, signal });
      if (res.code === 2) throw new Error(`notebook run: ${res.stderr || res.stdout}`);
      let payload: { project: string; executed: NotebookRun[]; ok: boolean };
      try {
        payload = JSON.parse(res.stdout) as { project: string; executed: NotebookRun[]; ok: boolean };
      } catch {
        throw new Error(`notebook run: unexpected output: ${res.stdout.slice(0, 200)}${res.stderr}`);
      }
      const failed = payload.executed.filter((e) => !e.ok).length;
      const text = payload.ok
        ? `Executed ${payload.executed.length} notebook(s); all cells ran.`
        : `Executed ${payload.executed.length} notebook(s); ${failed} failed — see errors.`;
      return { content: [{ type: "text", text }], details: payload };
    },
    renderCall(args, theme) {
      return callLine(theme, `notebook run · ${args.project}${args.notebook ? ` · ${args.notebook}` : ""}`);
    },
    renderResult(result, { isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      if (isPartial) return partialLine(theme, "Executing notebooks…");
      return notebookRunCard(theme, result.details as { executed: NotebookRun[]; ok: boolean });
    },
  });

  pi.registerCommand("analyze", {
    description: "Scaffold + run the analysis notebooks for a project, checking in after the first result.",
    async handler(args: string, ctx: ExtensionCommandContext) {
      const project = args.trim();
      if (!project) {
        if (ctx.hasUI) ctx.ui.notify("Usage: /analyze <project>", "warning");
        return;
      }
      pi.sendUserMessage(
        `Follow the analysis-notebooks skill to run the analysis for project "${project}". ` +
          `Use notebook_scaffold to create the numbered notebooks from RESEARCH_PLAN.md (if not already present), ` +
          `then move "${project}" to "active" with lifecycle_transition. Execute them with notebook_run. ` +
          `After the FIRST notebook's results are in, pause: show the scientist the first result or figure and use request_checkpoint ` +
          `to ask whether it looks right before continuing the rest. When all notebooks are executed with saved outputs, run /synthesize.`,
      );
    },
  });
}
