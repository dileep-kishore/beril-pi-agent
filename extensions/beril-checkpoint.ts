import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { DEFAULT_CHECKPOINT_OPTIONS, checkpointCard } from "../lib/ui/checkpoint.ts";
import { callLine, errorCard, toolErrorText } from "../lib/ui/science-cards.ts";

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
        Type.Array(Type.String(), { description: "Choices to offer (default: approve / adjust / stop)." }),
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx: ExtensionContext) {
      const options = params.options?.length ? params.options : DEFAULT_CHECKPOINT_OPTIONS;
      let choice: string;
      if (ctx.hasUI) {
        const picked = await ctx.ui.select(params.title, options);
        choice = picked ?? "(no choice — the scientist dismissed the prompt; wait for their direction)";
      } else {
        choice = `${options[0]} (auto: no interactive UI)`;
      }
      return {
        content: [{ type: "text", text: `Scientist chose: ${choice}` }],
        details: { title: params.title, summary: params.summary, choice },
      };
    },
    renderCall(args, theme) {
      return callLine(theme, `checkpoint · ${args.title}`);
    },
    renderResult(result, _opts, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      return checkpointCard(theme, result.details as { title: string; summary?: string; choice: string });
    },
  });
}
