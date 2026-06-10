import type { Theme } from "@earendil-works/pi-coding-agent";
import { GLYPH } from "./glyphs.ts";

type HeaderTheme = Pick<Theme, "fg" | "bold">;

/** Strip CR/LF so a header can never break the card frame it sits in. */
function flatten(s: string): string {
  return s.replace(/[\r\n]+/g, " ").trim();
}

export interface HeaderParts {
  icon?: string; // already-colored glyph (e.g. statusIcon(...))
  title: string;
  summary?: string; // muted, after a colon
  badge?: string; // already-colored [badge]
  meta?: string[]; // dim, joined by " · "
}

/** The one card header: `{icon} {bold title}: {muted summary} {badge} {dim · meta}`. */
export function cardHeader(theme: HeaderTheme, p: HeaderParts): string {
  const parts: string[] = [];
  if (p.icon) parts.push(p.icon);
  parts.push(theme.bold(flatten(p.title)));
  let head = parts.join(" ");
  if (p.summary) head += theme.fg("muted", `: ${flatten(p.summary)}`);
  if (p.badge) head += ` ${p.badge}`;
  if (p.meta?.length) head += ` ${theme.fg("dim", `${GLYPH.bullet} ${p.meta.map(flatten).join(` ${GLYPH.bullet} `)}`)}`;
  return head;
}
