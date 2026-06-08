/**
 * One status-glyph legend, shared by cards, the HUD, and the footer.
 *
 * The science cards had each grown their own marks (`✓`/`✗`/`○`/`+`/`·`/`↑`)
 * with overlapping meaning; centralising them here keeps the visual vocabulary
 * consistent so a `✓` means the same thing everywhere it appears.
 */
export const GLYPH = {
  /** A satisfied/ready/success state. */
  ok: "✓",
  /** A failed/not-ready state. */
  bad: "✗",
  /** A pending / not-yet-done state. */
  pending: "○",
  /** A newly-created item. */
  add: "+",
  /** A neutral separator bullet. */
  bullet: "·",
  /** Sequence/flow between steps. */
  arrow: "→",
  /** "you are here" — the current step/phase. */
  here: "▸",
  /** A project. */
  project: "▣",
  /** Submitted / promoted upward. */
  up: "↑",
  /** Working directory / location. */
  folder: "📁",
  /** A filled gauge cell (context meter). */
  gaugeFull: "▰",
  /** An empty gauge cell (context meter). */
  gaugeEmpty: "▱",
} as const;
