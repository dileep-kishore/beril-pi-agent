import type { Theme } from "@earendil-works/pi-coding-agent";
import { RESEARCH_STEPS, stepIndex } from "../research-steps.ts";
import { frameCard } from "./card.ts";
import { GLYPH } from "./glyphs.ts";

/**
 * The first-launch welcome panel (a `setHeader` component, cleared on first
 * input). A boxed, branded orientation: who you are, whether BERDL is connected,
 * the research arc with the current step marked, how to begin, and a rotating
 * tip. It answers the first-timer's "what is this and how do I start" that the
 * bare Pi banner left unanswered. Pure: reuses `frameCard`, so each line is
 * exactly `width` columns; the `beril-env` extension owns the state + wiring.
 */

export type WelcomeTheme = Pick<Theme, "fg" | "bold">;

export interface WelcomeState {
  /** Compact connection label without a glyph, e.g. "BERDL off-cluster". */
  connection?: string;
  ready?: boolean;
  researcher?: string;
  orcidOk?: boolean;
  /** Active project's lifecycle state, to mark the current arc step. */
  state?: string;
  /** The tip to show (caller rotates it per session). */
  tip?: string;
}

/** Rotating getting-started tips — one BERDL/co-scientist feature per line. */
export const TIPS: readonly string[] = [
  "berdl_peek previews a table's columns and a few rows before you query it.",
  "Ask a research question in plain language — it maps to the available data.",
  "Checkpoints pause at natural seams so you steer the science, not the commands.",
  "/literature-review <topic> pulls and synthesizes the relevant papers.",
  "/research-plan turns an explored question into a concrete, reviewable plan.",
  "Every result is a card — the underlying data and code are one step away.",
];

/** Deterministic tip pick (caller supplies a per-session index). */
export function pickTip(index: number): string {
  const n = TIPS.length;
  return TIPS[((index % n) + n) % n];
}

function arcLine(theme: WelcomeTheme, state: string | undefined): string {
  const idx = state ? stepIndex(state) : -1;
  const sep = theme.fg("dim", ` ${GLYPH.arrow} `);
  return RESEARCH_STEPS.map((step, i) => {
    if (idx === RESEARCH_STEPS.length) return theme.fg("dim", step);
    if (i === idx) return theme.bold(theme.fg("accent", `${GLYPH.here} ${step}`));
    if (idx >= 0 && i < idx) return theme.fg("dim", step);
    return theme.fg("muted", step);
  }).join(sep);
}

function row(theme: WelcomeTheme, label: string, value: string): string {
  return `${theme.fg("muted", label.padEnd(12))}${value}`;
}

/** Build the welcome panel as framed lines (each exactly `width` columns). */
export function welcomePanel(theme: WelcomeTheme, s: WelcomeState, width: number): string[] {
  const conn = s.connection
    ? theme.fg(s.ready ? "success" : "warning", `${s.connection} ${s.ready ? GLYPH.ok : GLYPH.bad}`)
    : theme.fg("muted", "not connected — /berdl-connect");
  const who = s.researcher
    ? `${theme.fg("text", s.researcher)}${
        s.orcidOk
          ? theme.fg("dim", `  ${GLYPH.bullet}  ORCID ${GLYPH.ok}`)
          : theme.fg("warning", `  ${GLYPH.bullet}  ORCID —`)
      }`
    : theme.fg("muted", "run `beril setup` to set your identity");
  const start = `${theme.fg("accent", "/berdl-start")}${theme.fg("dim", `  ${GLYPH.bullet}  or ask a research question`)}`;
  const tip = theme.fg("dim", s.tip ?? pickTip(0));

  const body = [
    "",
    row(theme, "Connection", conn),
    row(theme, "Researcher", who),
    "",
    row(theme, "The arc", arcLine(theme, s.state)),
    "",
    row(theme, "Start", start),
    row(theme, "Tip", tip),
    "",
  ];
  return frameCard(theme, { title: "beril · BERDL research co-scientist", body }, width);
}
