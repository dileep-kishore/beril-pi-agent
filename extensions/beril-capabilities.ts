import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { capabilityCatalogMarkdown, matchCapability, routeNudge, runtimeSurfaceSummary } from "../lib/capabilities.ts";
import { capabilitiesCard } from "../lib/ui/capabilities.ts";

function catalog(pi: ExtensionAPI): string {
  return capabilityCatalogMarkdown(runtimeSurfaceSummary(pi.getCommands?.() ?? [], pi.getAllTools?.() ?? []));
}

function showCatalog(pi: ExtensionAPI, ctx: ExtensionCommandContext): void {
  const markdown = catalog(pi);
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
  pi.registerMessageRenderer<{ markdown?: string }>("beril-capabilities", (message, _opts, theme) =>
    capabilitiesCard(theme, message.details?.markdown ?? textContent(message.content)),
  );
  pi.registerMessageRenderer<{ nudge?: string }>("beril-skill-nudge", (message, _opts, theme) =>
    capabilitiesCard(theme, message.details?.nudge ?? textContent(message.content)),
  );

  pi.registerCommand("skills", {
    description: "Show BERIL skills grouped by scientist intent.",
    async handler(_args, ctx) {
      showCatalog(pi, ctx);
    },
  });

  pi.registerCommand("capabilities", {
    description: "Show BERIL commands, skills, and tools grouped by workflow intent.",
    async handler(_args, ctx) {
      showCatalog(pi, ctx);
    },
  });

  pi.registerShortcut?.(Key.ctrlShift("k"), {
    description: "Show BERIL capability palette.",
    handler(ctx) {
      if (ctx.hasUI) {
        const markdown = catalog(pi);
        pi.sendMessage(
          { customType: "beril-capabilities", content: markdown, display: true, details: { markdown } },
          { triggerTurn: false },
        );
      }
    },
  });

  pi.on("before_agent_start", (event) => {
    const cap = matchCapability(event.prompt);
    if (!cap) return;
    const nudge = routeNudge(cap);
    return {
      systemPrompt: `${event.systemPrompt}\n\n${nudge}\nUse the named BERIL prompt, skill, or tool route if it fits the user's intent; ignore this hint if local context contradicts it.`,
      message: {
        customType: "beril-skill-nudge",
        content: nudge,
        display: true,
        details: { nudge, capability: cap.id, command: cap.command, skill: cap.skill, prompt: cap.prompt },
      },
    };
  });
}
