import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { contextColor, formatTokens } from "./context-meter.ts";
import { GLYPH } from "./glyphs.ts";

/**
 * The always-visible statusline (a custom `setFooter` component): a single,
 * chevron-grouped segment line in the oh-my-pi idiom — a real status bar, not a
 * keyed-status string:
 *
 *   BERDL off-cluster ✔ › ⌂ beril-pi-agent › ◆ project ▸ analyze › ctx 34% (12.3k/200k) ──── opus-4.8
 *
 * Groups read left→right — environment (connection), location (cwd), the work
 * (project ▸ phase), and context — joined by a dim ` › ` chevron; the model is
 * right-justified by a dim gap rule. Empty groups drop out, and when the line is
 * too narrow the trailing groups are shed (model, then context, then location)
 * so the connection + work always survive. Context is coloured by `contextColor`
 * so a filling window is visible at a glance. Pure: takes a theme + the current
 * data and returns the (width-clamped) line; the `beril-env` extension owns the
 * live state and the `setFooter` wiring. Unit-tested with a pass-through theme.
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

/** The context group: `ctx 34%` (coloured by fullness) + a dim `(tokens/window)`. */
function contextSegment(theme: FooterTheme, c: NonNullable<FooterData["context"]>): string {
  const pct = c.percent != null ? `${Math.round(c.percent)}%` : "—";
  const win = c.contextWindow ? `/${formatTokens(c.contextWindow)}` : "";
  const head = theme.fg(contextColor(c.percent, c.tokens), `ctx ${pct}`);
  return `${head} ${theme.fg("dim", `(${formatTokens(c.tokens)}${win})`)}`;
}

/** Build the single-line statusline. Drops empty groups; sheds trailing groups, then clamps, to fit `width`. */
export function footerLines(theme: FooterTheme, d: FooterData, width: number): string[] {
  if (width <= 0) return [];
  const chevron = theme.fg("dim", ` ${GLYPH.chevron} `);

  // Left groups, in shed order: the connection and the work always survive; the
  // location and context are dropped first when the line is too narrow.
  const where: string[] = [];
  if (d.project) where.push(theme.fg("accent", `${GLYPH.project} ${d.project}`));
  if (d.phase) where.push(theme.fg("accent", `${GLYPH.here} ${d.phase}`));

  const groups: { text: string; keep: boolean }[] = [];
  if (d.connection) groups.push({ text: connectionChip(theme, d.connection, d.ready ?? false), keep: true });
  if (d.cwd) groups.push({ text: theme.fg("dim", `${GLYPH.folder} ${d.cwd}`), keep: false });
  if (where.length) groups.push({ text: where.join(" "), keep: true });
  if (d.context) groups.push({ text: contextSegment(theme, d.context), keep: false });

  const model = d.model ? theme.fg("dim", d.model) : "";
  if (!groups.length && !model) return [];

  // Shed droppable groups from the right until the line (left groups + model)
  // fits; required groups (connection, work) stay even if they then truncate.
  let shown = groups;
  const fits = (gs: { text: string }[]): boolean => {
    const left = gs.map((g) => g.text).join(chevron);
    const need = model ? visibleWidth(left) + visibleWidth(model) + 3 : visibleWidth(left);
    return need <= width;
  };
  while (!fits(shown) && shown.some((g) => !g.keep)) {
    const lastDroppable = shown.map((g) => g.keep).lastIndexOf(false);
    shown = shown.filter((_, i) => i !== lastDroppable);
  }

  const left = shown.map((g) => g.text).join(chevron);
  if (!model) return [truncateToWidth(left, width)];

  const gap = width - visibleWidth(left) - visibleWidth(model) - 2;
  if (gap >= 1) {
    // Gap-rule right-justify: left groups, a dim rule, then the model.
    return [`${left} ${theme.fg("dim", "─".repeat(gap))} ${model}`];
  }
  // Too narrow for a rule — chevron-join the model and clamp.
  return [truncateToWidth(`${left}${chevron}${model}`, width)];
}
