import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { berilExec } from "../lib/beril-exec.ts";
import { readCachedEnv } from "../lib/readiness.ts";
import { type ReviewPreflightView, collectReviewPreflight } from "../lib/review-preflight.ts";
import type { ResearchStateSnapshot } from "../lib/session-state.ts";
import { reviewPreflightCard } from "../lib/ui/science-cards.ts";
import { workflowStatusCard } from "../lib/ui/workflow-card.ts";
import { type WorkflowView, buildWorkflowView } from "../lib/workflow.ts";

/**
 * Pi-native workflow commands: deterministic orientation without spending a model turn.
 * State comes from the lifecycle CLI + the cached BERDL readiness, not model memory.
 */
export default function berilWorkflow(pi: ExtensionAPI) {
  pi.registerMessageRenderer<{ focus?: "whereami" | "next"; view?: WorkflowView }>(
    "beril-workflow-status",
    (message, _opts, theme) =>
      workflowStatusCard(
        theme,
        message.details?.view ?? buildWorkflowView(undefined),
        message.details?.focus ?? "whereami",
      ),
  );
  pi.registerMessageRenderer<{ view: ReviewPreflightView }>("beril-review-preflight-status", (message, _opts, theme) =>
    reviewPreflightCard(
      theme,
      message.details?.view ?? {
        project: "(unknown)",
        report: false,
        notebookHashes: 0,
        claims: { total: 0, supported: 0, refuted: 0, unsupported: 0, emptyRefutes: 0 },
        redTeam: false,
        review: false,
        reviewReady: false,
        submitReady: false,
        blockers: ["Preflight details were missing"],
        warnings: [],
      },
    ),
  );

  async function collectView(): Promise<WorkflowView> {
    let current: { project?: string; status?: string } | undefined;
    let researchState: Partial<ResearchStateSnapshot> | undefined;
    try {
      current = await berilExec<{ project?: string; status?: string }>(pi, ["lifecycle", "current"]);
    } catch {
      current = undefined;
    }
    if (current?.project) {
      try {
        const stored = await berilExec<Partial<ResearchStateSnapshot>>(pi, [
          "lifecycle",
          "session-state",
          current.project,
          "--get",
        ]);
        if (stored && typeof stored === "object") researchState = stored;
      } catch {
        // Orientation is best-effort; a missing research_state block is normal.
      }
    }
    return buildWorkflowView(current, researchState, readCachedEnv());
  }

  async function show(focus: "whereami" | "next", ctx: ExtensionCommandContext): Promise<void> {
    const view = await collectView();
    const content =
      focus === "next"
        ? `Next: ${view.command}`
        : view.project
          ? `Current project: ${view.project} (${view.status ?? "unknown"})`
          : "No active BERIL project found.";
    pi.sendMessage(
      { customType: "beril-workflow-status", content, display: true, details: { focus, view } },
      { triggerTurn: false, deliverAs: "nextTurn" },
    );
    if (view.project) {
      const preflight = await collectReviewPreflight(pi, ctx.cwd, view.project);
      pi.sendMessage(
        {
          customType: "beril-review-preflight-status",
          content: `${view.project}: ${preflight.submitReady ? "submit ready" : "submit not ready"}`,
          display: true,
          details: { view: preflight },
        },
        { triggerTurn: false, deliverAs: "nextTurn" },
      );
    }
    if (ctx.hasUI) ctx.ui.notify(focus === "next" ? `Next: ${view.command}` : content, "info");
  }

  pi.registerCommand("whereami", {
    description: "Show the active BERIL project, lifecycle phase, cached connection, and next action.",
    async handler(_args: string, ctx: ExtensionCommandContext) {
      await show("whereami", ctx);
    },
  });

  pi.registerCommand("next", {
    description: "Show the deterministic next BERIL workflow command for the active project.",
    async handler(_args: string, ctx: ExtensionCommandContext) {
      await show("next", ctx);
    },
  });
}
