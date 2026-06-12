import type { Theme } from "@earendil-works/pi-coding-agent";
import { GLYPH } from "./glyphs.ts";

export const PREVIEW_LIMITS = { collapsedLines: 3, expandedLines: 12, collapsedItems: 8 } as const;
export const TRUNCATE = { title: 60, content: 80, line: 110, short: 40 } as const;

/** Card lifecycle/result state → border + icon semantics. */
export type CardState = "running" | "pending" | "success" | "error" | "warning" | "settled";

type IconTheme = Pick<Theme, "fg">;

/** A colored status glyph for a card state (operational axis; reuses GLYPH). */
export function statusIcon(theme: IconTheme, state: CardState): string {
  switch (state) {
    case "success":
      return theme.fg("success", GLYPH.ok);
    case "error":
      return theme.fg("error", GLYPH.bad);
    case "warning":
      return theme.fg("warning", GLYPH.warn);
    case "running":
      return theme.fg("accent", GLYPH.inProgress);
    case "pending":
      return theme.fg("muted", GLYPH.pending);
    default:
      return theme.fg("dim", GLYPH.bullet);
  }
}

/** A colored `[label]` badge. */
export function badge(theme: IconTheme, label: string, color: Parameters<Theme["fg"]>[0] = "muted"): string {
  return theme.fg(color, `[${label}]`);
}

/** "… 7 more lines" (pluralized). */
export function moreItems(remaining: number, noun: string): string {
  return `… ${remaining} more ${noun}${remaining === 1 ? "" : "s"}`;
}

/** Dim "Ctrl+O to expand" hint, suppressed when expanded or nothing more. */
export function expandHint(theme: IconTheme, expanded: boolean, hasMore: boolean): string {
  return !expanded && hasMore ? theme.fg("dim", "Ctrl+O to expand") : "";
}

/** Head+tail window: keep the first ceil(limit/2) and last floor(limit/2) with a middle "… N more lines". */
export function capPreviewLines(lines: string[], limit: number): string[] {
  if (lines.length <= limit) return lines;
  const head = Math.ceil(limit / 2);
  const tail = Math.floor(limit / 2);
  return [...lines.slice(0, head), moreItems(lines.length - head - tail, "line"), ...lines.slice(lines.length - tail)];
}

/** Tabs → 2 spaces (terminal-safe), per oh-my-pi's sanitization rule. */
export function sanitizeLine(s: string): string {
  return s.replace(/\t/g, "  ");
}
