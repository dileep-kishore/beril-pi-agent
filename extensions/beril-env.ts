import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Box, Key, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { berilExec } from "../lib/beril-exec.ts";
import { type ClaimTally, parseClaimLedger, tallyClaims } from "../lib/claim-ledger.ts";
import { type BerdlEnv, onEnvChange, setCachedEnv } from "../lib/readiness.ts";
import { currentStep, nextAction, sessionName } from "../lib/research-steps.ts";
import { type Brand, brandForTheme } from "../lib/ui/brand.ts";
import { type FooterData, footerLines } from "../lib/ui/footer.ts";
import { GLYPH } from "../lib/ui/glyphs.ts";
import { callLine, envCard, errorCard, partialLine, toolErrorText } from "../lib/ui/science-cards.ts";
import { applyToolEnd, applyToolStart, substepsForPhase } from "../lib/ui/substeps.ts";
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
interface ClaimsEvent {
  project: string;
  total: number;
  supported: number;
  refuted: number;
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
  // Claim-ledger tally for the active project, shown on the statusline. Updated by
  // the `beril:claims` broadcast (and seeded on session_start); footer-only.
  let claims: ClaimTally | undefined;
  // The TUI handle from the footer factory — lets async state changes repaint the
  // statusline (the footer reads `hud`/`uiCtx` live on each render).
  let tuiHandle: { requestRender(): void } | undefined;
  // Product/skin brand for copy and statusline. BERDL remains the connection layer.
  let brand: Brand = brandForTheme(process.env.BERIL_THEME);
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
        content: `Now in the ${phase} phase. Suggested: ${nextAction(state)}`,
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

  function shouldSeedActiveProject(reason?: string): boolean {
    if (reason === "new") return false;
    if (reason === "startup" && process.env.BERIL_START_SESSION_MODE === "fresh") return false;
    return true;
  }

  function clearResearchHud(): void {
    hud.project = undefined;
    hud.state = undefined;
    hud.submitted = false;
    hud.substeps = undefined;
    claims = undefined;
    lastPhase = undefined;
    renderHud();
    pushFooterRender();
  }

  /**
   * Name the Pi session after the active project + phase, so a resumed session
   * (explicit `--continue` / `--resume`) reads as "<project> · <phase>" in the
   * selector instead of a raw UUID. Idempotent via getSessionName(); no-op until a
   * project is known. setSessionName/getSessionName live on the ExtensionAPI (pi).
   */
  function applySessionName(): void {
    if (!hud.project) return;
    const name = sessionName(hud.project, hud.state);
    if (pi.getSessionName() === name) return;
    pi.setSessionName(name);
  }

  // Listen for lifecycle/submission broadcasts from beril-governance and reflect
  // them in the HUD + footer. Registered at load so a listener exists before any emit.
  pi.events.on("beril:lifecycle", (data) => {
    const { project, state } = data as LifecycleEvent;
    hud.project = project;
    hud.state = state;
    hud.submitted = false;
    // A phase change resets the within-phase sub-step overlay to a fresh manifest.
    hud.substeps = substepsForPhase(currentStep(state));
    renderHud();
    applySessionName();
    announcePhase(state);
  });

  pi.registerMessageRenderer<{ env?: BerdlEnv }>("beril-env-status", (message, _opts, theme) => {
    const env = message.details?.env ?? {
      location: "unknown",
      ready: false,
      checks: {},
      next_steps: ["Run /berdl-start for connection guidance, or inspect `beril env --json` for the raw error."],
    };
    return envCard(theme, env);
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

  // The claim_ledger tool broadcasts the tally whenever it parses a project, so the
  // statusline reflects where the science stands without re-reading anything.
  pi.events.on("beril:claims", (data) => {
    const { total, supported, refuted } = data as ClaimsEvent;
    claims = { total, supported, refuted };
    pushFooterRender();
  });

  // Animate the within-phase sub-step overlay from observed tool runs (TUI only).
  // `applyTool*` return the SAME reference when nothing changed; the referential-
  // equality short-circuit makes a tool call that doesn't move a step a true no-op
  // (no repaint), so the HUD only re-renders when the overlay actually advances.
  pi.on("tool_execution_start", (event) => {
    if (!uiCtx?.hasUI || !hud.substeps) return;
    const next = applyToolStart(hud.substeps, event.toolName, event.args);
    if (next === hud.substeps) return;
    hud.substeps = next;
    renderHud();
  });
  pi.on("tool_execution_end", (event) => {
    if (!uiCtx?.hasUI || !hud.substeps) return;
    const next = applyToolEnd(hud.substeps, event.toolName, event.isError);
    if (next === hud.substeps) return;
    hud.substeps = next;
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

  /** Re-run the readiness check, update the connection chip + HUD + footer. Returns the env. */
  async function refreshStatus(ctx: ExtensionContext): Promise<BerdlEnv | undefined> {
    try {
      const env = await berilExec<BerdlEnv>(pi, ["env", "--json"]);
      setCachedEnv(env); // fires onEnvChange → applyEnvToHud (chip + HUD + footer)
      return env;
    } catch {
      hud.connection = "BERDL status unknown";
      hud.location = "BERDL ?";
      hud.ready = false;
      if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("error", "BERDL status unknown"));
      renderHud();
      return undefined;
    }
  }

  function showEnvStatus(env: BerdlEnv | undefined): void {
    const fallback: BerdlEnv = {
      location: "unknown",
      ready: false,
      checks: {},
      next_steps: ["Run /berdl-start for connection guidance, or inspect `beril env --json` for the raw error."],
    };
    const shown = env ?? fallback;
    pi.sendMessage(
      {
        customType: "beril-env-status",
        content: `BERDL ${shown.location}: ${shown.ready ? "ready" : "not ready"}`,
        display: true,
        details: { env: shown },
      },
      { triggerTurn: false },
    );
  }

  /** Parse a project's plan + report into a claim tally (best-effort; undefined when empty/unreadable). */
  async function readClaimTally(cwd: string, project: string): Promise<ClaimTally | undefined> {
    try {
      const dir = join(cwd, "projects", project);
      const [plan, report] = await Promise.all([
        readFile(join(dir, "RESEARCH_PLAN.md"), "utf8").catch(() => ""),
        readFile(join(dir, "REPORT.md"), "utf8").catch(() => ""),
      ]);
      const tally = tallyClaims(parseClaimLedger(plan, report));
      return tally.total > 0 ? tally : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Seed the active project's stage + claim tally on a cold start, so the statusline
   * shows where the science stands before any tool runs. The event bus has no replay,
   * so we ask the CLI which project is active (`lifecycle current`). Best-effort.
   */
  async function seedActiveProject(ctx: ExtensionContext): Promise<void> {
    claims = undefined; // start clean so a completed/removed project doesn't leave a stale tally
    try {
      const cur = await berilExec<{ project?: string; status?: string }>(pi, ["lifecycle", "current"]);
      if (!cur.project) return;
      hud.project = cur.project;
      if (cur.status) hud.state = cur.status;
      hud.substeps = substepsForPhase(cur.status ? currentStep(cur.status) : undefined);
      renderHud();
      applySessionName();
      claims = await readClaimTally(ctx.cwd, cur.project);
      pushFooterRender();
    } catch {
      // best-effort: a missing/unreadable project must not break startup
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

  /** The live statusline: connection › cwd+branch › project ▸ phase › claims › ctx% — ORCID · model. */
  function installFooter(ctx: ExtensionContext): void {
    ctx.ui.setFooter((tui, theme, footerData) => {
      tuiHandle = tui;
      const unsub = footerData.onBranchChange(() => tui.requestRender());
      return {
        dispose: unsub,
        invalidate() {},
        render(width: number): string[] {
          const usage = uiCtx?.getContextUsage();
          // getGitBranch() → "detached" on a pinned release; show only a real branch.
          const branch = footerData.getGitBranch();
          const data: FooterData = {
            brand: brand.name,
            connection: hud.location,
            ready: hud.ready,
            cwd: uiCtx?.cwd ? basename(uiCtx.cwd) : undefined,
            branch: branch && branch !== "detached" ? branch : undefined,
            project: hud.project,
            phase: hud.state ? currentStep(hud.state) : undefined,
            claims,
            context: usage
              ? { tokens: usage.tokens, percent: usage.percent, contextWindow: usage.contextWindow }
              : undefined,
            model: uiCtx?.model?.id,
            orcid: Boolean(identity?.orcid),
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
          brand,
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
      showEnvStatus(env);
      if (ctx.hasUI) {
        ctx.ui.notify(
          env?.ready ? "BERDL ready." : "BERDL not ready — see next steps.",
          env?.ready ? "info" : "warning",
        );
      }
    },
  });

  pi.registerCommand("berdl-status", {
    description: "Refresh and show the BERDL connection status.",
    async handler(_args: string, ctx: ExtensionContext) {
      const env = await refreshStatus(ctx);
      showEnvStatus(env);
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
    brand = brandForTheme(process.env.BERIL_THEME);
    await refreshStatus(ctx);
    identity = await fetchIdentity();
    // Seed project state only when restoring a session. A fresh `beril start` or
    // Pi `/new` must not display the last lifecycle project as if it were active.
    if (ctx.hasUI) {
      if (shouldSeedActiveProject(event.reason)) await seedActiveProject(ctx);
      else clearResearchHud();
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
