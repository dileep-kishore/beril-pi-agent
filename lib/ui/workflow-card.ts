import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import type { WorkflowView } from "../workflow.ts";
import { linesCard } from "./card.ts";
import { GLYPH } from "./glyphs.ts";
import { domainStyle } from "./palette.ts";
import { cardHeader } from "./status-line-header.ts";

/** Render a deterministic workflow-orientation card for /whereami and /next. */
export function workflowStatusCard(theme: Theme, view: WorkflowView, focus: "whereami" | "next"): Component {
  const lines: string[] = [];
  const v = (s?: string) => theme.fg(s ? "text" : "muted", s || "(none)");
  lines.push(`${theme.fg("muted", "Project     ")}${v(view.project)}`);
  lines.push(`${theme.fg("muted", "Lifecycle   ")}${v(view.status)}`);
  lines.push(`${theme.fg("muted", "Phase       ")}${v(view.phase)}`);
  if (view.env) {
    const mark = view.env.ready ? theme.fg("success", GLYPH.ok) : theme.fg("warning", GLYPH.warn);
    lines.push(`${theme.fg("muted", "BERDL       ")}${theme.fg("text", view.env.location)} ${mark}`);
  } else {
    lines.push(`${theme.fg("muted", "BERDL       ")}${theme.fg("dim", "not checked in this session — /berdl-status")}`);
  }
  if (view.claims) {
    lines.push(
      `${theme.fg("muted", "Claims      ")}${theme.fg("text", String(view.claims.total))} ${theme.fg("dim", "total")}  ${theme.fg("success", `${view.claims.supported}${GLYPH.ok}`)}  ${theme.fg("warning", `${view.claims.refuted}${GLYPH.refutes}`)}`,
    );
  }
  if (view.lastCheckpoint) {
    lines.push(`${theme.fg("muted", "Checkpoint  ")}${theme.fg("text", view.lastCheckpoint)}`);
  }
  lines.push("");
  lines.push(`${theme.fg("muted", "Next        ")}${theme.fg("text", view.next)}`);
  lines.push(`${theme.fg("muted", "Command     ")}${theme.bold(theme.fg("accent", view.command))}`);
  if (view.updatedAt) lines.push(theme.fg("dim", `research_state updated ${view.updatedAt}`));

  return linesCard(theme, {
    title: cardHeader(theme, { title: focus === "next" ? "Next step" : "Where am I?" }),
    accentStyle: domainStyle(theme, "governance"),
    state: view.project ? "settled" : "warning",
    lines,
    maxBodyLines: 18,
  });
}
