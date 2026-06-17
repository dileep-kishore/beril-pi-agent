import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { markdownCard } from "./card.ts";
import { GLYPH } from "./glyphs.ts";
import { domainStyle } from "./palette.ts";
import { cardHeader } from "./status-line-header.ts";

export function capabilitiesCard(theme: Theme, markdown: string): Component {
  return markdownCard(theme, {
    title: cardHeader(theme, { title: `Capabilities ${GLYPH.bullet} BERIL co-scientist` }),
    accentStyle: domainStyle(theme, "governance"),
    state: "settled",
    markdown,
    maxBodyLines: 80,
  });
}
