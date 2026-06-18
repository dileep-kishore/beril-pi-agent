import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isDestructive } from "../lib/destructive.ts";
import { destructiveSummary, makeDestructiveOverlay } from "../lib/ui/destructive-overlay.ts";

/**
 * Central destructive-action gate. Pi has no built-in permission system, so this
 * extension intercepts every tool call and requires confirmation for irreversible
 * operations (BERDL export overwrite, lakehouse submit, `mc rm`/`rm -rf` via bash).
 *
 * Non-interactive sessions (no UI) auto-deny destructive calls rather than proceeding.
 */
export default function berilSafety(pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    const toolName = (event as { toolName?: string }).toolName;
    const input = ((event as { input?: Record<string, unknown> }).input ?? {}) as Record<string, unknown>;
    if (!toolName || !isDestructive(toolName, input)) return undefined;
    // Fail-closed under Pi 0.79 project trust: an untrusted project must never run
    // an irreversible operation. The gate cannot pop a trusted confirm dialog here,
    // so the only safe action is to deny (the reason surfaces to the user).
    if (!ctx.isProjectTrusted()) {
      return { block: true, reason: `Destructive tool ${toolName} blocked: project is not trusted` };
    }
    if (!ctx.hasUI) {
      return { block: true, reason: `Destructive tool ${toolName} blocked in non-interactive mode` };
    }
    const ok =
      ctx.mode === "tui"
        ? await ctx.ui.custom<boolean>(makeDestructiveOverlay(toolName, input), {
            overlay: true,
            overlayOptions: { width: "70%", anchor: "center", maxHeight: "80%" },
          })
        : await ctx.ui.confirm(`Allow ${toolName}?`, `${destructiveSummary(toolName, input).join("\n")}\n\nProceed?`);
    return ok ? undefined : { block: true, reason: `User declined ${toolName}` };
  });
}
