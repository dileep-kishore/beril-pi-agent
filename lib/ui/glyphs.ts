/**
 * One status-glyph legend, shared by cards, the HUD, and the footer.
 *
 * A single, deliberately small vocabulary of plain text-presentation Unicode —
 * NO Nerd-Font glyphs, ligatures, or emoji-presentation characters, so it renders
 * identically in any monospace font without a special/emoji font (`✓`/`✗`/`△`
 * deliberately avoid the emoji-capable `✔`/`✘`/`⚠`, which some terminals colour
 * and double-width). `✓`/`✗`/`△` carry the operational axis, `⊕`/`⊖` pair as the
 * supports/refutes twins, and the chevron `›` groups the statusline. Centralising
 * them keeps the meaning stable, and the ASCII tier mirrors each one for
 * NO_COLOR / non-UTF terminals.
 */
export const GLYPH = {
  /** Operational success — a task/check that ran and passed. */
  ok: "✓",
  /** Operational failure — a task/check that ran and failed. */
  bad: "✗",
  /** A caution / not-fully-ready state. */
  warn: "△",
  /** A pending / not-yet-done state. */
  pending: "○",
  /** Work currently underway. */
  inProgress: "◐",
  /** A newly-created item. */
  add: "+",
  /** A neutral separator (separator only — no operational meaning). */
  bullet: "·",
  /** A statusline group separator (chevron). */
  chevron: "›",
  /** Sequence/flow between steps. */
  arrow: "→",
  /** "you are here" — the current step/phase. */
  here: "▸",
  /** A project. */
  project: "◆",
  /** Submitted / promoted upward. */
  up: "↑",
  /** Working directory / location. */
  folder: "⌂",
  /** A filled gauge cell (context meter). */
  gaugeFull: "▰",
  /** An empty gauge cell (context meter). */
  gaugeEmpty: "▱",
  /** Evidence that supports a claim. */
  supports: "⊕",
  /** Evidence that refutes a claim (the twin of `supports`). */
  refutes: "⊖",
  /** A claim with insufficient/unresolved evidence. */
  unresolved: "◌",
  /** A low confidence meter cell. */
  meterLow: "◔",
  /** A half confidence meter cell. */
  meterHalf: "◑",
  /** A full confidence meter cell. */
  meterFull: "●",
  /** Needs replication. */
  replicate: "↻",
  /** Blocked / cannot proceed. */
  blocked: "⊘",
  /** A checkpoint. */
  checkpoint: "◈",
  /** Evidence kind: query. */
  kindQuery: "▤",
  /** Evidence kind: notebook. */
  kindNotebook: "▦",
  /** Evidence kind: figure. */
  kindFigure: "▣",
  /** Evidence kind: paper. */
  kindPaper: "¶",
} as const;

export type GlyphTier = "unicode" | "ascii";

const ASCII: Record<keyof typeof GLYPH, string> = {
  ok: "[ok]",
  bad: "[x]",
  warn: "[!]",
  pending: "[ ]",
  inProgress: "[.]",
  add: "+",
  bullet: "-",
  chevron: ">",
  arrow: "->",
  here: ">",
  project: "#",
  up: "^",
  folder: "~",
  gaugeFull: "#",
  gaugeEmpty: "-",
  supports: "(+)",
  refutes: "(-)",
  unresolved: "(?)",
  meterLow: ".",
  meterHalf: "o",
  meterFull: "O",
  replicate: "@",
  blocked: "(/)",
  checkpoint: "<>",
  kindQuery: "[q]",
  kindNotebook: "[nb]",
  kindFigure: "[fig]",
  kindPaper: "[doc]",
};

/** Active glyph tier: ascii when NO_COLOR or a non-UTF locale is detected, else unicode. */
export function glyphTier(): GlyphTier {
  if (process.env.BERIL_GLYPHS === "ascii") return "ascii";
  if (process.env.NO_COLOR) return "ascii";
  const enc = `${process.env.LC_ALL ?? process.env.LC_CTYPE ?? process.env.LANG ?? ""}`.toLowerCase();
  return enc && !enc.includes("utf") ? "ascii" : "unicode";
}

/** Resolve a glyph by key for the active tier. */
export function glyph(name: keyof typeof GLYPH): string {
  return glyphTier() === "ascii" ? ASCII[name] : GLYPH[name];
}
