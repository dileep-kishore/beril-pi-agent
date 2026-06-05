import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isDestructive } from "../lib/destructive.ts";

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
    if (!ctx.hasUI) {
      return { block: true, reason: `Destructive tool ${toolName} blocked in non-interactive mode` };
    }
    const ok = await ctx.ui.confirm(
      `Allow ${toolName}?`,
      "This will irreversibly modify remote data. Proceed?",
    );
    return ok ? undefined : { block: true, reason: `User declined ${toolName}` };
  });
}
