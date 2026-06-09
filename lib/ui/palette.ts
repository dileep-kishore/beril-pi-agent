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

export type Domain = "data" | "literature" | "plan" | "analysis" | "governance" | "destructive" | "error" | "neutral";

/** Domain → hex. Cool→warm spread chosen for legible separation on dark terminals. */
const DOMAIN_HEX: Record<Domain, string> = {
  data: "#36c5d0", // cyan — query / peek / discover / env
  literature: "#5f87ff", // blue — lit search / fetch
  plan: "#b08cff", // violet — research plan (no violet exists in the theme keys)
  analysis: "#36c5b0", // teal — notebooks
  governance: "#7cba6f", // green — lifecycle / user / hash
  destructive: "#e8b84b", // amber — export / submit (irreversible)
  error: "#cc6666", // red — failures
  neutral: "#8a929c", // gray — fallback
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
