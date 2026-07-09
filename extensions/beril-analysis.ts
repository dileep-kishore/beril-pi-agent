import { basename, join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { berilExec } from "../lib/beril-exec.ts";
import { newFigures, openCommand } from "../lib/figures.ts";
import { projectCompletions } from "../lib/project-completions.ts";
import { inlineImages } from "../lib/ui/figure-image.ts";
import { figuresCard } from "../lib/ui/koros-cards.ts";
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

export type AnalyzeMode = "full" | "first-result" | "continue";

export interface AnalyzeArgs {
  project: string;
  mode: AnalyzeMode;
}

export function parseAnalyzeArgs(raw: string): AnalyzeArgs | undefined {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  let project: string | undefined;
  let mode: AnalyzeMode = "full";
  for (const p of parts) {
    if (p === "--first-result") mode = "first-result";
    else if (p === "--continue") mode = "continue";
    else if (!project) project = p;
  }
  return project ? { project, mode } : undefined;
}

function analyzePrompt(project: string, mode: AnalyzeMode): string {
  if (mode === "first-result") {
    return `Follow the analysis-notebooks skill for project "${project}", but only run the first discriminating notebook in this turn. Use notebook_scaffold if needed, call notebook_list to identify the first numbered notebook, move "${project}" to "active" with lifecycle_transition, then call notebook_run with the single notebook parameter for that first discriminating notebook. Show the first result or figure, then call request_checkpoint before any additional execution.`;
  }
  if (mode === "continue") {
    return `Continue after the first-result checkpoint for project "${project}". Use notebook_list to inspect remaining notebooks and saved outputs, then call notebook_run with resume: true so prior successful BERIL executions are skipped and failed/unstamped notebooks rerun. Stop if a notebook failure changes the scientific interpretation. When all required notebooks have saved outputs, run /paper-plan ${project} before /synthesize ${project}.`;
  }
  return `Follow the analysis-notebooks skill for project "${project}". Start with the first-result workflow: use notebook_scaffold if needed, notebook_list to choose the first numbered notebook, lifecycle_transition to move "${project}" to "active", run exactly that first discriminating notebook with notebook_run, show the result, and call request_checkpoint. Only after the scientist approves should you continue with /analyze ${project} --continue.`;
}

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
      "Execute a project's analysis notebooks (or one named notebook), saving outputs in place. Long-running; reads the lakehouse via the project's Spark session. Use after scaffolding, then /paper-plan and /synthesize to interpret the results.",
    parameters: Type.Object({
      project: Type.String({ description: "Project id." }),
      notebook: Type.Optional(
        Type.String({ description: "A single notebook path/name under notebooks/ (default: all)." }),
      ),
      resume: Type.Optional(
        Type.Boolean({
          description:
            "Skip notebooks with prior successful BERIL execution metadata; rerun failed/unstamped notebooks.",
          default: false,
        }),
      ),
    }),
    async execute(_id, params, signal, onUpdate, ctx?: ExtensionContext) {
      onUpdate?.({ content: [{ type: "text", text: "Executing notebooks (this can take a while)…" }], details: {} });
      const startedAt = Date.now();
      const args = ["notebook", "run", params.project];
      if (params.notebook) args.push(params.notebook);
      if (params.resume) args.push("--resume");
      // Exit 1 = some cells failed but a JSON report is still emitted; exit 2 =
      // usage/env error (no jupyter). Read stdout directly so a partial failure
      // surfaces per-notebook rather than collapsing into a thrown error.
      const res = await pi.exec("beril", args, { timeout: RUN_TIMEOUT_MS, signal });
      if (res.code === 2) throw new Error(`notebook run: ${res.stderr || res.stdout}`);
      let payload: {
        project: string;
        executed: NotebookRun[];
        skipped?: { notebook: string; reason: string }[];
        ok: boolean;
      };
      try {
        payload = JSON.parse(res.stdout) as {
          project: string;
          executed: NotebookRun[];
          skipped?: { notebook: string; reason: string }[];
          ok: boolean;
        };
      } catch {
        throw new Error(`notebook run: unexpected output: ${res.stdout.slice(0, 200)}${res.stderr}`);
      }
      // The workshop's #1 ask: after a run, surface the plots — figures written
      // during THIS execution render inline (Kitty/iTerm2) with link fallback.
      const figures = ctx?.cwd ? newFigures(join(ctx.cwd, "projects", params.project), startedAt) : [];
      const failed = payload.executed.filter((e) => !e.ok).length;
      const skipped = payload.skipped?.length ?? 0;
      const figNote = figures.length ? ` New figure(s): ${figures.map((f) => basename(f)).join(", ")}.` : "";
      const text = payload.ok
        ? `Executed ${payload.executed.length} notebook(s); skipped ${skipped}; all cells ran.${figNote}`
        : `Executed ${payload.executed.length} notebook(s); skipped ${skipped}; ${failed} failed — see errors.${figNote}`;
      return { content: [{ type: "text", text }], details: { ...payload, figures } };
    },
    renderCall(args, theme) {
      return callLine(theme, `notebook run · ${args.project}${args.notebook ? ` · ${args.notebook}` : ""}`);
    },
    renderResult(result, { isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      if (isPartial) return partialLine(theme, "Executing notebooks…");
      const d = result.details as { executed: NotebookRun[]; ok: boolean; figures?: string[] };
      const run = notebookRunCard(theme, d);
      if (!d.figures?.length) return run;
      const stack = new Container();
      stack.addChild(run);
      stack.addChild(figuresCard(theme, d.figures));
      for (const img of inlineImages(theme, d.figures)) stack.addChild(img);
      return stack;
    },
  });

  pi.registerCommand("figures", {
    description: "Open a project's newest figure in the OS image viewer (read-only).",
    getArgumentCompletions: projectCompletions,
    async handler(args: string, ctx: ExtensionCommandContext) {
      let project = args.trim();
      if (!project) {
        const current = await berilExec<{ project?: string }>(pi, ["lifecycle", "current"]).catch(() => undefined);
        project = current?.project ?? "";
      }
      if (!project) {
        if (ctx.hasUI) ctx.ui.notify("Usage: /figures <project> (no active project found)", "warning");
        return;
      }
      // All figures, newest last (mtime 0 baseline = every figure qualifies).
      const figures = newFigures(join(ctx.cwd, "projects", project), 0);
      if (!figures.length) {
        if (ctx.hasUI) ctx.ui.notify(`No figures under projects/${project}/figures yet.`, "info");
        return;
      }
      const { statSync } = await import("node:fs");
      const newest = figures.reduce((a, b) => (statSync(a).mtimeMs >= statSync(b).mtimeMs ? a : b));
      const [cmd, ...cmdArgs] = openCommand(newest);
      await pi.exec(cmd, cmdArgs, { timeout: 15_000 });
      if (ctx.hasUI) ctx.ui.notify(`Opened ${basename(newest)}.`, "info");
    },
  });

  pi.registerCommand("analyze", {
    description: "Scaffold + run the analysis notebooks for a project, checking in after the first result.",
    getArgumentCompletions: projectCompletions,
    async handler(args: string, ctx: ExtensionCommandContext) {
      const parsed = parseAnalyzeArgs(args);
      if (!parsed) {
        if (ctx.hasUI) ctx.ui.notify("Usage: /analyze <project>", "warning");
        return;
      }
      pi.sendUserMessage(analyzePrompt(parsed.project, parsed.mode));
    },
  });
}
