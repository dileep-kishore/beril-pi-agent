import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { findLabelledEntry, lastLabelableEntry, scienceLabel } from "../lib/session-reroll.ts";

interface LifecycleEvent {
  project: string;
  state: string;
}

interface CheckpointEvent {
  title: string;
  choice: string;
}

function labelCurrent(pi: ExtensionAPI, ctx: ExtensionContext | undefined, label: string): boolean {
  const entry = ctx?.sessionManager.getLeafEntry?.() ?? lastLabelableEntry(ctx?.sessionManager.getEntries?.() ?? []);
  if (!entry?.id) return false;
  pi.setLabel(entry.id, label);
  return true;
}

export default function berilReroll(pi: ExtensionAPI) {
  let latestCtx: ExtensionContext | undefined;
  let latestProject: string | undefined;

  pi.on("session_start", (_event, ctx) => {
    latestCtx = ctx;
  });

  pi.events.on("beril:lifecycle", (data) => {
    const ev = data as LifecycleEvent;
    latestProject = ev.project;
    labelCurrent(pi, latestCtx, scienceLabel("lifecycle", ev.project, ev.state));
  });

  pi.events.on("beril:checkpoint", (data) => {
    const ev = data as CheckpointEvent;
    if (!latestProject) return;
    labelCurrent(pi, latestCtx, scienceLabel("checkpoint", latestProject, ev.title));
  });

  pi.registerCommand("bookmark-science", {
    description: "Label the current session point as a BERIL scientific seam.",
    async handler(args: string, ctx: ExtensionCommandContext) {
      latestCtx = ctx;
      const project = latestProject ?? "project";
      const label = scienceLabel("manual", project, args.trim() || "bookmark");
      if (labelCurrent(pi, ctx, label)) {
        if (ctx.hasUI) ctx.ui.notify(`Bookmarked ${label}`, "info");
      } else if (ctx.hasUI) {
        ctx.ui.notify("No session entry available to bookmark.", "warning");
      }
    },
  });

  pi.registerCommand("reroll-analysis-from", {
    description: "Fork the session from a labelled BERIL checkpoint or lifecycle seam.",
    async handler(args: string, ctx: ExtensionCommandContext) {
      const query = args.trim();
      if (!query) {
        if (ctx.hasUI) ctx.ui.notify("Usage: /reroll-analysis-from <label>", "warning");
        return;
      }
      const entry = findLabelledEntry(ctx.sessionManager.getEntries(), (id) => ctx.sessionManager.getLabel(id), query);
      if (!entry) {
        if (ctx.hasUI) ctx.ui.notify(`No BERIL label matched "${query}". Open /tree to inspect labels.`, "warning");
        return;
      }
      const result = await ctx.fork(entry.id, { position: "at" });
      if (ctx.hasUI && !result.cancelled) ctx.ui.notify(`Forked from ${query}.`, "info");
    },
  });

  pi.registerCommand("back-to-plan", {
    description: "Fork back to the latest proposed/plan seam for the active or named project.",
    async handler(args: string, ctx: ExtensionCommandContext) {
      const project = args.trim() || latestProject || "";
      const query = project ? `${project}:proposed` : "proposed";
      const entry = findLabelledEntry(ctx.sessionManager.getEntries(), (id) => ctx.sessionManager.getLabel(id), query);
      if (!entry) {
        if (ctx.hasUI) ctx.ui.notify("No plan/proposed label found. Use /tree or /bookmark-science first.", "warning");
        return;
      }
      const result = await ctx.fork(entry.id, { position: "at" });
      if (ctx.hasUI && !result.cancelled) ctx.ui.notify("Forked back to the plan seam.", "info");
    },
  });
}
