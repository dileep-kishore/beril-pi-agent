/**
 * Per-domain accent colours for the science cards.
 *
 * Pi's theme `colors` map is `additionalProperties:false`, so we cannot add new
 * `ThemeColor` keys (e.g. a "plan violet"), and `Theme.fg` only accepts the
 * fixed key set with no arbitrary-hex escape hatch. To give each research domain
 * its own frame colour — so a literature card no longer reads identical to a
 * data card — we own a small hex palette here and emit the ANSI ourselves,
 * downgrading to the 256-colour cube when the terminal isn't truecolor (the same
 * gate Pi uses via `theme.getColorMode()`). The card body still adopts the
 * user's theme via `markdownTheme`; only the frame/title carry the domain hue.
 */

/** The colour surface palette needs from a `Theme` — the real `Theme` satisfies it. */
export interface ColorModeTheme {
  getColorMode(): "truecolor" | "256color";
}

export type Domain =
  | "data"
  | "literature"
  | "plan"
  | "analysis"
  | "governance"
  | "destructive"
  | "checkpoint"
  | "error"
  | "neutral";

/**
 * Domain → hex, drawn from the same beryl palette as `themes/beril.json` `vars`
 * so a domain accent never drifts from the active theme. Since the card frame now
 * recedes to a dim border (see `card.ts`), this hue tints only the card *title*,
 * so a literature title still reads distinct from a data title without painting a
 * rainbow of frames. One green (`governance`/`supports`) and one red
 * (`error`/`refutes`) — no near-duplicates.
 */
const DOMAIN_HEX: Record<Domain, string> = {
  data: "#34d6c4", // aqua — query / peek / discover / env
  literature: "#6bb6e8", // blue — lit search / fetch
  plan: "#a99bf2", // violet — research plan
  analysis: "#1f9c90", // deep aqua — notebooks (same family as data, one shade down)
  governance: "#5ec98b", // green — lifecycle / user / hash
  destructive: "#e0a13f", // amber — export / submit (irreversible)
  checkpoint: "#a99bf2", // violet — checkpoint (distinguished from plan by glyph/title)
  error: "#e76b7a", // red — failures
  neutral: "#929ba4", // gray — fallback
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, "");
  return [Number.parseInt(h.slice(0, 2), 16), Number.parseInt(h.slice(2, 4), 16), Number.parseInt(h.slice(4, 6), 16)];
}

/** Map an RGB triple to the nearest xterm-256 index (6×6×6 cube + grayscale ramp). */
function rgbTo256(r: number, g: number, b: number): number {
  // Clamp to 0..5: round((255-35)/40) is 6, one past the cube, which would emit an
  // out-of-range `38;5;>255` escape for any 0xff channel.
  const toCube = (v: number) => (v < 48 ? 0 : v < 115 ? 1 : Math.min(5, Math.round((v - 35) / 40)));
  const ci = 16 + 36 * toCube(r) + 6 * toCube(g) + toCube(b);
  // Prefer the grayscale ramp when the colour is near-neutral and closer there.
  const avg = (r + g + b) / 3;
  if (Math.abs(r - avg) < 12 && Math.abs(g - avg) < 12 && Math.abs(b - avg) < 12) {
    const gray = Math.min(23, Math.max(0, Math.round((avg - 8) / 10)));
    return 232 + gray;
  }
  return ci;
}

/** ANSI foreground for an arbitrary hex, truecolor or 256-downgraded, self-resetting (fg only). */
export function hexFg(theme: ColorModeTheme, hex: string, text: string): string {
  const [r, g, b] = hexToRgb(hex);
  const open = theme.getColorMode() === "256color" ? `\x1b[38;5;${rgbTo256(r, g, b)}m` : `\x1b[38;2;${r};${g};${b}m`;
  return `${open}${text}\x1b[39m`;
}

/** The hex for a domain (falls back to neutral). */
export function domainHex(domain: Domain): string {
  return DOMAIN_HEX[domain] ?? DOMAIN_HEX.neutral;
}

/** A styler `(s) => coloured s` for a domain — pass as a card's `accentStyle`. */
export function domainStyle(theme: ColorModeTheme, domain: Domain): (s: string) => string {
  const hex = domainHex(domain);
  return (s: string) => hexFg(theme, hex, s);
}

export type Role = "supports" | "refutes" | "unresolved" | "confHigh" | "confMedium" | "confLow" | "info";

const ROLE_HEX: Record<Role, string> = {
  supports: "#5ec98b", // the one green (== theme success / governance)
  refutes: "#e76b7a", // the one red (== theme error)
  unresolved: "#929ba4",
  confHigh: "#d4dbe1",
  confMedium: "#929ba4",
  confLow: "#69727c",
  info: "#6bb6e8",
};

/** Hand-pinned xterm-256 indices for the colorblind-critical roles so they never
 *  drift under quantization (the lipgloss CompleteColor pattern). */
const ROLE_256: Partial<Record<Role, number>> = {
  supports: 78, // green
  refutes: 174, // coral-red
  info: 74, // blue
};

/** ANSI fg for a role, truecolor or 256-pinned, fg-only reset. */
export function roleStyle(theme: ColorModeTheme, role: Role): (s: string) => string {
  const hex = ROLE_HEX[role];
  const pinned = ROLE_256[role];
  return (s: string) => {
    if (pinned != null && theme.getColorMode() === "256color") return `\x1b[38;5;${pinned}m${s}\x1b[39m`;
    return hexFg(theme, hex, s);
  };
}
