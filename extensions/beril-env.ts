import { basename } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Box, Key, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { berilExec } from "../lib/beril-exec.ts";
import { type BerdlEnv, onEnvChange, setCachedEnv } from "../lib/readiness.ts";
import { currentStep, nextAction } from "../lib/research-steps.ts";
import { type FooterData, footerLines } from "../lib/ui/footer.ts";
import { GLYPH } from "../lib/ui/glyphs.ts";
import { callLine, envCard, errorCard, partialLine, toolErrorText } from "../lib/ui/science-cards.ts";
import { TIPS, type WelcomeState, pickTip, welcomePanel } from "../lib/ui/welcome.ts";
import { type HudState, workflowHud } from "../lib/ui/workflow-hud.ts";

// Full connection chip in the built-in footer — the RPC fallback when the custom
// footer (TUI-only) is a no-op.
const STATUS_KEY = "beril-connection";
// The workflow HUD above the editor: the explore→plan→analyze→review→submit rail
// with the current step marked, plus the single most useful next action.
const WIDGET_KEY = "beril-workflow";

// Display-only event payloads pushed by beril-governance on the shared bus.
interface LifecycleEvent {
  project: string;
  state: string;
}
interface SubmittedEvent {
  project: string;
}

/** Full label for the built-in footer chip, e.g. "BERDL off-cluster ✓ ready". */
function connectionLabel(env: BerdlEnv): string {
  // Reachable-but-not-ready shows the warning mark (△), matching the footer
  // connection chip — not the hard-down (✗) mark, which is reserved for the
  // status-unknown error state in refreshStatus.
  return `BERDL ${env.location}${env.ready ? ` ${GLYPH.ok} ready` : ` ${GLYPH.warn} not ready`}`;
}

/** Compact label for the custom statusline, e.g. "BERDL off-cluster". */
function compactLocation(env: BerdlEnv): string {
  return `BERDL ${env.location}`;
}

export default function berilEnv(pi: ExtensionAPI) {
  // Latest UI context, captured on session_start (the bus has no replay, so the
  // listener needs a ctx to update the widget). Mirrors the event-bus example.
  let uiCtx: ExtensionContext | undefined;
  // Mutable HUD/footer state, updated by connection refreshes + lifecycle events.
  const hud: HudState = {};
  // The TUI handle from the footer factory — lets async state changes repaint the
  // statusline (the footer reads `hud`/`uiCtx` live on each render).
  let tuiHandle: { requestRender(): void } | undefined;
  // Researcher identity for the welcome panel (best-effort; may be incomplete).
  let identity: { name?: string; orcid?: string } | undefined;
  // Whether the welcome header is currently shown (cleared on first input).
  let headerActive = false;
  // Per-session tip rotation index for the welcome panel.
  let tipIndex = 0;
  // The last phase a banner was shown for, so a banner fires only on a change.
  let lastPhase: string | undefined;
  // One-shot: re-probe readiness on first input if the session-start probe failed.
  let connectionHealTried = false;

  function pushFooterRender(): void {
    tuiHandle?.requestRender();
  }

  /** Pin a "now in <phase>" banner in the transcript so the seam doesn't scroll away. */
  function announcePhase(state: string): void {
    const phase = currentStep(state);
    if (!phase || phase === lastPhase || !uiCtx?.hasUI) {
      lastPhase = phase ?? lastPhase;
      return;
    }
    lastPhase = phase;
    // `beril:lifecycle` fires synchronously inside lifecycle_transition.execute(),
    // i.e. while the agent is streaming — a plain sendMessage would be STEERED into
    // the live turn. `deliverAs:"nextTurn"` queues it passively so it only pins a
    // banner in the transcript without derailing the current turn.
    pi.sendMessage(
      {
        customType: "beril-phase",
        content: `Now in the ${phase} phase. Next: ${nextAction(state)}`,
        display: true,
        details: { phase, next: nextAction(state) },
      },
      { triggerTurn: false, deliverAs: "nextTurn" },
    );
  }

  function renderHud(): void {
    if (!uiCtx?.hasUI) return;
    const lines = workflowHud(uiCtx.ui.theme, hud);
    uiCtx.ui.setWidget(WIDGET_KEY, lines.length ? lines : undefined, { placement: "aboveEditor" });
    pushFooterRender();
  }

  // Listen for lifecycle/submission broadcasts from beril-governance and reflect
  // them in the HUD + footer. Registered at load so a listener exists before any emit.
  pi.events.on("beril:lifecycle", (data) => {
    const { project, state } = data as LifecycleEvent;
    hud.project = project;
    hud.state = state;
    hud.submitted = false;
    renderHud();
    announcePhase(state);
  });

  // The pinned phase banner — a tinted one-liner in the transcript on the custom-
  // message band. The leading glyph + phase word carry the accent (aqua), the same
  // "current/active" colour the statusline and step rail use, so the banner reads
  // as part of one visual language rather than a per-phase rainbow.
  pi.registerMessageRenderer("beril-phase", (message, _opts, theme) => {
    const d = message.details as { phase?: string; next?: string } | undefined;
    const phase = d?.phase ?? "phase";
    const label = theme.bold(theme.fg("accent", `${GLYPH.here} ${phase}`));
    const next = d?.next ? theme.fg("muted", `  ${GLYPH.arrow} ${d.next}`) : "";
    const box = new Box(1, 0, (t) => theme.bg("customMessageBg", t));
    box.addChild(new Text(`${label}${next}`, 0, 0));
    return box;
  });
  pi.events.on("beril:submitted", (data) => {
    const { project } = data as SubmittedEvent;
    hud.project = project;
    hud.submitted = true;
    renderHud();
  });

  /** Reflect a freshly-resolved env in the connection chip + HUD + footer. */
  function applyEnvToHud(env: BerdlEnv): void {
    hud.connection = connectionLabel(env);
    hud.location = compactLocation(env);
    hud.ready = env.ready;
    if (!uiCtx?.hasUI) return;
    uiCtx.ui.setStatus(STATUS_KEY, uiCtx.ui.theme.fg(env.ready ? "success" : "warning", connectionLabel(env)));
    renderHud();
  }

  // The statusline tracks the SHARED env cache, not just its own probe: every data
  // tool refreshes readiness via `requireReady` → `setCachedEnv`, so a connection
  // that comes up after a failed session-start probe (cold SSH tunnels / pproxy)
  // still surfaces — the chip self-heals the moment any tool confirms BERDL is up,
  // instead of staying stuck on "BERDL ?".
  const unsubscribeEnv = onEnvChange(applyEnvToHud);

  /** Re-run the readiness check, update the connection chip + HUD + footer. Returns the env (UI only). */
  async function refreshStatus(ctx: ExtensionContext): Promise<BerdlEnv | undefined> {
    if (!ctx.hasUI) return undefined;
    try {
      const env = await berilExec<BerdlEnv>(pi, ["env", "--json"]);
      setCachedEnv(env); // fires onEnvChange → applyEnvToHud (chip + HUD + footer)
      return env;
    } catch {
      hud.connection = "BERDL status unknown";
      hud.location = "BERDL ?";
      hud.ready = false;
      ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("error", "BERDL status unknown"));
      renderHud();
      return undefined;
    }
  }

  /** Read the researcher identity for the welcome panel — tolerates an incomplete (exit-1) identity. */
  async function fetchIdentity(): Promise<{ name?: string; orcid?: string } | undefined> {
    try {
      const res = await pi.exec("beril", ["user", "--json"], { timeout: 10_000 });
      const out = res.stdout?.trim();
      if (!out) return undefined;
      return JSON.parse(out) as { name?: string; orcid?: string };
    } catch {
      return undefined;
    }
  }

  /** The live statusline: connection · project · phase · context% · model. */
  function installFooter(ctx: ExtensionContext): void {
    ctx.ui.setFooter((tui, theme, footerData) => {
      tuiHandle = tui;
      const unsub = footerData.onBranchChange(() => tui.requestRender());
      return {
        dispose: unsub,
        invalidate() {},
        render(width: number): string[] {
          const usage = uiCtx?.getContextUsage();
          const data: FooterData = {
            connection: hud.location,
            ready: hud.ready,
            cwd: uiCtx?.cwd ? basename(uiCtx.cwd) : undefined,
            project: hud.project,
            phase: hud.state ? currentStep(hud.state) : undefined,
            context: usage
              ? { tokens: usage.tokens, percent: usage.percent, contextWindow: usage.contextWindow }
              : undefined,
            model: uiCtx?.model?.id,
          };
          return footerLines(theme, data, width);
        },
      };
    });
  }

  /** The first-launch welcome panel: identity, connection, the arc, and how to start. */
  function installHeader(ctx: ExtensionContext): void {
    headerActive = true;
    ctx.ui.setHeader((_tui, theme) => ({
      invalidate() {},
      render(width: number): string[] {
        const state: WelcomeState = {
          connection: hud.location,
          ready: hud.ready,
          researcher: identity?.name,
          orcidOk: Boolean(identity?.orcid),
          state: hud.state,
          tip: pickTip(tipIndex),
        };
        return welcomePanel(theme, state, width);
      },
    }));
  }

  pi.registerTool({
    name: "berdl_env_check",
    label: "Check BERDL environment",
    description:
      "Report whether the BERDL connection (on/off-cluster, SSH tunnels, pproxy, token) is ready, with next steps.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, _ctx) {
      const env = await berilExec<BerdlEnv>(pi, ["env", "--json"]);
      setCachedEnv(env); // keep the shared cache + statusline in sync with what the agent sees
      const steps = env.next_steps?.length ? `\nNext steps:\n- ${env.next_steps.join("\n- ")}` : "";
      const text = `BERDL ${env.location}: ${env.ready ? "ready" : "NOT ready"}${steps}`;
      return { content: [{ type: "text", text }], details: env };
    },
    renderCall(_args, theme) {
      return callLine(theme, "env · BERDL readiness");
    },
    renderResult(result, { isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      if (isPartial) return partialLine(theme, "Checking BERDL…");
      return envCard(theme, result.details as BerdlEnv);
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

  // Re-show the welcome/orientation panel on demand (it auto-clears on first input).
  pi.registerCommand("berdl-welcome", {
    description: "Re-show the beril welcome panel (orientation: connection, the research arc, how to start).",
    async handler(_args: string, ctx: ExtensionContext) {
      if (ctx.mode === "tui") installHeader(ctx);
    },
  });

  // Ctrl+Shift+O → re-show the orientation panel without typing the command.
  pi.registerShortcut(Key.ctrlShift("o"), {
    description: "Show the beril orientation panel (connection, the research arc, how to start).",
    handler: (ctx) => {
      if (ctx.mode === "tui") installHeader(ctx);
    },
  });

  pi.on("session_start", async (event, ctx) => {
    uiCtx = ctx;
    await refreshStatus(ctx);
    identity = await fetchIdentity();
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

    // The custom header/footer are TUI-only (no-op in rpc/json/print).
    if (ctx.mode === "tui") {
      tipIndex = Math.floor(Math.random() * TIPS.length);
      installFooter(ctx);
      // Only greet on a fresh start, not on reload/resume/fork.
      if (event.reason === "startup" || event.reason === "new") installHeader(ctx);
      pushFooterRender();
    }
  });

  // Clear the welcome panel once the scientist starts working, so it doesn't
  // permanently occupy the top of the screen. Always continue the input
  // unchanged — this is a side effect, never a transform.
  pi.on("input", (_event, ctx) => {
    if (headerActive && ctx.mode === "tui") {
      headerActive = false;
      ctx.ui.setHeader(undefined);
    }
    // If the session-start probe failed (chip stuck on "BERDL ?"), re-check once
    // now that the user is interacting — by now the remote tunnels/pproxy are up.
    // One-shot so a genuinely-disconnected session doesn't re-exec on every input.
    if (!connectionHealTried && hud.location === "BERDL ?" && ctx.hasUI) {
      connectionHealTried = true;
      void refreshStatus(ctx);
    }
    return { action: "continue" } as const;
  });

  pi.on("session_shutdown", (_event, ctx) => {
    unsubscribeEnv();
    if (ctx.hasUI) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      ctx.ui.setWidget(WIDGET_KEY, undefined);
    }
    if (ctx.mode === "tui") {
      ctx.ui.setFooter(undefined);
      ctx.ui.setHeader(undefined);
    }
  });
}
