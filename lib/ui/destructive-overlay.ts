import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Key,
  type KeybindingsManager,
  type TUI,
  matchesKey,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { frameCard } from "./card.ts";
import { GLYPH } from "./glyphs.ts";
import { domainStyle } from "./palette.ts";

function scalarLines(input: Record<string, unknown>): string[] {
  return Object.entries(input)
    .filter(([, value]) => value == null || typeof value !== "object")
    .slice(0, 6)
    .map(([key, value]) => `${key}: ${value == null ? "—" : String(value)}`);
}

export function destructiveSummary(toolName: string, input: Record<string, unknown>): string[] {
  const details = scalarLines(input);
  return [`Tool: ${toolName}`, "Impact: irreversible remote or credential-sensitive operation", ...details];
}

export function buildDestructiveOverlay(
  toolName: string,
  input: Record<string, unknown>,
  theme: Theme,
  done: (ok: boolean) => void,
): Component {
  let cursor = 0;
  let cache: { width: number; lines: string[] } | undefined;
  const options = ["Block", "Allow"];
  const accentStyle = domainStyle(theme, "destructive");

  function body(inner: number): string[] {
    const lines: string[] = [];
    for (const line of destructiveSummary(toolName, input)) {
      for (const wrapped of wrapTextWithAnsi(line, inner)) lines.push(theme.fg("text", wrapped));
    }
    lines.push("");
    lines.push(theme.fg("warning", "Only allow this if the target and consequence are correct."));
    lines.push("");
    options.forEach((option, index) => {
      const focused = index === cursor;
      const prefix = focused ? accentStyle(GLYPH.here) : theme.fg("muted", " ");
      const label = option === "Allow" ? theme.fg("warning", option) : theme.fg("text", option);
      lines.push(`${prefix} ${focused ? theme.bold(label) : label}`);
    });
    lines.push("", theme.fg("dim", `up/down move ${GLYPH.bullet} enter choose ${GLYPH.bullet} esc block`));
    return lines;
  }

  return {
    render(width: number): string[] {
      if (cache?.width === width) return cache.lines;
      const inner = Math.max(8, Math.floor(width)) - 4;
      const lines = frameCard(
        theme,
        {
          title: `${GLYPH.warn} Destructive action`,
          body: body(inner),
          accentStyle,
        },
        width,
      );
      cache = { width, lines };
      return lines;
    },
    handleInput(data: string): void {
      if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
        cursor = cursor === 0 ? 1 : 0;
        cache = undefined;
        return;
      }
      if (matchesKey(data, Key.enter)) {
        done(options[cursor] === "Allow");
        return;
      }
      if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) done(false);
    },
    invalidate(): void {
      cache = undefined;
    },
  };
}

export function makeDestructiveOverlay(toolName: string, input: Record<string, unknown>) {
  return (_tui: TUI, theme: Theme, _kb: KeybindingsManager, done: (ok: boolean) => void): Component =>
    buildDestructiveOverlay(toolName, input, theme, done);
}
