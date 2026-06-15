import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { projectCompletions } from "../lib/project-completions.ts";
import { runReviewSubagent } from "../lib/review-agent.ts";
import { nextReviewPath } from "../lib/review-finalize.ts";
import { REFUTATION_RUBRIC } from "../lib/review-rubric.ts";
import { GLYPH } from "../lib/ui/glyphs.ts";

type ReviewSubagent = typeof runReviewSubagent;

export interface RefuteArgs {
  project: string;
  model?: string;
}

/** Parse `<project> [--model <id>]`. */
export function parseRefuteArgs(raw: string): RefuteArgs | undefined {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  let project: string | undefined;
  let model: string | undefined;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === "--model") model = parts[++i];
    else if (!project) project = parts[i];
  }
  return project ? { project, model } : undefined;
}

/**
 * `/berdl-refute <project> [--model <id>]` — run an isolated, read-only red-team
 * subagent (Opus 4.8, overridable) that actively tries to disconfirm the report's
 * findings, then write a numbered REFUTATION_N.md. Does NOT change lifecycle.
 */
export default function berilRefute(pi: ExtensionAPI) {
  pi.registerCommand("berdl-refute", {
    description: "Actively try to refute a project's headline findings (red-team pass), then write REFUTATION_N.md.",
    getArgumentCompletions: projectCompletions,
    async handler(args: string, ctx: ExtensionCommandContext) {
      const parsed = parseRefuteArgs(args);
      if (!parsed) {
        if (ctx.hasUI) ctx.ui.notify("Usage: /berdl-refute <project> [--model <id>]", "warning");
        return;
      }
      if (!ctx.isIdle()) {
        if (ctx.hasUI) ctx.ui.notify("Agent is busy — wait for the current turn to finish.", "warning");
        return;
      }
      const projectDir = join(ctx.cwd, "projects", parsed.project);
      if (!existsSync(join(projectDir, "REPORT.md"))) {
        if (ctx.hasUI) ctx.ui.notify(`REPORT.md not found — run /synthesize first for "${parsed.project}".`, "error");
        return;
      }
      const task = `Red-team the report for project "${parsed.project}" at ${projectDir} against the rubric. Try to refute its Key Findings. Output the complete refutation markdown.`;
      const subagent = (ctx as { __reviewSubagent?: ReviewSubagent }).__reviewSubagent ?? runReviewSubagent;
      const text = await subagent(ctx, { projectDir, rubric: REFUTATION_RUBRIC, task, modelOverride: parsed.model });
      if (!text.trim()) {
        if (ctx.hasUI) ctx.ui.notify("Refutation pass returned no output — nothing written.", "error");
        return;
      }
      const path = nextReviewPath(projectDir, "REFUTATION");
      await writeFile(path, text, "utf8");
      if (ctx.hasUI) ctx.ui.notify(`${GLYPH.refutes} Red-team pass written: ${path}`, "info");
      pi.sendUserMessage(
        `A refutation pass for "${parsed.project}" is at ${path}. Lift each surviving disconfirming check / contradiction into REPORT.md's Refutes slots and re-tag finding status (follow the synthesize skill).`,
      );
    },
  });
}
