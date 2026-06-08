import type { ThemeColor } from "@earendil-works/pi-coding-agent";

/**
 * Context-window usage → a traffic-light colour + a compact label for the
 * statusline. Ported from oh-my-pi's dual-gate idea: warn on EITHER a percentage
 * of the window OR an absolute token count (a big window can be a lot of tokens
 * while still low-percent, and vice-versa), so the scientist gets a calibrated
 * "how full is the context" signal at a glance. Pure.
 */

/** Warn at ≥50% or ≥150k tokens; alarm at ≥90% or ≥500k tokens. */
export function contextColor(percent: number | null, tokens: number | null): ThemeColor {
  const p = percent ?? 0;
  const t = tokens ?? 0;
  if (p >= 90 || t >= 500_000) return "error";
  if (p >= 50 || t >= 150_000) return "warning";
  return "success";
}

/** `ctx 38%` (or `ctx —` when usage is unknown, e.g. right after compaction). */
export function formatContext(usage: { tokens: number | null; percent: number | null } | undefined): string {
  if (!usage || usage.percent == null) return "ctx —";
  return `ctx ${Math.round(usage.percent)}%`;
}
