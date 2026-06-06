import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { markdownCard } from "../lib/ui/card.ts";
import { callLine, partialLine } from "../lib/ui/science-cards.ts";

/**
 * Research-plan generation: the bridge from data exploration to analysis.
 *
 * The judgment (what a strong, feasible plan contains, the template) lives in
 * the research-plan skill; the `/research-plan` command guides the drafting and
 * the check-in, and the `research_plan` tool shows the result as a formatted
 * card so the plan is spotlighted, not buried in a file-write diff.
 */
export default function berilPlan(pi: ExtensionAPI) {
  pi.registerTool({
    name: "research_plan",
    label: "Show research plan",
    description:
      "Read and display a project's RESEARCH_PLAN.md as a formatted card. Use to present a drafted or revised plan to the scientist.",
    parameters: Type.Object({
      project: Type.String({ description: "Project id (directory under projects/)." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx: ExtensionContext) {
      const path = join(ctx.cwd, "projects", params.project, "RESEARCH_PLAN.md");
      let markdown: string;
      try {
        markdown = await readFile(path, "utf8");
      } catch {
        throw new Error(
          `No RESEARCH_PLAN.md for "${params.project}" yet — draft it first with /research-plan ${params.project}.`,
        );
      }
      return { content: [{ type: "text", text: markdown }], details: { project: params.project, markdown } };
    },
    renderCall(args, theme) {
      return callLine(theme, `research plan · ${args.project}`);
    },
    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) return partialLine(theme, "Reading plan…");
      const d = result.details as { project: string; markdown: string };
      return markdownCard(theme, {
        title: `Research plan · ${d.project}`,
        markdown: d.markdown,
        maxBodyLines: expanded ? 400 : 40,
      });
    },
  });

  pi.registerCommand("research-plan", {
    description: "Draft a project's RESEARCH_PLAN.md from the question, data, and literature, then check in.",
    async handler(args: string, ctx: ExtensionCommandContext) {
      const project = args.trim();
      if (!project) {
        if (ctx.hasUI) ctx.ui.notify("Usage: /research-plan <project>", "warning");
        return;
      }
      pi.sendUserMessage(
        `Follow the research-plan skill to draft RESEARCH_PLAN.md for project "${project}". ` +
          `Ground it in the research question, the data you actually found (use berdl_discover / berdl_peek), and references.md if present, ` +
          `and use the skill's template. First confirm the question is answerable with the available data — if it is not, say so plainly instead of writing a plan. ` +
          `After writing the plan, call the research_plan tool to show it, move "${project}" to "proposed" with lifecycle_transition, ` +
          `and ask the scientist whether to: approve and start the analysis (/analyze ${project}), get an independent plan review first (/berdl-review ${project} --plan), or iterate on the plan.`,
      );
    },
  });
}
