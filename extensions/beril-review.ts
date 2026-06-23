import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { berilExec } from "../lib/beril-exec.ts";
import { projectCompletions } from "../lib/project-completions.ts";
import { summarizeRefutationChecks } from "../lib/refutation.ts";
import { mergePanelReviews, runReviewPanel, runReviewSubagent } from "../lib/review-agent.ts";
import { appendReportHashFooter, nextReviewPath, sha256File } from "../lib/review-finalize.ts";
import { PLAN_REVIEW_RUBRIC, PROJECT_REVIEW_RUBRIC, REFUTATION_RUBRIC } from "../lib/review-rubric.ts";
import { GLYPH } from "../lib/ui/glyphs.ts";
import { redTeamCard } from "../lib/ui/science-cards.ts";

/** Project lifecycle states that permit a (post-synthesis) project review. */
const REVIEWABLE_STATES = new Set(["analysis", "reviewed", "complete"]);

/** Injectable seam (mirrors beril-literature's `__completer`): tests override the subagent. */
type ReviewSubagent = typeof runReviewSubagent;

interface ParsedArgs {
  project: string;
  plan: boolean;
  panel: boolean;
  model?: string;
}

export interface RefuteArgs {
  project: string;
  model?: string;
}

/** Parse `<project> [--plan] [--panel] [--model <id>]`. */
function parseArgs(raw: string): ParsedArgs | undefined {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  let project: string | undefined;
  let plan = false;
  let panel = false;
  let model: string | undefined;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === "--plan") plan = true;
    else if (p === "--panel") panel = true;
    else if (p === "--model") model = parts[++i];
    else if (!project) project = p;
  }
  return project ? { project, plan, panel, model } : undefined;
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
 * `/berdl-review <project> [--plan] [--model <id>]` — run an isolated, read-only
 * in-process review subagent (Opus 4.8, overridable) against the project, then
 * write the numbered review file. Project reviews append the reproducibility
 * `report_hash` footer (raw sha256 of REPORT.md, with a TOCTOU re-check) and
 * advance the lifecycle to `reviewed`; plan reviews write the text verbatim.
 */
export default function berilReview(pi: ExtensionAPI) {
  pi.registerMessageRenderer?.<{ project: string; surviving: string[]; path: string }>(
    "beril-refutation",
    (message, _opts, theme) =>
      redTeamCard(theme, {
        project: message.details?.project ?? "project",
        surviving: message.details?.surviving ?? [],
        path: message.details?.path ?? "REFUTATION.md",
      }),
  );

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
        if (ctx.hasUI)
          ctx.ui.notify(
            `REPORT.md not found — run /paper-plan ${parsed.project} then /synthesize ${parsed.project}.`,
            "error",
          );
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
      const surviving = summarizeRefutationChecks(text);
      pi.sendMessage(
        {
          customType: "beril-refutation",
          content: `Red-team pass for ${parsed.project}: ${surviving.length} surviving check(s).`,
          display: true,
          details: { project: parsed.project, surviving, path },
        },
        { triggerTurn: false, deliverAs: "nextTurn" },
      );
      if (ctx.hasUI) ctx.ui.notify(`${GLYPH.refutes} Red-team pass written: ${path}`, "info");
      pi.sendUserMessage(
        `A refutation pass for "${parsed.project}" is at ${path}. Lift each surviving disconfirming check / contradiction into REPORT.md's Refutes slots and re-tag finding status (follow the synthesize skill).`,
      );
    },
  });

  pi.registerCommand("berdl-review", {
    description: "Run an independent in-process review of a project (or its plan), then mark it reviewed.",
    getArgumentCompletions: projectCompletions,
    async handler(args: string, ctx: ExtensionCommandContext) {
      const parsed = parseArgs(args);
      if (!parsed) {
        if (ctx.hasUI) ctx.ui.notify("Usage: /berdl-review <project> [--plan] [--model <id>]", "warning");
        return;
      }
      const { project, plan, panel, model } = parsed;
      if (plan && panel) {
        if (ctx.hasUI)
          ctx.ui.notify("Use --panel for a project panel or --plan for a plan review, not both.", "warning");
        return;
      }
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
          if (ctx.hasUI)
            ctx.ui.notify(`REPORT.md not found — run /paper-plan ${project} then /synthesize ${project}.`, "error");
          return;
        }
        const proj = await berilExec<{ status?: string }>(pi, ["lifecycle", "status", project]);
        const status = proj.status ?? "";
        if (!REVIEWABLE_STATES.has(status)) {
          if (ctx.hasUI) {
            ctx.ui.notify(`Project "${project}" is "${status}" — run /paper-plan then /synthesize first.`, "error");
          }
          return;
        }
        // `set reviewed` is only legal from `analysis`; re-reviewing an already
        // reviewed/complete project just adds a new REVIEW_N.md without a transition.
        advanceToReviewed = status === "analysis";
        reportHashPre = sha256File(reportPath);
      }

      // --panel: dispatch the multi-specialist panel concurrently (each an isolated
      // read-only subagent) and merge their sections into one REVIEW_N.md. Project
      // reviews only (panel implies !plan); same footer + lifecycle + TOCTOU as single.
      if (panel) {
        const panelFn = (ctx as { __reviewPanel?: typeof runReviewPanel }).__reviewPanel ?? runReviewPanel;
        const results = await panelFn(ctx, { projectDir, project, modelOverride: model });
        if (results.every((r) => !r.text?.trim())) {
          if (ctx.hasUI) ctx.ui.notify("All panel reviewers failed — nothing written.", "error");
          return;
        }
        // TOCTOU: discard if REPORT.md changed under the panel's feet.
        if (sha256File(reportPath) !== reportHashPre) {
          if (ctx.hasUI) ctx.ui.notify("REPORT.md changed during review — discarding (re-run /berdl-review).", "error");
          return;
        }
        const merged = mergePanelReviews(project, results, new Date().toISOString().slice(0, 10));
        const path = nextReviewPath(projectDir, "REVIEW");
        await writeFile(path, appendReportHashFooter(merged, reportHashPre as string), "utf8");
        if (advanceToReviewed) {
          const result = await berilExec<{ status: string }>(pi, ["lifecycle", "set", project, "reviewed"]);
          pi.events.emit("beril:lifecycle", { project, state: result.status });
        }
        if (ctx.hasUI) {
          const suffix = advanceToReviewed ? "; project marked reviewed." : "";
          ctx.ui.notify(`Panel review written: ${path}${suffix}`, "info");
        }
        pi.sendUserMessage(
          `An independent multi-specialist panel review of "${project}" is at ${path}. Follow the berdl-review skill to read it and guide any fixes.`,
        );
        return;
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
