import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { contextColor, contextGauge, formatTokens } from "./context-meter.ts";
import { GLYPH } from "./glyphs.ts";

/**
 * The rich, always-visible statusline (a custom `setFooter` component). It is a
 * two-line, oh-my-pi-style segmented line — a real status bar, not a keyed-status
 * string:
 *
 *   BERDL off-cluster ✓ · 📁 beril-pi-agent
 *   ▣ project ▸ analyze · ctx ▰▰▱▱▱▱ 34% (12.3k / 200k) · opus-4.8
 *
 * Line 1 is the environment (connection · working dir); line 2 is the work
 * (project ▸ phase · context gauge · model). Empty segments are dropped and an
 * all-empty line is omitted, so a bare session still shows a useful two lines.
 * Context is coloured by `contextColor` so a filling window is visible at a
 * glance. Pure: takes a theme + the current data and returns the (width-clamped)
 * lines; the `beril-env` extension owns the live state and the `setFooter`
 * wiring. Unit-tested with a pass-through theme.
 */

/** The theme surface the footer needs — a real `Theme` satisfies it; tests pass a fake. */
export type FooterTheme = Pick<Theme, "fg">;

export interface FooterData {
  /** Compact connection label without a glyph, e.g. "BERDL off-cluster". */
  connection?: string;
  ready?: boolean;
  /** Working-directory basename, e.g. "beril-pi-agent". */
  cwd?: string;
  project?: string;
  /** Current research phase, e.g. "analyze". */
  phase?: string;
  context?: { tokens: number | null; percent: number | null; contextWindow?: number | null };
  /** Model id. */
  model?: string;
}

/**
 * The connection chip on line 1: a colored connection label + a glyph reflecting
 * readiness. `ready` → `${GLYPH.ok}`/success; present-but-not-ready (`!ready`) →
 * `${GLYPH.warn}`/warning (a caution, not an operational failure).
 */
export function connectionChip(theme: FooterTheme, connection: string, ready: boolean): string {
  const mark = ready ? GLYPH.ok : GLYPH.warn;
  return theme.fg(ready ? "success" : "warning", `${connection} ${mark}`);
}

/** The context segment: a gauge + percent + (tokens / window), coloured by fullness. */
function contextSegment(theme: FooterTheme, c: NonNullable<FooterData["context"]>): string {
  const gauge = contextGauge(c.percent);
  const pct = c.percent != null ? `${Math.round(c.percent)}%` : "—";
  const win = c.contextWindow ? ` / ${formatTokens(c.contextWindow)}` : "";
  return theme.fg(contextColor(c.percent, c.tokens), `ctx ${gauge} ${pct} (${formatTokens(c.tokens)}${win})`);
}

/** Build the two-line statusline. Drops empty segments/lines; clamps each line to `width`. */
export function footerLines(theme: FooterTheme, d: FooterData, width: number): string[] {
  if (width <= 0) return [];
  const sep = theme.fg("dim", ` ${GLYPH.bullet} `);

  // Line 1 — the environment.
  const top: string[] = [];
  if (d.connection) top.push(connectionChip(theme, d.connection, d.ready ?? false));
  if (d.cwd) top.push(theme.fg("dim", `${GLYPH.folder} ${d.cwd}`));

  // Line 2 — the work. Project + phase group on the left with context; model
  // pushed to the right edge, joined by a gap rule when there's room.
  const bottom: string[] = [];
  const where: string[] = [];
  if (d.project) where.push(theme.fg("accent", `${GLYPH.project} ${d.project}`));
  if (d.phase) where.push(theme.fg("accent", `${GLYPH.here} ${d.phase}`));
  if (where.length) bottom.push(where.join(" "));
  if (d.context) bottom.push(contextSegment(theme, d.context));
  const model = d.model ? theme.fg("dim", d.model) : "";

  const lines: string[] = [];
  if (top.length) lines.push(truncateToWidth(top.join(sep), width));

  if (bottom.length || model) {
    const left = bottom.join(sep);
    const gap = model ? width - visibleWidth(left) - visibleWidth(model) - 2 : 0;
    if (model && gap >= 1) {
      // Gap-rule right-justify: left segments, a dim rule, then the model.
      lines.push(`${left} ${theme.fg("dim", "─".repeat(gap))} ${model}`);
    } else {
      // Too narrow for a rule — fall back to the separator-joined, clamped layout.
      const segments = model ? [...bottom, model] : bottom;
      lines.push(truncateToWidth(segments.join(sep), width));
    }
  }
  return lines;
}
