/**
 * OSC-8 terminal hyperlinks — make BERDL table references and PMIDs clickable
 * in cards without changing the visible text.
 *
 * An OSC-8 link is `ESC ] 8 ; ; <url> BEL <text> ESC ] 8 ; ; BEL`. Terminals
 * that don't understand the sequence still print `<text>` (the escape is
 * swallowed), but we additionally gate on a coarse capability check so plain
 * pipes / `TERM=dumb` / `NO_COLOR` get clean output. Pure (env is injectable).
 */

const OSC8_OPEN = "\x1b]8;;";
const BEL = "\x07";

/** Coarse "does this terminal render OSC-8 links" check. Conservative: off when unsure. */
export function supportsHyperlinks(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NO_COLOR) return false;
  const term = env.TERM ?? "";
  if (term === "" || term === "dumb") return false;
  return true;
}

/**
 * Wrap `text` in an OSC-8 hyperlink to `url`. Returns `text` unchanged when the
 * url is empty or the terminal can't render links (so callers can wrap freely).
 */
export function hyperlink(text: string, url: string | undefined, env?: NodeJS.ProcessEnv): string {
  if (!url || !supportsHyperlinks(env)) return text;
  return `${OSC8_OPEN}${url}${BEL}${text}${OSC8_OPEN}${BEL}`;
}
