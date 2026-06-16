import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { markdownCard } from "./card.ts";
import { GLYPH } from "./glyphs.ts";
import { domainStyle } from "./palette.ts";

/**
 * Science checkpoints — the visible decision seams where the scientist steers.
 *
 * The conduct contract asks the agent to pause at natural seams (after the plan,
 * after the first result); `request_checkpoint` turns that into an explicit,
 * recorded decision. This module holds the default choices and the card that
 * records the question + the scientist's answer.
 */
export const DEFAULT_CHECKPOINT_OPTIONS = ["Approve and continue", "Adjust the approach", "Stop here"];

export interface CheckpointResult {
  title: string;
  summary?: string;
  choice: string;
  /** The individual choices when more than one was selected (typed multi-select). */
  choices?: string[];
}

/** A card recording a checkpoint question and the scientist's decision(s). */
export function checkpointCard(theme: Theme, d: CheckpointResult): Component {
  // One decision → a `**Decision:**` line; several (multi-select) → a `**Decisions:**` bullet list.
  const decision =
    d.choices && d.choices.length > 1
      ? `**Decisions:**\n${d.choices.map((c) => `- ${c}`).join("\n")}`
      : `**Decision:** ${d.choice}`;
  const body = `${d.summary ? `${d.summary}\n\n` : ""}${decision}`;
  return markdownCard(theme, {
    title: `${GLYPH.checkpoint} Checkpoint · ${d.title}`,
    markdown: body,
    accentStyle: domainStyle(theme, "checkpoint"),
  });
}
