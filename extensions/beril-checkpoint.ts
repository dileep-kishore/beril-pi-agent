import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { linesCard } from "../lib/ui/card.ts";
import {
  type CheckpointOpt,
  type CheckpointPick,
  makeCheckpointOverlay,
  normalizeOptions,
} from "../lib/ui/checkpoint-overlay.ts";
import { checkpointCard } from "../lib/ui/checkpoint.ts";
import { callLine, errorCard, toolErrorText } from "../lib/ui/science-cards.ts";

/**
 * A typed checkpoint option: a short label, an optional one-line rationale, and an
 * optional longer preview. Plain strings are accepted too (coerced to `{ label }`),
 * so existing callers that pass `string[]` keep working.
 */
const CheckpointOption = Type.Object({
  label: Type.String({ description: "Short choice label shown in the list." }),
  rationale: Type.Optional(Type.String({ description: "One-line why-pick-this, shown dim under the label." })),
  preview: Type.Optional(Type.String({ description: "Longer markdown preview, shown in the pane below the list." })),
});

/**
 * The science-checkpoint tool. Approval in this workbench is reserved for two
 * things: irreversible operations (the beril-safety gate) and science direction
 * (this). At a natural seam — after the research plan, after the first result —
 * the agent calls `request_checkpoint` to put a clear decision in front of the
 * scientist and act on their answer, rather than racing ahead to a finished
 * artifact. In headless runs there is no one to ask, so it returns the first
 * option (proceed) and says so.
 */
export default function berilCheckpoint(pi: ExtensionAPI) {
  pi.registerTool({
    name: "request_input",
    label: "Ask the scientist",
    description:
      "Ask the scientist a free-form clarification question. Use when multiple choice would hide the needed nuance. Do not use for routine steps; ask only when the answer changes the research question, data choice, hypothesis, or analysis.",
    parameters: Type.Object({
      title: Type.String({ description: "The clarification question to ask." }),
      placeholder: Type.Optional(Type.String({ description: "Short placeholder or prefill text." })),
      multiline: Type.Optional(Type.Boolean({ description: "Use a multiline editor instead of a one-line input." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx: ExtensionContext) {
      if (!ctx.hasUI) {
        const note = "No interactive UI is available; proceed only with explicitly stated assumptions.";
        return {
          content: [{ type: "text", text: `No scientist answer: ${note}` }],
          details: { title: params.title, answer: undefined, note },
        };
      }
      const answer =
        params.multiline === true
          ? await ctx.ui.editor(params.title, params.placeholder ?? "")
          : await ctx.ui.input(params.title, params.placeholder ?? "");
      const cleaned = answer?.trim();
      const note = cleaned
        ? undefined
        : "No answer provided; wait for direction or state the assumption before proceeding.";
      return {
        content: [
          {
            type: "text",
            text: cleaned ? `Scientist answered: ${cleaned}` : `No scientist answer: ${note}`,
          },
        ],
        details: { title: params.title, answer: cleaned || undefined, note },
      };
    },
    renderCall(args, theme) {
      return callLine(theme, `question · ${args.title}`);
    },
    renderResult(result, _opts, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      const d = result.details as { title: string; answer?: string; note?: string };
      return linesCard(theme, {
        title: `Scientist input · ${d.title}`,
        lines: [d.answer ? theme.fg("text", d.answer) : theme.fg("muted", d.note ?? "(no answer)")],
      });
    },
  });

  pi.registerTool({
    name: "request_checkpoint",
    label: "Checkpoint with the scientist",
    description:
      "Pause at a decision seam and ask the scientist to choose a direction. Use SPARINGLY, at natural seams (after the research plan, after the first result/figure) — never for routine steps. Present the relevant artifact first, then call this. Returns the scientist's choice for you to act on.",
    parameters: Type.Object({
      title: Type.String({ description: "The decision question, e.g. 'Plan ready to start the analysis?'" }),
      summary: Type.Optional(
        Type.String({
          description: "Short markdown recap of what you're checking in about (the plan, the first result).",
        }),
      ),
      options: Type.Optional(
        Type.Array(CheckpointOption, {
          description:
            "Choices to offer (default: approve / adjust / stop). Use {label, rationale?, preview?}. Legacy string options are accepted via argument preparation.",
        }),
      ),
      multi: Type.Optional(
        Type.Boolean({
          description: "Allow the scientist to select more than one option (space toggles, enter confirms).",
        }),
      ),
    }),
    prepareArguments(args: unknown) {
      const prepared = { ...(args as Record<string, unknown>) };
      if (Array.isArray(prepared.options)) {
        prepared.options = prepared.options.map((o) => (typeof o === "string" ? { label: o } : o));
      }
      return prepared as { title: string; summary?: string; options?: CheckpointOpt[]; multi?: boolean };
    },
    async execute(_id, params, _signal, _onUpdate, ctx: ExtensionContext) {
      const opts = normalizeOptions(params.options);
      const multi = params.multi === true;
      let labels: string[];
      if (ctx.mode === "tui") {
        // Interactive TUI: the bespoke focusable overlay (rationale + preview, single/multi).
        const pick = await ctx.ui.custom<CheckpointPick>(
          makeCheckpointOverlay(opts, multi, params.title, params.summary),
          { overlay: true, overlayOptions: { width: "70%", anchor: "center", maxHeight: "80%" } },
        );
        labels = pick.labels;
      } else if (ctx.hasUI) {
        // RPC and other UI-but-not-TUI surfaces have no `custom`; degrade to single-select.
        const picked = await ctx.ui.select(
          params.title,
          opts.map((o) => o.label),
        );
        labels = picked ? [picked] : [];
      } else {
        // Headless: no one to ask — proceed with the first option and say so (unchanged contract).
        labels = [`${opts[0].label} (auto: no interactive UI)`];
      }
      const choice = labels.join(", ") || "(no choice — the scientist dismissed the prompt; wait for their direction)";
      // Record only a real human decision on the cross-session bus: skip both a
      // dismissed prompt (labels === []) and a headless auto-pick (!hasUI) — neither
      // is the scientist's direction, so neither should become the "last checkpoint".
      if (ctx.hasUI && labels.length) pi.events.emit("beril:checkpoint", { title: params.title, choice });
      return {
        content: [{ type: "text", text: `Scientist chose: ${choice}` }],
        details: { title: params.title, summary: params.summary, choice, choices: labels },
      };
    },
    renderCall(args, theme) {
      return callLine(theme, `checkpoint · ${args.title}`);
    },
    renderResult(result, _opts, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      return checkpointCard(
        theme,
        result.details as { title: string; summary?: string; choice: string; choices?: string[] },
      );
    },
  });
}
