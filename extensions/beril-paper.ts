import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { projectCompletions } from "../lib/project-completions.ts";
import { markdownCard } from "../lib/ui/card.ts";
import { domainStyle } from "../lib/ui/palette.ts";
import { callLine, errorCard, partialLine, toolErrorText } from "../lib/ui/science-cards.ts";

export default function berilPaper(pi: ExtensionAPI) {
  pi.registerTool({
    name: "paper_plan",
    label: "Show paper plan",
    description:
      "Read and display a project's PAPER_PLAN.md narrative plan. Use after analysis and before /synthesize.",
    parameters: Type.Object({
      project: Type.String({ description: "Project id (directory under projects/)." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx: ExtensionContext) {
      const path = join(ctx.cwd, "projects", params.project, "PAPER_PLAN.md");
      let markdown: string;
      try {
        markdown = await readFile(path, "utf8");
      } catch {
        throw new Error(
          `No PAPER_PLAN.md for "${params.project}" yet — draft it first with /paper-plan ${params.project}.`,
        );
      }
      return { content: [{ type: "text", text: markdown }], details: { project: params.project, markdown } };
    },
    renderCall(args, theme) {
      return callLine(theme, `paper plan · ${args.project}`);
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      if (isPartial) return partialLine(theme, "Reading paper plan...");
      const d = result.details as { project: string; markdown: string };
      return markdownCard(theme, {
        title: `Paper plan · ${d.project}`,
        accentStyle: domainStyle(theme, "plan"),
        maxBodyLines: expanded ? 400 : 40,
        markdown: `${d.markdown}\n\n---\n\n**Verify:** confirm the narrative uses only executed analyses and artifact-backed evidence before /synthesize.`,
      });
    },
  });

  pi.registerCommand("paper-plan", {
    description: "Draft PAPER_PLAN.md from executed results before synthesis.",
    getArgumentCompletions: projectCompletions,
    async handler(args: string, ctx: ExtensionCommandContext) {
      const project = args.trim();
      if (!project) {
        if (ctx.hasUI) ctx.ui.notify("Usage: /paper-plan <project>", "warning");
        return;
      }
      pi.sendUserMessage(
        `Follow the paper-plan skill for project "${project}". Read RESEARCH_PLAN.md, notebook outputs, figures, claims.json if present, and REPORT.md if it already exists. Draft or revise PAPER_PLAN.md as the publication narrative plan, then call paper_plan to show it and request_checkpoint to ask whether to approve the narrative and continue with /synthesize ${project}, revise the paper plan, or run more analysis first.`,
      );
    },
  });
}
