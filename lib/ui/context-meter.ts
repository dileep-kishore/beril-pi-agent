import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import { GLYPH } from "./glyphs.ts";

/**
 * Context-window usage → a traffic-light colour + a compact label for the
 * statusline. Ported from oh-my-pi's dual-gate idea: warn on EITHER a percentage
 * of the window OR an absolute token count (a big window can be a lot of tokens
 * while still low-percent, and vice-versa), so the scientist gets a calibrated
 * "how full is the context" signal at a glance. Pure.
 */

/**
 * A clean green→amber→red traffic light on a dual gate (percentage OR absolute
 * tokens, whichever trips first — a big window can hold a lot of tokens while
 * still low-percent): healthy below ~55%/160k, `warning` from there, `error` at
 * ≥85% or ≥400k. Uses only the three semantic role tokens, so the "getting full"
 * tier is always visibly distinct from the healthy tier (the previous build
 * reused `thinkingHigh`, which is green — indistinguishable from `success`).
 */
export function contextColor(percent: number | null, tokens: number | null): ThemeColor {
  const p = percent ?? 0;
  const t = tokens ?? 0;
  if (p >= 85 || t >= 400_000) return "error";
  if (p >= 55 || t >= 160_000) return "warning";
  return "success";
}

/** A tiny `cells`-wide usage bar, e.g. `▰▰▱▱▱▱` for ~33%. Clamps to [0,100]; unknown → empty. */
export function contextGauge(percent: number | null, cells = 6): string {
  const p = percent == null ? 0 : Math.min(100, Math.max(0, percent));
  const filled = Math.round((p / 100) * cells);
  return GLYPH.gaugeFull.repeat(filled) + GLYPH.gaugeEmpty.repeat(cells - filled);
}

/** Compact token count for the statusline: `980`, `12.3k`, `1.2M`; `—` when unknown. */
export function formatTokens(tokens: number | null | undefined): string {
  if (tokens == null) return "—";
  if (tokens < 1000) return String(tokens);
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}
