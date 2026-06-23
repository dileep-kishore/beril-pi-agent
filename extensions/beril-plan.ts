import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { projectCompletions } from "../lib/project-completions.ts";
import { linesCard, markdownCard } from "../lib/ui/card.ts";
import { domainStyle } from "../lib/ui/palette.ts";
import { callLine, errorCard, partialLine, toolErrorText } from "../lib/ui/science-cards.ts";

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
    name: "planning_preflight",
    label: "Record planning preflight",
    description:
      "Persist the checked research question, feasibility verdict, candidate tables, and assumptions before drafting RESEARCH_PLAN.md.",
    parameters: Type.Object({
      project: Type.String({ description: "Project id (directory under projects/)." }),
      question: Type.String({ description: "Research question being planned." }),
      feasibility: Type.Optional(Type.String({ description: "answerable, partial, or not-answerable." })),
      tables: Type.Optional(Type.Array(Type.String({ description: "Candidate table used by the plan." }))),
      assumptions: Type.Optional(
        Type.Array(Type.String({ description: "Assumptions that would change the analysis." })),
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx: ExtensionContext) {
      const projectDir = join(ctx.cwd, "projects", params.project);
      await mkdir(projectDir, { recursive: true });
      const payload = {
        project: params.project,
        updated_at: new Date().toISOString(),
        question: params.question,
        feasibility: params.feasibility ?? "unknown",
        tables: params.tables ?? [],
        assumptions: params.assumptions ?? [],
      };
      await writeFile(join(projectDir, "PLANNING_PREFLIGHT.json"), `${JSON.stringify(payload, null, 2)}\n`);
      return {
        content: [{ type: "text", text: `Recorded planning preflight for ${params.project}.` }],
        details: payload,
      };
    },
    renderCall(args, theme) {
      return callLine(theme, `planning preflight · ${args.project}`);
    },
    renderResult(result, { isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      if (isPartial) return partialLine(theme, "Recording preflight…");
      const d = result.details as {
        project: string;
        question: string;
        feasibility: string;
        tables: string[];
        assumptions: string[];
      };
      return linesCard(theme, {
        title: `Planning preflight · ${d.project}`,
        accentStyle: domainStyle(theme, "plan"),
        lines: [
          `question: ${d.question}`,
          `feasibility: ${d.feasibility}`,
          `tables: ${d.tables.length ? d.tables.join(", ") : "none recorded"}`,
          `assumptions: ${d.assumptions.length ? d.assumptions.join("; ") : "none recorded"}`,
          "",
          "Verify: inspect PLANNING_PREFLIGHT.json before drafting RESEARCH_PLAN.md.",
        ],
        maxBodyLines: 18,
      });
    },
  });

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
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      if (isPartial) return partialLine(theme, "Reading plan…");
      const d = result.details as { project: string; markdown: string };
      return markdownCard(theme, {
        title: `Research plan · ${d.project}`,
        accentStyle: domainStyle(theme, "plan"),
        maxBodyLines: expanded ? 400 : 40,
        markdown: `${d.markdown}\n\n---\n\n**Verify:** run \`berdl_feasibility\` checks again if the question/data changed; then use \`request_checkpoint\` before analysis.`,
      });
    },
  });

  pi.registerCommand("research-plan", {
    description: "Draft a project's RESEARCH_PLAN.md from the question, data, and literature, then check in.",
    getArgumentCompletions: projectCompletions,
    async handler(args: string, ctx: ExtensionCommandContext) {
      const project = args.trim();
      if (!project) {
        if (ctx.hasUI) ctx.ui.notify("Usage: /research-plan <project>", "warning");
        return;
      }
      pi.sendUserMessage(
        `Follow the research-plan skill to draft RESEARCH_PLAN.md for project "${project}". Ground it in the research question, the data you actually found (use berdl_discover / berdl_peek), and references.md if present, and use the skill's template. First ask up to 3 grounded clarifying questions (only if they would change the analysis). Then call berdl_feasibility with the candidate tables and key columns. After feasibility and before drafting RESEARCH_PLAN.md, call planning_preflight with the final question, feasibility verdict, tables, and assumptions. A not-answerable verdict means reshape the question first instead of writing a plan. After writing the plan, call the research_plan tool to show it, move "${project}" to "proposed" with lifecycle_transition, and use request_checkpoint to ask the scientist whether to: approve and start the analysis (/analyze ${project}), get an independent plan review first (/berdl-review ${project} --plan), or iterate on the plan.`,
      );
    },
  });
}
