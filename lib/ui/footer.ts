import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { contextColor, formatTokens } from "./context-meter.ts";
import { GLYPH } from "./glyphs.ts";

/**
 * The always-visible statusline (a custom `setFooter` component): a single,
 * chevron-grouped segment line in the oh-my-pi idiom — a real status bar, not a
 * keyed-status string:
 *
 *   BERDL off-cluster ✓ › ⌂ beril-pi-agent (main) › ◆ proj ▸ analyze › 3 claims 2✓ 1⊖ › ctx 34% (12.3k/200k) ──── ORCID ✓ · opus-4.8
 *
 * Groups read left→right — environment (connection), location (cwd + git branch),
 * the work (project ▸ phase), the claim tally, and context — joined by a dim ` › `
 * chevron; the researcher chip + model are right-justified by a dim gap rule.
 * Empty groups drop out, and when the line is too narrow the trailing droppable
 * groups are shed so the connection + work always survive. Branch uses Pi's own
 * `(branch)` convention (no special glyph). Pure: takes a theme + the current data
 * and returns the (width-clamped) line; the `beril-env` extension owns the live
 * state and the `setFooter` wiring. Unit-tested with a pass-through theme.
 */

/** The theme surface the footer needs — a real `Theme` satisfies it; tests pass a fake. */
export type FooterTheme = Pick<Theme, "fg">;

export interface FooterData {
  /** Product/skin brand, e.g. BERIL or PHENIX. BERDL is only the connection layer. */
  brand?: string;
  /** Compact connection label without a glyph, e.g. "BERDL off-cluster". */
  connection?: string;
  ready?: boolean;
  /** Working-directory basename, e.g. "beril-pi-agent". */
  cwd?: string;
  /** Git branch of the working dir, e.g. "main"; omitted when detached/unknown. */
  branch?: string;
  project?: string;
  /** Current research phase, e.g. "analyze". */
  phase?: string;
  /** Claim-ledger tally for the active project (omitted when there are no claims). */
  claims?: { total: number; supported: number; refuted: number };
  context?: { tokens: number | null; percent: number | null; contextWindow?: number | null };
  /** Model id. */
  model?: string;
  /** The researcher's ORCID is on file — shows a verified-identity chip by the model. */
  orcid?: boolean;
}

/**
 * The connection chip: a colored connection label + a glyph reflecting readiness.
 * `ready` → `${GLYPH.ok}`/success; present-but-not-ready (`!ready`) →
 * `${GLYPH.warn}`/warning (a caution, not an operational failure).
 */
export function connectionChip(theme: FooterTheme, connection: string, ready: boolean): string {
  const mark = ready ? GLYPH.ok : GLYPH.warn;
  return theme.fg(ready ? "success" : "warning", `${connection} ${mark}`);
}

/** The location group: `⌂ cwd` plus the git branch in Pi's `(branch)` convention. All dim. */
function locationSegment(theme: FooterTheme, cwd: string, branch?: string): string {
  return theme.fg("dim", `${GLYPH.folder} ${cwd}${branch ? ` (${branch})` : ""}`);
}

/** The claim tally: `3 claims 2✓ 1⊖` — count muted, supported green, refuted red. */
function claimsSegment(theme: FooterTheme, c: NonNullable<FooterData["claims"]>): string {
  const noun = c.total === 1 ? "claim" : "claims";
  const sup = c.supported > 0 ? ` ${theme.fg("success", `${c.supported}${GLYPH.ok}`)}` : "";
  const ref = c.refuted > 0 ? ` ${theme.fg("error", `${c.refuted}${GLYPH.refutes}`)}` : "";
  return `${theme.fg("muted", `${c.total} ${noun}`)}${sup}${ref}`;
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

  // The work group (project ▸ phase) survives shedding alongside the connection.
  const where: string[] = [];
  if (d.project) where.push(theme.fg("accent", `${GLYPH.project} ${d.project}`));
  if (d.phase) where.push(theme.fg("accent", `${GLYPH.here} ${d.phase}`));

  const groups: { text: string; keep: boolean }[] = [];
  if (d.brand) groups.push({ text: theme.fg("accent", d.brand), keep: true });
  if (d.connection) groups.push({ text: connectionChip(theme, d.connection, d.ready ?? false), keep: true });
  if (d.cwd) groups.push({ text: locationSegment(theme, d.cwd, d.branch), keep: false });
  if (where.length) groups.push({ text: where.join(" "), keep: true });
  if (d.claims && d.claims.total > 0) groups.push({ text: claimsSegment(theme, d.claims), keep: false });
  if (d.context) groups.push({ text: contextSegment(theme, d.context), keep: false });

  // Right side, gap-justified: a verified-ORCID chip then the model.
  const rightParts: string[] = [];
  if (d.orcid) rightParts.push(theme.fg("success", `ORCID ${GLYPH.ok}`));
  if (d.model) rightParts.push(theme.fg("dim", d.model));
  const right = rightParts.join(theme.fg("dim", ` ${GLYPH.bullet} `));
  if (!groups.length && !right) return [];

  // Shed droppable groups from the right until the line (left groups + right side)
  // fits; required groups (connection, work) stay even if they then truncate.
  let shown = groups;
  const fits = (gs: { text: string }[]): boolean => {
    const left = gs.map((g) => g.text).join(chevron);
    const need = right ? visibleWidth(left) + visibleWidth(right) + 3 : visibleWidth(left);
    return need <= width;
  };
  while (!fits(shown) && shown.some((g) => !g.keep)) {
    const lastDroppable = shown.map((g) => g.keep).lastIndexOf(false);
    shown = shown.filter((_, i) => i !== lastDroppable);
  }

  const left = shown.map((g) => g.text).join(chevron);
  if (!right) return [truncateToWidth(left, width)];

  const gap = width - visibleWidth(left) - visibleWidth(right) - 2;
  if (gap >= 1) {
    // Gap-rule right-justify: left groups, a dim rule, then the right side.
    return [`${left} ${theme.fg("dim", "─".repeat(gap))} ${right}`];
  }
  // Too narrow for a rule — chevron-join the right side and clamp.
  return [truncateToWidth(`${left}${chevron}${right}`, width)];
}
