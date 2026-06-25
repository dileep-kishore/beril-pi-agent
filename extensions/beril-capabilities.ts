import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { berilExec } from "../lib/beril-exec.ts";
import {
  type CapabilityCatalogOptions,
  capabilityCatalogMarkdown,
  matchCapability,
  runtimeSurfaceSummary,
} from "../lib/capabilities.ts";
import { decideNudge, phrase } from "../lib/nudge-policy.ts";
import { capabilitiesCard } from "../lib/ui/capabilities.ts";

function parseCatalogMode(args: string): CapabilityCatalogOptions["mode"] {
  return args.trim().split(/\s+/).includes("--all") ? "all" : "guide";
}

function catalog(pi: ExtensionAPI, mode: CapabilityCatalogOptions["mode"] = "guide"): string {
  return capabilityCatalogMarkdown(runtimeSurfaceSummary(pi.getCommands?.() ?? [], pi.getAllTools?.() ?? []), {
    mode,
  });
}

function showCatalog(pi: ExtensionAPI, ctx: ExtensionCommandContext, mode: CapabilityCatalogOptions["mode"]): void {
  const markdown = catalog(pi, mode);
  pi.sendMessage(
    {
      customType: "beril-capabilities",
      content: markdown,
      display: true,
      details: { markdown },
    },
    { triggerTurn: false },
  );
  if (ctx.hasUI) ctx.ui.notify("BERIL capabilities shown.", "info");
}

function textContent(content: unknown): string {
  return typeof content === "string" ? content : "";
}

export default function berilCapabilities(pi: ExtensionAPI) {
  // Lifecycle phase cache, fed by the shared `beril:lifecycle` bus and seeded
  // once on session_start. Lets the route nudge gate on where the project
  // actually is — at zero per-turn subprocess cost — instead of firing on any
  // keyword match. Per-session (resets on reload/new), like beril-env's hud.
  let status: string | undefined;
  let project: string | undefined;
  // Throttle: a capability is nudged at most once per lifecycle status; the set
  // clears whenever the status changes, so a new phase re-arms the nudge.
  const nudgedInStatus = new Set<string>();

  // Registered at load so a listener exists before any emit (the bus has no replay).
  pi.events.on("beril:lifecycle", (data) => {
    const { project: p, state } = data as { project?: string; state?: string };
    if (state !== status) nudgedInStatus.clear();
    status = state;
    project = p;
  });

  pi.registerMessageRenderer<{ markdown?: string }>("beril-capabilities", (message, _opts, theme) =>
    capabilitiesCard(theme, message.details?.markdown ?? textContent(message.content)),
  );
  pi.registerMessageRenderer<{ nudge?: string }>("beril-skill-nudge", (message, _opts, theme) =>
    capabilitiesCard(theme, message.details?.nudge ?? textContent(message.content)),
  );

  pi.registerCommand("skills", {
    description: "Show common BERIL moves grouped by scientist intent.",
    async handler(args, ctx) {
      showCatalog(pi, ctx, parseCatalogMode(args));
    },
  });

  pi.registerCommand("capabilities", {
    description: "Show BERIL moves; pass --all for commands, skills, and tools.",
    async handler(args, ctx) {
      showCatalog(pi, ctx, parseCatalogMode(args));
    },
  });

  pi.registerShortcut?.(Key.ctrlShift("k"), {
    description: "Show BERIL capability palette.",
    handler(ctx) {
      if (ctx.hasUI) {
        const markdown = catalog(pi, "guide");
        pi.sendMessage(
          { customType: "beril-capabilities", content: markdown, display: true, details: { markdown } },
          { triggerTurn: false },
        );
      }
    },
  });

  // Seed the phase cache once from the CLI (the bus only fires going forward).
  // Reason-gated to match beril-env's HUD so the caches never disagree on a
  // fresh/new session. Best-effort: never throws, never blocks the turn.
  pi.on("session_start", async (event, ctx) => {
    try {
      // Mirror beril-env.shouldSeedActiveProject: skip a fresh `/new` (and a
      // `fresh` startup mode) so we don't gate on a stale prior project.
      const reason = (event as { reason?: string }).reason;
      if (reason === "new") return;
      if (reason === "startup" && process.env.BERIL_START_SESSION_MODE === "fresh") return;
      if (!ctx.hasUI) return;
      const cur = await berilExec<{ project?: string; status?: string }>(pi, ["lifecycle", "current"]);
      if (!cur.project) return;
      project = cur.project;
      if (cur.status) status = cur.status;
    } catch {
      // Best-effort: an unknown phase simply means "don't gate" downstream.
    }
  });

  // The route nudge: contextual, throttled, and state-aware. The decision is
  // computed SYNCHRONOUSLY (Pi awaiting an async before_agent_start is
  // unverified, and the current turn consumes the return value).
  pi.on("before_agent_start", (event, ctx) => {
    // Fail-closed: never steer or surface UI on an untrusted project.
    if (!ctx.isProjectTrusted()) return undefined;
    // Headless (json/print): the card cannot render and no scientist reads the
    // steer. Kept distinct from the trust check so re-enabling a headless steer
    // is a one-line change.
    if (!ctx.hasUI) return undefined;
    const cap = matchCapability(event.prompt);
    if (!cap) return undefined;
    const decision = decideNudge({ cap, status, project });
    if (decision.kind === "suppress") return undefined;
    // Throttle once per (route, status). Redirects share one key per status so a
    // run of off-phase prompts produces a single steer until the phase changes.
    const key =
      decision.kind === "redirect" ? `redirect@${status ?? "unknown"}` : `nudge:${cap.id}@${status ?? "unknown"}`;
    if (nudgedInStatus.has(key)) return undefined;
    nudgedInStatus.add(key);
    const body = phrase(decision);
    const details =
      decision.kind === "redirect"
        ? { nudge: body, command: decision.command, redirectedFrom: cap.id }
        : { nudge: body, capability: cap.id, command: cap.command, skill: cap.skill, prompt: cap.prompt };
    return {
      systemPrompt: `${event.systemPrompt}\n\n${body}\nUse the named BERIL prompt, skill, or tool route if it fits the user's intent; ignore this hint if local context contradicts it.`,
      message: {
        customType: "beril-skill-nudge",
        content: body,
        display: true,
        details,
      },
    };
  });
}
