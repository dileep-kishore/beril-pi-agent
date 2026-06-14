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
import { DEFAULT_CHECKPOINT_OPTIONS } from "./checkpoint.ts";
import { glyph } from "./glyphs.ts";
import { domainStyle } from "./palette.ts";

/**
 * The typed-checkpoint overlay — the repo's first interactive focusable
 * `Component`, shown via `ctx.ui.custom`.
 *
 * `request_checkpoint` puts a science-direction decision in front of the
 * scientist. pi-tui 0.79.1 ships only a single-select `SelectList` (no per-option
 * rationale, no preview pane, no multi-select), so the overlay is a small
 * hand-built `Component` on `frameCard` + `Key`/`matchesKey`: an option list (each
 * with an optional dim rationale), a preview pane re-derived from the cursor every
 * render, and single- OR multi-select. It returns the chosen label(s) to the model
 * exactly as the old `ctx.ui.select` did — nothing in a core path, zero new deps.
 *
 * The pure parts (`normalizeOptions`, `buildOverlay`'s key/state logic) are
 * unit-tested by driving `handleInput` with `Key` events and asserting the `done`
 * payload; the interactive redraw cannot be exercised headlessly.
 */

/** One choice offered at a checkpoint: a label plus optional why-pick + longer preview. */
export interface CheckpointOpt {
  label: string;
  /** One-line "why pick this", shown dim under the label. */
  rationale?: string;
  /** Longer preview text, shown in the pane below the list for the focused option. */
  preview?: string;
}

/** What the overlay resolves with: the selected label(s) (empty when dismissed). */
export interface CheckpointPick {
  labels: string[];
}

/** Cap the preview pane so a long preview never overruns the overlay. */
const MAX_PREVIEW_LINES = 8;

/**
 * Coerce the tool's `options` (strings, typed `CheckpointOpt`s, or absent) into a
 * uniform `CheckpointOpt[]`. A bare string becomes `{ label }`; an absent/empty
 * list falls back to the default approve/adjust/stop choices.
 */
export function normalizeOptions(options?: (string | CheckpointOpt)[]): CheckpointOpt[] {
  if (!options?.length) return DEFAULT_CHECKPOINT_OPTIONS.map((label) => ({ label }));
  return options.map((o) => (typeof o === "string" ? { label: o } : o));
}

/**
 * Build the hand-rolled `Component`. Holds a `cursor` and (for multi-select) a
 * `selected` set; `render` frames the current state with `frameCard` (pure, padded
 * to `width`), and `handleInput` routes arrow/space/enter/escape via `matchesKey`.
 * `done` is called exactly once on enter (the picks) or escape (empty = dismissed),
 * so the awaiting promise never hangs.
 */
export function buildOverlay(
  opts: CheckpointOpt[],
  multi: boolean,
  title: string,
  summary: string | undefined,
  theme: Theme,
  done: (result: CheckpointPick) => void,
): Component {
  let cursor = 0;
  const selected = new Set<number>();
  let invalidated = true;
  let cache: { width: number; lines: string[] } | undefined;

  const accentStyle = domainStyle(theme, "checkpoint");

  function buildBody(inner: number): string[] {
    const lines: string[] = [];
    if (summary?.trim()) {
      for (const l of wrapTextWithAnsi(summary.trim(), inner)) lines.push(theme.fg("dim", l));
      lines.push("");
    }
    opts.forEach((o, i) => {
      const focused = i === cursor;
      // Single-select shows a `▸` on the cursor row; multi-select shows a checkbox.
      const prefix = multi ? (selected.has(i) ? `[${glyph("ok")}]` : "[ ]") : focused ? glyph("here") : " ";
      const label = focused ? theme.bold(theme.fg("text", o.label)) : theme.fg("muted", o.label);
      const rationale = o.rationale ? theme.fg("dim", ` — ${o.rationale}`) : "";
      lines.push(`${focused ? accentStyle(prefix) : theme.fg("muted", prefix)} ${label}${rationale}`);
    });
    // Preview pane: the focused option's `preview`, plain-wrapped + capped.
    const preview = opts[cursor]?.preview?.trim();
    if (preview) {
      lines.push("");
      const wrapped = wrapTextWithAnsi(preview, inner);
      const shown = wrapped.slice(0, MAX_PREVIEW_LINES);
      for (const l of shown) lines.push(theme.fg("text", l));
      if (wrapped.length > shown.length) {
        lines.push(theme.fg("muted", `… ${wrapped.length - shown.length} more line(s)`));
      }
    }
    lines.push("");
    const sep = ` ${glyph("bullet")} `;
    const hint = multi
      ? ["up/down move", "space toggle", "enter confirm", "esc dismiss"].join(sep)
      : ["up/down move", "enter choose", "esc dismiss"].join(sep);
    lines.push(theme.fg("dim", hint));
    return lines;
  }

  function move(delta: number): void {
    cursor = (cursor + delta + opts.length) % opts.length;
    invalidated = true;
  }

  return {
    render(width: number): string[] {
      if (!invalidated && cache && cache.width === width) return cache.lines;
      const inner = Math.max(8, Math.floor(width)) - 4;
      const lines = frameCard(
        theme,
        {
          title: `${glyph("checkpoint")} Checkpoint · ${title}`,
          body: buildBody(inner),
          accentStyle,
        },
        width,
      );
      cache = { width, lines };
      invalidated = false;
      return lines;
    },
    handleInput(data: string): void {
      if (matchesKey(data, Key.up)) {
        move(-1);
        return;
      }
      if (matchesKey(data, Key.down)) {
        move(1);
        return;
      }
      if (multi && matchesKey(data, Key.space)) {
        if (selected.has(cursor)) selected.delete(cursor);
        else selected.add(cursor);
        invalidated = true;
        return;
      }
      if (matchesKey(data, Key.enter)) {
        if (!multi) {
          done({ labels: [opts[cursor].label] });
          return;
        }
        // Multi: the picked labels in option order, or the cursor label if none ticked.
        const picked = [...selected].sort((a, b) => a - b).map((i) => opts[i].label);
        done({ labels: picked.length ? picked : [opts[cursor].label] });
        return;
      }
      if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
        done({ labels: [] });
      }
    },
    invalidate(): void {
      invalidated = true;
      cache = undefined;
    },
  };
}

/**
 * The `ctx.ui.custom` factory: `(tui, theme, keybindings, done) => Component`. The
 * extension passes this straight to `ctx.ui.custom`, which calls it with the live
 * `TUI`/`Theme`/`done` and renders the returned `Component` as a focused overlay.
 */
export function makeCheckpointOverlay(opts: CheckpointOpt[], multi: boolean, title: string, summary?: string) {
  return (_tui: TUI, theme: Theme, _kb: KeybindingsManager, done: (result: CheckpointPick) => void): Component =>
    buildOverlay(opts, multi, title, summary, theme, done);
}
