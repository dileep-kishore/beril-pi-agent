import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { berilExec } from "../lib/beril-exec.ts";
import { type BerdlEnv, setCachedEnv } from "../lib/readiness.ts";
import { type HudState, workflowHud } from "../lib/ui/workflow-hud.ts";

// Compact connection indicator in the footer (always-on, bottom of screen).
const STATUS_KEY = "beril-connection";
// The multi-line workflow HUD shown above the editor: project · connection,
// the explore→plan→analyze→review→submit rail with the current step marked,
// and the single most useful next action. Fed by the shared event bus.
const WIDGET_KEY = "beril-workflow";

// Display-only event payloads pushed by beril-governance on the shared bus.
interface LifecycleEvent {
  project: string;
  state: string;
}
interface SubmittedEvent {
  project: string;
}

function connectionLabel(env: BerdlEnv): string {
  return `BERDL ${env.location}${env.ready ? " ✓ ready" : " ✗ not ready"}`;
}

export default function berilEnv(pi: ExtensionAPI) {
  // Latest UI context, captured on session_start (the bus has no replay, so the
  // listener needs a ctx to update the widget). Mirrors the event-bus example.
  let uiCtx: ExtensionContext | undefined;
  // Mutable HUD state, updated by connection refreshes and lifecycle/submit events.
  const hud: HudState = {};

  function renderHud(): void {
    if (!uiCtx?.hasUI) return;
    const lines = workflowHud(uiCtx.ui.theme, hud);
    uiCtx.ui.setWidget(WIDGET_KEY, lines.length ? lines : undefined, { placement: "aboveEditor" });
  }

  // Listen for lifecycle/submission broadcasts from beril-governance and reflect
  // them in the HUD. Registered at load so a listener exists before any emit.
  pi.events.on("beril:lifecycle", (data) => {
    const { project, state } = data as LifecycleEvent;
    hud.project = project;
    hud.state = state;
    hud.submitted = false;
    renderHud();
  });
  pi.events.on("beril:submitted", (data) => {
    const { project } = data as SubmittedEvent;
    hud.project = project;
    hud.submitted = true;
    renderHud();
  });

  /** Re-run the readiness check, update the connection footer + HUD. Returns the env (UI only). */
  async function refreshStatus(ctx: ExtensionContext): Promise<BerdlEnv | undefined> {
    if (!ctx.hasUI) return undefined;
    try {
      const env = await berilExec<BerdlEnv>(pi, ["env", "--json"]);
      setCachedEnv(env);
      hud.connection = connectionLabel(env);
      hud.ready = env.ready;
      ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg(env.ready ? "success" : "warning", connectionLabel(env)));
      renderHud();
      return env;
    } catch {
      hud.connection = "BERDL status unknown";
      hud.ready = false;
      ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("error", "BERDL status unknown"));
      renderHud();
      return undefined;
    }
  }

  pi.registerTool({
    name: "berdl_env_check",
    label: "Check BERDL environment",
    description:
      "Report whether the BERDL connection (on/off-cluster, SSH tunnels, pproxy, token) is ready, with next steps.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, _ctx) {
      const env = await berilExec<BerdlEnv>(pi, ["env", "--json"]);
      const steps = env.next_steps?.length ? `\nNext steps:\n- ${env.next_steps.join("\n- ")}` : "";
      const text = `BERDL ${env.location}: ${env.ready ? "ready" : "NOT ready"}${steps}`;
      return { content: [{ type: "text", text }], details: env };
    },
  });

  pi.registerCommand("berdl-connect", {
    description: "Check the BERDL connection and (re)start pproxy if the SSH tunnels are up.",
    async handler(_args: string, ctx: ExtensionContext) {
      const env = await refreshStatus(ctx);
      if (ctx.hasUI) {
        ctx.ui.notify(
          env?.ready ? "BERDL ready." : "BERDL not ready — see next steps.",
          env?.ready ? "info" : "warning",
        );
      }
    },
  });

  pi.registerCommand("berdl-status", {
    description: "Refresh the BERDL connection status indicator.",
    async handler(_args: string, ctx: ExtensionContext) {
      await refreshStatus(ctx);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    uiCtx = ctx;
    await refreshStatus(ctx);
    // One best-effort seed read so the step rail survives a restart. The bus has
    // no history; only shell out when a project is actually known (none on a
    // cold start), keeping startup free of a mandatory extra exec.
    if (ctx.hasUI && hud.project) {
      try {
        const proj = await berilExec<{ status?: string }>(pi, ["lifecycle", "status", hud.project]);
        if (proj.status) {
          hud.state = proj.status;
          renderHud();
        }
      } catch {
        // best-effort: a missing/unreadable project must not break startup
      }
    }
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.hasUI) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      ctx.ui.setWidget(WIDGET_KEY, undefined);
    }
  });
}
