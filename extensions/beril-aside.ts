import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { type AsideDeps, branchToContext, runAside } from "../lib/aside.ts";
import { type AsideController, makeAsideOverlay } from "../lib/ui/aside-overlay.ts";

/**
 * `/aside` — ask the same session model a one-off question off the record.
 *
 * The question and the answer never enter the session JSONL the model replays
 * next turn, and never enter the claim ledger: the command writes NOTHING to the
 * session (no `sendMessage`/`sendUserMessage`/`appendEntry`) and renders only via
 * `ctx.ui.custom`. See `lib/aside.ts` for why a `display:false` injected message
 * would still leak (`convertToLlm` → `role:"user"` regardless of `display`,
 * `session-manager.d.ts:85-99`). There is no `renderResult`/safety-gate/repro-hash
 * here by construction — this is a slash command, not a tool.
 */
export default function berilAside(pi: ExtensionAPI) {
  pi.registerCommand("aside", {
    description: "Ask the session model a one-off question off the record (not saved to the conversation).",
    async handler(args: string, ctx: ExtensionCommandContext) {
      // Guards first, early-return — never fall through to a real turn.
      if (!ctx.hasUI || ctx.mode !== "tui") {
        ctx.ui.notify("/aside needs interactive mode.", "error");
        return;
      }
      const question = args.trim();
      if (!question) {
        ctx.ui.notify("Usage: /aside <question>", "warning");
        return;
      }
      if (!ctx.model) {
        ctx.ui.notify("/aside needs a model selected.", "error");
        return;
      }

      // Read-only branch projection; nothing is written back.
      const context = branchToContext(ctx.sessionManager.getBranch());
      // Own the cancellation — do NOT bind ctx.signal (that is the agent's turn signal).
      const controller = new AbortController();
      const deps: AsideDeps = {
        model: ctx.model,
        getApiKeyAndHeaders: (m) => ctx.modelRegistry.getApiKeyAndHeaders(m),
        // Injectable seam (tests supply a fake completer; defaults to pi-ai `complete`).
        complete: (ctx as { __asideComplete?: AsideDeps["complete"] }).__asideComplete,
      };

      let overlay: AsideController | undefined;
      const overlayDone = ctx.ui.custom<void>(
        (_tui, theme, _kb, done) => {
          overlay = makeAsideOverlay(theme, question, () => controller.abort(), done);
          return overlay;
        },
        { overlay: true, overlayOptions: { width: "70%", anchor: "center", maxHeight: "80%" } },
      );

      // Run the off-the-record completion alongside the open overlay; push the
      // outcome into the controller. If the scientist already dismissed (Esc →
      // abort), skip the update.
      const result = await runAside(deps, question, context, controller);
      if (overlay && !overlay.isAborted()) {
        if (result.ok) overlay.setAnswer(result.answer);
        else if (!result.aborted) overlay.setError(result.error ?? "the aside failed");
      }

      // Wait for the scientist to dismiss the overlay. Persist nothing.
      await overlayDone;
    },
  });
}
