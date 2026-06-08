import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { contextColor, formatContext } from "./context-meter.ts";
import { GLYPH } from "./glyphs.ts";

/**
 * The rich, always-visible statusline (a custom `setFooter` component). It
 * replaces the keyed-status string with a real segmented line:
 *
 *   BERDL off-cluster ✓ · ▣ project · ▸ analyze · ctx 38% · opus-4.8
 *
 * Left group = connection · project · phase · context%; the model is pushed to
 * the right edge. Context% is coloured by `contextColor` so a filling window is
 * visible without doing the math. Pure: takes a theme + the current data and
 * returns one width-clamped line (the `beril-env` extension owns the live state
 * and the `setFooter` wiring). Unit-tested with a pass-through theme.
 */

/** The theme surface the footer needs — a real `Theme` satisfies it; tests pass a fake. */
export type FooterTheme = Pick<Theme, "fg">;

export interface FooterData {
  /** Compact connection label without a glyph, e.g. "BERDL off-cluster". */
  connection?: string;
  ready?: boolean;
  project?: string;
  /** Current research phase, e.g. "analyze". */
  phase?: string;
  context?: { tokens: number | null; percent: number | null };
  /** Model id, right-aligned. */
  model?: string;
}

/** Build the statusline. Returns "" when there is nothing to show. */
export function footerLine(theme: FooterTheme, d: FooterData, width: number): string {
  if (width <= 0) return "";
  const sep = theme.fg("dim", ` ${GLYPH.bullet} `);

  const left: string[] = [];
  if (d.connection) {
    const mark = d.ready ? GLYPH.ok : GLYPH.bad;
    left.push(theme.fg(d.ready ? "success" : "warning", `${d.connection} ${mark}`));
  }
  if (d.project) left.push(theme.fg("accent", `${GLYPH.project} ${d.project}`));
  if (d.phase) left.push(theme.fg("accent", `${GLYPH.here} ${d.phase}`));
  if (d.context && d.context.percent != null) {
    left.push(theme.fg(contextColor(d.context.percent, d.context.tokens), formatContext(d.context)));
  }

  const leftStr = left.join(sep);
  const right = d.model ? theme.fg("dim", d.model) : "";
  if (!right) return truncateToWidth(leftStr, width);

  // Right-align the model; if the line would overflow, the left group is truncated.
  const gap = width - visibleWidth(leftStr) - visibleWidth(right);
  if (gap < 1) return truncateToWidth(leftStr, width);
  return truncateToWidth(`${leftStr}${" ".repeat(gap)}${right}`, width);
}
