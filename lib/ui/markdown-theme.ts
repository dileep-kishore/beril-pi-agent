import { type Theme, highlightCode } from "@earendil-works/pi-coding-agent";
import type { MarkdownTheme } from "@earendil-works/pi-tui";

/** The theme styling surface a markdown card needs — a real `Theme` satisfies it. */
export type ThemeStyler = Pick<Theme, "fg" | "bold" | "italic" | "strikethrough" | "underline">;

/**
 * Build a pi-tui `MarkdownTheme` bound to a Pi `Theme` instance.
 *
 * The `Markdown` component (which renders tables, headings, lists, code fences,
 * and blockquotes) needs a `MarkdownTheme` of `(text) => styledText` callbacks.
 * We map each onto the active theme's `md*` tokens so our science cards adopt the
 * user's colour scheme, exactly like Pi's own markdown rendering. Binding to the
 * passed instance (rather than the global singleton) keeps a card correct even in
 * a sub-session that swapped themes.
 */
export function markdownTheme(theme: ThemeStyler): MarkdownTheme {
  return {
    heading: (t) => theme.fg("mdHeading", t),
    link: (t) => theme.fg("mdLink", t),
    linkUrl: (t) => theme.fg("mdLinkUrl", t),
    code: (t) => theme.fg("mdCode", t),
    codeBlock: (t) => theme.fg("mdCodeBlock", t),
    codeBlockBorder: (t) => theme.fg("mdCodeBlockBorder", t),
    quote: (t) => theme.fg("mdQuote", t),
    quoteBorder: (t) => theme.fg("mdQuoteBorder", t),
    hr: (t) => theme.fg("mdHr", t),
    listBullet: (t) => theme.fg("mdListBullet", t),
    bold: (t) => theme.bold(t),
    italic: (t) => theme.italic(t),
    strikethrough: (t) => theme.strikethrough(t),
    underline: (t) => theme.underline(t),
    highlightCode,
  };
}
