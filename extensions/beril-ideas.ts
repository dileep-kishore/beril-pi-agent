import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { buildIdeaTournamentPrompt, scanApprovedMemoryIndex, writeMemoryIndex } from "../lib/scientific-memory.ts";
import { linesCard } from "../lib/ui/card.ts";
import { domainStyle } from "../lib/ui/palette.ts";
import { callLine, errorCard, partialLine, toolErrorText } from "../lib/ui/science-cards.ts";

export default function berilIdeas(pi: ExtensionAPI) {
  pi.registerTool({
    name: "science_memory",
    label: "Index approved scientific memory",
    description:
      "Read-only by default: scan complete/approved projects for reviewed Discoveries and Performance Notes. Optionally write science-memory.jsonl for external inspection. Use before suggest-research / idea-tournament.",
    parameters: Type.Object({
      write: Type.Optional(Type.Boolean({ description: "Write science-memory.jsonl at repo root (default false)." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx: ExtensionContext) {
      const records = await scanApprovedMemoryIndex(ctx.cwd);
      const path = params.write ? await writeMemoryIndex(ctx.cwd, records) : undefined;
      const text = `${records.length} approved memory record(s)${path ? ` written to ${path}` : ""}.`;
      return { content: [{ type: "text", text }], details: { records, path } };
    },
    renderCall(_args, theme) {
      return callLine(theme, "science memory · approved findings");
    },
    renderResult(result, { isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      if (isPartial) return partialLine(theme, "Scanning approved memory…");
      const records = (result.details as { records?: { project: string; kind: string; text: string }[] }).records ?? [];
      return linesCard(theme, {
        title: `Science memory · ${records.length}`,
        accentStyle: domainStyle(theme, "governance"),
        lines: records.slice(0, 12).map((r) => `${r.project} [${r.kind}] ${r.text}`),
        maxBodyLines: 16,
      });
    },
  });

  pi.registerCommand("science-memory", {
    description: "Build or show the approved BERIL scientific memory index.",
    async handler(args: string, ctx: ExtensionCommandContext) {
      const records = await scanApprovedMemoryIndex(ctx.cwd);
      const shouldWrite = /\b--write\b|\b--rebuild\b/.test(args);
      const path = shouldWrite ? await writeMemoryIndex(ctx.cwd, records) : undefined;
      if (ctx.hasUI) ctx.ui.notify(`${records.length} approved memory record(s)${path ? " indexed" : ""}.`, "info");
    },
  });

  pi.registerCommand("idea-tournament", {
    description: "Generate and rank BERIL research ideas using approved project memory.",
    async handler(args: string, ctx: ExtensionCommandContext) {
      const records = await scanApprovedMemoryIndex(ctx.cwd);
      pi.sendUserMessage(buildIdeaTournamentPrompt(args.trim(), records));
    },
  });
}
