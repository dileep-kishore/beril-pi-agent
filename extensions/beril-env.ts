import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { berilExec } from "../lib/beril-exec.ts";
import { type BerdlEnv, setCachedEnv } from "../lib/readiness.ts";
import { stepBreadcrumb } from "../lib/research-steps.ts";

const STATUS_KEY = "beril-connection";
// Footer key for the lifecycle/submission segment, fed by the shared event bus.
// Sorts after beril-connection and beril-2-project so segments read left-to-right.
const LIFECYCLE_STATUS_KEY = "beril-3-lifecycle";
// Footer key for the research-step breadcrumb (the scientist-facing checklist).
// Sorts last so it reads as the rightmost, widest segment.
const STEP_STATUS_KEY = "beril-4-step";

// Display-only event payloads pushed by beril-governance on the shared bus.
interface LifecycleEvent {
  project: string;
  state: string;
}
interface SubmittedEvent {
  project: string;
}

function statusLine(env: BerdlEnv, ctx: ExtensionContext): string {
  const label = `BERDL ${env.location}${env.ready ? " ✓ ready" : " ✗ not ready"}`;
  if (!ctx.hasUI) return label;
  return ctx.ui.theme.fg(env.ready ? "success" : "warning", label);
}

/** Re-run the readiness check and update the status widget. Returns the env (UI only). */
async function refreshStatus(pi: ExtensionAPI, ctx: ExtensionContext): Promise<BerdlEnv | undefined> {
  if (!ctx.hasUI) return undefined;
  try {
    const env = await berilExec<BerdlEnv>(pi, ["env", "--json"]);
    setCachedEnv(env);
    ctx.ui.setStatus(STATUS_KEY, statusLine(env, ctx));
    return env;
  } catch {
    ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("error", "BERDL status unknown"));
    return undefined;
  }
}

export default function berilEnv(pi: ExtensionAPI) {
  // Latest UI context, captured on session_start. The bus has no replay, so the
  // listener needs a ctx to call setStatus; this mirrors the event-bus example.
  let uiCtx: ExtensionContext | undefined;
  // Most recently seen project, learned from the bus. Undefined on a cold start
  // (a fresh process), so the session_start seed read shells out to no project.
  let activeProject: string | undefined;

  // Listen for lifecycle/submission broadcasts from beril-governance and reflect
  // them in the footer. Registered at load so a listener exists before any emit.
  pi.events.on("beril:lifecycle", (data) => {
    const { project, state } = data as LifecycleEvent;
    activeProject = project;
    if (uiCtx?.hasUI) {
      uiCtx.ui.setStatus(LIFECYCLE_STATUS_KEY, `◆ ${project} → ${state}`);
      uiCtx.ui.setStatus(STEP_STATUS_KEY, uiCtx.ui.theme.fg("muted", `◷ ${stepBreadcrumb(state)}`));
    }
  });
  pi.events.on("beril:submitted", (data) => {
    const { project } = data as SubmittedEvent;
    activeProject = project;
    if (uiCtx?.hasUI) uiCtx.ui.setStatus(LIFECYCLE_STATUS_KEY, `↑ ${project} submitted`);
  });

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
      const env = await refreshStatus(pi, ctx);
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
      await refreshStatus(pi, ctx);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    uiCtx = ctx;
    await refreshStatus(pi, ctx);
    // One best-effort seed read so the lifecycle segment survives a restart. The
    // bus has no history; only run a subprocess when a project is actually known
    // (none on a cold start), keeping startup free of a mandatory extra exec.
    if (ctx.hasUI && activeProject) {
      try {
        const proj = await berilExec<{ status?: string }>(pi, ["lifecycle", "status", activeProject]);
        if (proj.status) {
          ctx.ui.setStatus(LIFECYCLE_STATUS_KEY, `◆ ${activeProject} → ${proj.status}`);
          ctx.ui.setStatus(STEP_STATUS_KEY, ctx.ui.theme.fg("muted", `◷ ${stepBreadcrumb(proj.status)}`));
        }
      } catch {
        // best-effort: a missing/unreadable project must not break startup
      }
    }
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.hasUI) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      ctx.ui.setStatus(LIFECYCLE_STATUS_KEY, undefined);
      ctx.ui.setStatus(STEP_STATUS_KEY, undefined);
    }
  });
}
