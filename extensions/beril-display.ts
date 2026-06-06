import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Display defaults that keep the science in the foreground.
 *
 * Pi has no API to single out one tool for de-emphasis, but it can collapse
 * routine tool output by default. We do that on startup: bash commands, file
 * reads/writes, and other plumbing then render as a one-line summary the
 * scientist can expand on demand (ctrl+e), while the science tools' cards stay
 * legible because their *collapsed* view IS the framed data/literature/plan body
 * (see lib/ui). The result is the requested hierarchy — science cards lead, the
 * commands that produced them recede — without ever touching tool registration
 * or the destructive-action safety gate.
 *
 * TUI-only: headless runs (`--print`/`--mode json`) have no tool view to toggle.
 */
export default function berilDisplay(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode === "tui") ctx.ui.setToolsExpanded(false);
  });
}
