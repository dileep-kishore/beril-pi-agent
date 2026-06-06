import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { berilExec } from "../lib/beril-exec.ts";
import { runReviewSubagent } from "../lib/review-agent.ts";
import { appendReportHashFooter, nextReviewPath, sha256File } from "../lib/review-finalize.ts";
import { PLAN_REVIEW_RUBRIC, PROJECT_REVIEW_RUBRIC } from "../lib/review-rubric.ts";

/** Project lifecycle states that permit a (post-synthesis) project review. */
const REVIEWABLE_STATES = new Set(["analysis", "reviewed", "complete"]);

/** Injectable seam (mirrors beril-literature's `__completer`): tests override the subagent. */
type ReviewSubagent = typeof runReviewSubagent;

interface ParsedArgs {
  project: string;
  plan: boolean;
  model?: string;
}

/** Parse `<project> [--plan] [--model <id>]`. */
function parseArgs(raw: string): ParsedArgs | undefined {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  let project: string | undefined;
  let plan = false;
  let model: string | undefined;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === "--plan") plan = true;
    else if (p === "--model") model = parts[++i];
    else if (!project) project = p;
  }
  return project ? { project, plan, model } : undefined;
}

/**
 * `/berdl-review <project> [--plan] [--model <id>]` — run an isolated, read-only
 * in-process review subagent (Opus 4.8, overridable) against the project, then
 * write the numbered review file. Project reviews append the reproducibility
 * `report_hash` footer (raw sha256 of REPORT.md, with a TOCTOU re-check) and
 * advance the lifecycle to `reviewed`; plan reviews write the text verbatim.
 */
export default function berilReview(pi: ExtensionAPI) {
  pi.registerCommand("berdl-review", {
    description: "Run an independent in-process review of a project (or its plan), then mark it reviewed.",
    async handler(args: string, ctx: ExtensionCommandContext) {
      const parsed = parseArgs(args);
      if (!parsed) {
        if (ctx.hasUI) ctx.ui.notify("Usage: /berdl-review <project> [--plan] [--model <id>]", "warning");
        return;
      }
      const { project, plan, model } = parsed;
      if (!ctx.isIdle()) {
        if (ctx.hasUI) ctx.ui.notify("Agent is busy — wait for the current turn to finish.", "warning");
        return;
      }

      const projectDir = join(ctx.cwd, "projects", project);
      if (!existsSync(projectDir)) {
        if (ctx.hasUI) ctx.ui.notify(`Project "${project}" not found under projects/.`, "error");
        return;
      }

      const reportPath = join(projectDir, "REPORT.md");
      let reportHashPre: string | undefined;
      let advanceToReviewed = false;
      if (!plan) {
        if (!existsSync(reportPath)) {
          if (ctx.hasUI) ctx.ui.notify(`REPORT.md not found — run /synthesize first for "${project}".`, "error");
          return;
        }
        const proj = await berilExec<{ status?: string }>(pi, ["lifecycle", "status", project]);
        const status = proj.status ?? "";
        if (!REVIEWABLE_STATES.has(status)) {
          if (ctx.hasUI) {
            ctx.ui.notify(`Project "${project}" is "${status}" — run /synthesize first.`, "error");
          }
          return;
        }
        // `set reviewed` is only legal from `analysis`; re-reviewing an already
        // reviewed/complete project just adds a new REVIEW_N.md without a transition.
        advanceToReviewed = status === "analysis";
        reportHashPre = sha256File(reportPath);
      }

      const rubric = plan ? PLAN_REVIEW_RUBRIC : PROJECT_REVIEW_RUBRIC;
      const task = plan
        ? `Review the research plan for project "${project}" at ${projectDir} against the rubric. Output the complete plan-review markdown.`
        : `Review project "${project}" at ${projectDir} against the rubric. Output the complete review markdown.`;

      const subagent = (ctx as { __reviewSubagent?: ReviewSubagent }).__reviewSubagent ?? runReviewSubagent;
      const text = await subagent(ctx, { projectDir, rubric, task, modelOverride: model });
      if (!text.trim()) {
        if (ctx.hasUI) ctx.ui.notify("Reviewer returned no output — nothing written.", "error");
        return;
      }

      if (!plan) {
        // TOCTOU: discard if REPORT.md changed under the reviewer's feet.
        const reportHashPost = sha256File(reportPath);
        if (reportHashPost !== reportHashPre) {
          if (ctx.hasUI) ctx.ui.notify("REPORT.md changed during review — discarding (re-run /berdl-review).", "error");
          return;
        }
      }

      const path = nextReviewPath(projectDir, plan ? "PLAN_REVIEW" : "REVIEW");
      const body = plan ? text : appendReportHashFooter(text, reportHashPre as string);
      await writeFile(path, body, "utf8");

      if (advanceToReviewed) {
        const result = await berilExec<{ status: string }>(pi, ["lifecycle", "set", project, "reviewed"]);
        pi.events.emit("beril:lifecycle", { project, state: result.status });
      }

      if (ctx.hasUI) {
        const suffix = advanceToReviewed ? "; project marked reviewed." : "";
        ctx.ui.notify(`Review written: ${path}${suffix}`, "info");
      }
      pi.sendUserMessage(
        `An independent ${plan ? "plan " : ""}review of "${project}" is at ${path}. Follow the berdl-review skill to read it and guide any fixes.`,
      );
    },
  });
}
