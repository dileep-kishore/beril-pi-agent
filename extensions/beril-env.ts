import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { berilExec } from "../lib/beril-exec.ts";
import type { BerdlEnv } from "../lib/readiness.ts";

const STATUS_KEY = "beril-connection";

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
    ctx.ui.setStatus(STATUS_KEY, statusLine(env, ctx));
    return env;
  } catch {
    ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("error", "BERDL status unknown"));
    return undefined;
  }
}

export default function berilEnv(pi: ExtensionAPI) {
  pi.registerTool({
    name: "berdl_env_check",
    label: "Check BERDL environment",
    description:
      "Report whether the BERDL connection (on/off-cluster, SSH tunnels, pproxy, token) is ready, with next steps.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, _ctx) {
      const env = await berilExec<BerdlEnv>(pi, ["env", "--json"]);
      const text =
        `BERDL ${env.location}: ${env.ready ? "ready" : "NOT ready"}` +
        (env.next_steps?.length ? `\nNext steps:\n- ${env.next_steps.join("\n- ")}` : "");
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
    await refreshStatus(pi, ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
  });
}
