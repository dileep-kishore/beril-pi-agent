import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { type Component, Markdown, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { markdownTheme } from "./markdown-theme.ts";
import type { CardState } from "./render-utils.ts";

/**
 * Titled, rounded-border "cards" — the visual vocabulary for science artifacts
 * (data, literature, plans, findings). pi-tui has no border or layout primitive,
 * so we draw the frame by hand with box-drawing characters and `visibleWidth`-
 * aware padding (the proven `overlay-test.ts` pattern), then either frame
 * pre-styled text lines or a `Markdown` body rendered to the inner width.
 *
 * `frameCard` is pure (each returned line is exactly `width` visible columns, so
 * the TUI never errors) and is the unit-tested core; `linesCard` / `markdownCard`
 * wrap it in a `Component` for use from a tool `renderResult`.
 */

/** Re-export so existing `card.ts` consumers keep a single import site for the type. */
export type { CardState };

/** State → border/title paint token, used only when no explicit accent is given. */
const stateAccent: Record<CardState, ThemeColor> = {
  running: "borderAccent",
  pending: "borderAccent",
  error: "error",
  warning: "warning",
  success: "borderMuted",
  settled: "borderMuted",
};

const MIN_WIDTH = 12;
const RESET = "\x1b[0m";

/** Theme surface a card needs — a `Theme` satisfies it; tests pass a fake. */
export type CardTheme = Pick<Theme, "fg" | "bold">;

/** A labeled (or unlabeled) group of pre-styled lines rendered below the body. */
export interface CardSection {
  label?: string;
  lines: string[];
}

export interface CardOptions {
  title: string;
  /** Pre-styled body lines (may contain ANSI); each should already fit the inner width. */
  body: string[];
  /** Border + title colour token. Default "borderAccent". */
  accent?: ThemeColor;
  /**
   * Override border + title colouring with a custom styler (e.g. a per-domain
   * hex from `palette.ts`). Takes precedence over `accent` when present, so each
   * science domain can carry its own frame colour beyond the fixed theme keys.
   */
  accentStyle?: (s: string) => string;
  /**
   * Lifecycle/result state. When neither `accent` nor `accentStyle` is set, it
   * selects the border colour via `stateAccent` (errors/warnings pop; routine
   * results recede via `borderMuted`).
   */
  state?: CardState;
  /** Labeled groups rendered below `body`; each adds a divider then its lines. */
  sections?: CardSection[];
  /** Dim text shown after the title on the top bar (e.g. "3 rows"). */
  headerMeta?: string;
  /** Cap body lines; excess collapses into a muted "… N more line(s)" footer. */
  maxBodyLines?: number;
}

function padTo(line: string, width: number): string {
  const vis = visibleWidth(line);
  if (vis > width) return truncateToWidth(line, width);
  return `${line}${" ".repeat(width - vis)}`;
}

/**
 * A section divider row, exactly `w` visible columns. With a label:
 * `├─ {label} ─…─┤`; without: `├{─×(w-2)}┤`. `paint` styles the whole row.
 */
export function sectionDivider(paint: (s: string) => string, label: string | undefined, w: number): string {
  if (!label) return paint(`├${"─".repeat(Math.max(0, w - 2))}┤`);
  // `├─ ` + label + ` ` + dashes + `┤` must total `w` visible columns.
  const text = truncateToWidth(label, Math.max(1, w - 6));
  const dashes = Math.max(1, w - 5 - visibleWidth(text));
  return paint(`├─ ${text} ${"─".repeat(dashes)}┤`);
}

/** Frame pre-rendered body lines as a titled card. Pure; lines are exactly `width` wide. */
export function frameCard(theme: CardTheme, opts: CardOptions, width: number): string[] {
  // State drives the border only when no explicit accent/styler is supplied,
  // so existing callers (and `accent`/`accentStyle`) keep today's behaviour.
  const accent =
    opts.accent ?? (opts.accentStyle == null && opts.state != null ? stateAccent[opts.state] : "borderAccent");
  // `paint` styles the border + title: a custom per-domain styler when given,
  // else the theme accent token. `accentStyle` resets fg only, so `bold` composes.
  const paint = opts.accentStyle ?? ((s: string) => theme.fg(accent, s));
  const w = Math.max(MIN_WIDTH, Math.floor(width));
  const inner = w - 4; // 1 border + 1 pad on each side

  // Truncate the title so at least one filler dash remains on the top border.
  // When `headerMeta` is set, it follows the title (dim) with two leading spaces.
  const meta = opts.headerMeta?.length ? truncateToWidth(opts.headerMeta, Math.max(1, w - 9)) : "";
  const metaCols = meta ? visibleWidth(meta) + 2 : 0; // "  " before the meta
  const title = truncateToWidth(opts.title, Math.max(1, w - 6 - metaCols));
  const titleLen = visibleWidth(title);
  const dashes = Math.max(1, w - 5 - titleLen - metaCols);
  const head = meta ? `${theme.bold(paint(title))}${paint("  ")}${theme.fg("dim", meta)}` : theme.bold(paint(title));
  const top = `${paint("╭─ ")}${head}${paint(` ${"─".repeat(dashes)}╮`)}`;
  const bottom = paint(`╰${"─".repeat(w - 2)}╯`);

  let body = opts.body;
  if (opts.maxBodyLines != null && body.length > opts.maxBodyLines) {
    const shown = Math.max(1, opts.maxBodyLines - 1);
    const note = theme.fg("muted", `… ${body.length - shown} more line(s) · Ctrl+O to expand`);
    body = [...body.slice(0, shown), note];
  }

  const bar = paint("│");
  const bodyLine = (line: string): string => `${bar} ${padTo(line, inner)}${RESET} ${bar}`;
  const rows = body.map(bodyLine);

  for (const section of opts.sections ?? []) {
    // A divider precedes a section unless it is the very first row AND unlabeled
    // (a labeled first section still gets its `├─ label ─┤` header row).
    if (rows.length > 0 || section.label) rows.push(sectionDivider(paint, section.label, w));
    for (const line of section.lines) rows.push(bodyLine(line));
  }

  return [top, ...rows, bottom];
}

interface CardComponentSpec {
  title: string;
  accent?: ThemeColor;
  accentStyle?: (s: string) => string;
  state?: CardState;
  headerMeta?: string;
  maxBodyLines?: number;
  /** Produce the (pre-styled) body lines for a given inner width. */
  getBody: (innerWidth: number) => string[];
  /** Produce labeled sections for a given inner width. */
  getSections?: (innerWidth: number) => CardSection[];
}

function cardComponent(theme: Theme, spec: CardComponentSpec): Component {
  let cache: { width: number; lines: string[] } | undefined;
  return {
    render(width: number): string[] {
      if (cache && cache.width === width) return cache.lines;
      const inner = Math.max(MIN_WIDTH, Math.floor(width)) - 4;
      const lines = frameCard(
        theme,
        {
          title: spec.title,
          accent: spec.accent,
          accentStyle: spec.accentStyle,
          state: spec.state,
          headerMeta: spec.headerMeta,
          body: spec.getBody(inner),
          sections: spec.getSections?.(inner),
          maxBodyLines: spec.maxBodyLines,
        },
        width,
      );
      cache = { width, lines };
      return lines;
    },
    invalidate(): void {
      cache = undefined;
    },
  };
}

/** A card whose body is a list of already-styled text lines. */
export function linesCard(
  theme: Theme,
  opts: {
    title: string;
    lines: string[];
    accent?: ThemeColor;
    accentStyle?: (s: string) => string;
    state?: CardState;
    sections?: CardSection[];
    headerMeta?: string;
    maxBodyLines?: number;
  },
): Component {
  return cardComponent(theme, {
    title: opts.title,
    accent: opts.accent,
    accentStyle: opts.accentStyle,
    state: opts.state,
    headerMeta: opts.headerMeta,
    maxBodyLines: opts.maxBodyLines,
    getBody: () => opts.lines,
    getSections: opts.sections ? () => opts.sections ?? [] : undefined,
  });
}

/**
 * A card whose body is plain text, hard-wrapped to the inner width and shown
 * verbatim. Unlike `markdownCard`, nothing is interpreted — so SQL, identifiers
 * with underscores, and stderr render exactly as written (and it needs no
 * initialised theme for syntax highlighting). Used for error cards.
 */
export function textCard(
  theme: Theme,
  opts: {
    title: string;
    text: string;
    accent?: ThemeColor;
    accentStyle?: (s: string) => string;
    state?: CardState;
    headerMeta?: string;
    maxBodyLines?: number;
    /** Per-line styler for the wrapped body (default: theme "text"). */
    style?: (s: string) => string;
  },
): Component {
  const style = opts.style ?? ((s: string) => theme.fg("text", s));
  return cardComponent(theme, {
    title: opts.title,
    accent: opts.accent,
    accentStyle: opts.accentStyle,
    state: opts.state,
    headerMeta: opts.headerMeta,
    maxBodyLines: opts.maxBodyLines,
    getBody: (inner) => (opts.text.length ? wrapTextWithAnsi(opts.text, inner) : [""]).map(style),
  });
}

/** A card whose body is markdown, rendered by pi-tui's `Markdown` to the inner width. */
export function markdownCard(
  theme: Theme,
  opts: {
    title: string;
    markdown: string;
    accent?: ThemeColor;
    accentStyle?: (s: string) => string;
    state?: CardState;
    headerMeta?: string;
    maxBodyLines?: number;
  },
): Component {
  const mdTheme = markdownTheme(theme);
  return cardComponent(theme, {
    title: opts.title,
    accent: opts.accent,
    accentStyle: opts.accentStyle,
    state: opts.state,
    headerMeta: opts.headerMeta,
    maxBodyLines: opts.maxBodyLines,
    getBody: (inner) => new Markdown(opts.markdown, 0, 0, mdTheme).render(inner),
  });
}

/**
 * Build a card from a `CardOptions` produced for the inner content width — the
 * general escape hatch when a caller wants `sections`/`state`/`headerMeta`
 * together with width-aware body construction.
 */
export function framedBlock(theme: Theme, build: (innerWidth: number) => CardOptions): Component {
  let cache: { width: number; lines: string[] } | undefined;
  return {
    render(width: number): string[] {
      if (cache && cache.width === width) return cache.lines;
      const inner = Math.max(MIN_WIDTH, Math.floor(width)) - 4;
      const lines = frameCard(theme, build(inner), width);
      cache = { width, lines };
      return lines;
    },
    invalidate(): void {
      cache = undefined;
    },
  };
}
