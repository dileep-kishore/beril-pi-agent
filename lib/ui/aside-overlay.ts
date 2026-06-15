import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Key, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { frameCard } from "./card.ts";
import { glyph } from "./glyphs.ts";
import { domainStyle } from "./palette.ts";

/**
 * The interactive overlay for `/aside` — the first focusable `ctx.ui.custom`
 * Component in the repo. It is painted on top of the session and creates no
 * `SessionEntry`, so the off-the-record exchange leaves no trace (see
 * `lib/aside.ts`).
 *
 * The overlay starts in a pending (spinner) state, then the command pushes the
 * answer or an error into the controller; either re-renders. Esc aborts the
 * in-flight model call and dismisses. The controller is the `Component` (it owns
 * `render`/`handleInput`/`invalidate`), with `setAnswer`/`setError`/`isAborted`
 * as the seam the command drives.
 */

/** A footer line scientists can trust: this is not saved and the agent will not see it. */
function footerText(): string {
  const sep = ` ${glyph("bullet")} `;
  return ["not saved to the conversation", "the agent will not see this", "Esc to dismiss"].join(sep);
}

export interface AsideController extends Component {
  setAnswer(answer: string): void;
  setError(message: string): void;
  /** True once Esc was pressed — the command checks this to abort the model call. */
  isAborted(): boolean;
}

/**
 * Build the overlay controller. `onAbort` is invoked once when the scientist
 * presses Esc (so the command can `controller.abort()` the model call), and
 * `done` dismisses the overlay (`ctx.ui.custom`'s resolution callback).
 */
export function makeAsideOverlay(
  theme: Theme,
  question: string,
  onAbort: () => void,
  done: () => void,
): AsideController {
  let mode: "pending" | "answer" | "error" = "pending";
  let answer = "";
  let aborted = false;
  let scroll = 0;
  let maxScroll = 0; // overflow ceiling, recomputed each render; bounds the down-arrow
  let cache: { width: number; lines: string[] } | undefined;

  const invalidate = () => {
    cache = undefined;
  };

  const bodyLines = (inner: number): string[] => {
    if (mode === "pending") return [theme.fg("muted", `${glyph("inProgress")} thinking…`)];
    const text = answer || (mode === "error" ? "The aside failed without a message." : "(empty answer)");
    const style = mode === "error" ? (s: string) => theme.fg("error", s) : (s: string) => theme.fg("text", s);
    return wrapTextWithAnsi(text, inner).map(style);
  };

  return {
    setAnswer(a: string): void {
      mode = "answer";
      answer = a;
      scroll = 0;
      invalidate();
    },
    setError(message: string): void {
      mode = "error";
      answer = message;
      scroll = 0;
      invalidate();
    },
    isAborted(): boolean {
      return aborted;
    },
    render(width: number): string[] {
      if (cache && cache.width === width) return cache.lines;
      const inner = Math.max(8, Math.floor(width)) - 4;
      const banner = theme.fg("dim", truncateToWidth(`${glyph("here")} aside  ${question}`, inner));
      const all = bodyLines(inner);
      // Scroll on overflow so a long answer stays readable; cap the visible window.
      const maxVisible = 18;
      const max = Math.max(0, all.length - maxVisible);
      maxScroll = max;
      if (scroll > max) scroll = max;
      const visible = all.length > maxVisible ? all.slice(scroll, scroll + maxVisible) : all;
      const more =
        all.length > maxVisible
          ? [theme.fg("muted", `scroll ${scroll + 1}-${scroll + visible.length} of ${all.length}`)]
          : [];
      const lines = frameCard(
        theme,
        {
          title: `${glyph("here")} aside`,
          body: [banner, "", ...visible, ...more, "", theme.fg("dim", truncateToWidth(footerText(), inner))],
          accentStyle: domainStyle(theme, "neutral"),
        },
        width,
      );
      cache = { width, lines };
      return lines;
    },
    handleInput(data: string): void {
      if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
        if (!aborted) {
          aborted = true;
          onAbort();
        }
        done();
        return;
      }
      if (mode !== "answer" && mode !== "error") return;
      if (matchesKey(data, Key.up) && scroll > 0) {
        scroll -= 1;
        invalidate();
      } else if (matchesKey(data, Key.down) && scroll < maxScroll) {
        scroll += 1;
        invalidate();
      } else if (matchesKey(data, Key.enter)) {
        done();
      }
    },
    invalidate,
  };
}
