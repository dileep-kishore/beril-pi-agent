import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { berilExec } from "../lib/beril-exec.ts";
import { projectCompletions } from "../lib/project-completions.ts";
import { type ResearchStateSnapshot, buildSnapshot } from "../lib/session-state.ts";
import { linesCard } from "../lib/ui/card.ts";
import { GLYPH } from "../lib/ui/glyphs.ts";
import { domainStyle } from "../lib/ui/palette.ts";
import { callLine, errorCard, partialLine, toolErrorText } from "../lib/ui/science-cards.ts";

/**
 * The lightweight investigation "world model" — a small, LOCAL, KEYLESS block of
 * *orientation* (the working question, still-open questions, working assumptions,
 * and tried-and-abandoned dead ends) that the agent maintains mid-arc so a context
 * compaction keeps the thread of the investigation.
 *
 * It deliberately holds NO `findings[]` — settled results live in claims.json /
 * the claim ledger, and re-laundering them here would let an unverified claim
 * read back as fact. These four sections are re-verifiable PROMPTS to the agent,
 * never proof: they ride on the same `research_state` snapshot the memory
 * extension flushes, persisted via the `beril lifecycle session-state` verb (which
 * server-stamps `updated_at`, redacts secrets, and keeps beril.yaml canonical).
 *
 * The `world_model` tool is NON-destructive (it writes a non-authoritative
 * annotation block, not lifecycle state or remote data), so it stays OUT of
 * `lib/destructive.ts` and the beril-safety gate — but, like beril-memory and
 * beril-audit, it is project-trust fail-closed: an untrusted project gets neither
 * a read nor a write.
 */

const WORLD_MODES = ["read", "update"] as const;

/** Re-read the current research_state snapshot (best-effort; {} when none/error). */
async function readSnapshot(pi: ExtensionAPI, project: string): Promise<Partial<ResearchStateSnapshot>> {
  try {
    const res = await berilExec<ResearchStateSnapshot | Record<string, never>>(pi, [
      "lifecycle",
      "session-state",
      project,
      "--get",
    ]);
    return res && typeof res === "object" ? (res as Partial<ResearchStateSnapshot>) : {};
  } catch {
    return {};
  }
}

const EMPTY = "(nothing recorded yet)";

/** Render one labelled group of orientation lines (or a single muted placeholder). */
function section(theme: Pick<Theme, "fg">, label: string, items: string[] | undefined): string[] {
  if (!items?.length) return [`${theme.fg("muted", label)}  ${theme.fg("dim", "(none)")}`];
  return [theme.fg("muted", label), ...items.map((s) => `  ${theme.fg("dim", GLYPH.bullet)} ${theme.fg("text", s)}`)];
}

export default function berilWorld(pi: ExtensionAPI) {
  pi.registerTool({
    name: "world_model",
    label: "Investigation world model",
    description:
      "Read or update the lightweight investigation world model (the working question, open questions, working assumptions, and dead ends). Orientation only — NOT settled findings (those live in the claim ledger). Use mode=read to show it, mode=update to record the agent's current orientation mid-arc.",
    parameters: Type.Object({
      project: Type.String({ description: "Project id (directory under projects/)." }),
      mode: StringEnum([...WORLD_MODES], {
        description: "read shows the current world model; update records the supplied orientation sections.",
      }),
      question: Type.Optional(Type.String({ description: "The research question under investigation (update only)." })),
      openQuestions: Type.Optional(
        Type.Array(Type.String({ description: "A still-open question to resolve." }), {
          description: "Still-open questions (update only; replaces the section when supplied).",
        }),
      ),
      assumptions: Type.Optional(
        Type.Array(Type.String({ description: "A working assumption that would change the analysis." }), {
          description: "Working assumptions (update only; replaces the section when supplied).",
        }),
      ),
      deadEnds: Type.Optional(
        Type.Array(Type.String({ description: "A tried-and-abandoned avenue, so it is not re-attempted." }), {
          description: "Dead ends already tried (update only; replaces the section when supplied).",
        }),
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx: ExtensionContext) {
      // Fail-closed: an untrusted project never reads or writes the world model.
      if (!ctx.isProjectTrusted()) {
        return {
          content: [{ type: "text", text: "World model unavailable: this project is not trusted." }],
          details: { project: params.project, untrusted: true },
        };
      }

      const current = await readSnapshot(pi, params.project);

      if (params.mode === "read") {
        return {
          content: [{ type: "text", text: `World model for ${params.project}.` }],
          details: {
            project: params.project,
            question: current.question ?? "",
            openQuestions: current.openQuestions ?? [],
            assumptions: current.assumptions ?? [],
            deadEnds: current.deadEnds ?? [],
          },
        };
      }

      // update: MERGE — keep the count/identifier core + any section the agent did
      // not supply, then run buildSnapshot to clamp/bound, then persist via --set.
      const snapshot = buildSnapshot({
        project: params.project,
        phase: current.phase ?? "",
        claims: current.claims ?? { total: 0, supported: 0, refuted: 0 },
        lastCheckpoint: current.lastCheckpoint,
        question: params.question ?? current.question,
        openQuestions: params.openQuestions ?? current.openQuestions,
        assumptions: params.assumptions ?? current.assumptions,
        deadEnds: params.deadEnds ?? current.deadEnds,
      });
      await berilExec(pi, ["lifecycle", "session-state", params.project, "--set", JSON.stringify(snapshot)]);
      return {
        content: [{ type: "text", text: `Recorded the world model for ${params.project}.` }],
        details: {
          project: params.project,
          question: snapshot.question ?? "",
          openQuestions: snapshot.openQuestions ?? [],
          assumptions: snapshot.assumptions ?? [],
          deadEnds: snapshot.deadEnds ?? [],
        },
      };
    },
    renderCall(args, theme) {
      return callLine(theme, `world model · ${args.mode ?? "read"} · ${args.project}`);
    },
    renderResult(result, { isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      if (isPartial) return partialLine(theme, "Reading world model…");
      const d = result.details as {
        project: string;
        question?: string;
        openQuestions?: string[];
        assumptions?: string[];
        deadEnds?: string[];
        untrusted?: boolean;
      };
      const lines = [
        `${theme.fg("muted", "Question")}  ${d.question ? theme.fg("text", d.question) : theme.fg("dim", EMPTY)}`,
        "",
        ...section(theme, "Open questions", d.openQuestions),
        "",
        ...section(theme, "Assumptions", d.assumptions),
        "",
        ...section(theme, "Dead ends", d.deadEnds),
        "",
        theme.fg("muted", "Orientation only — NOT settled findings. Re-verify before relying on any of these."),
      ];
      return linesCard(theme, {
        title: `World model · ${d.project}`,
        accentStyle: domainStyle(theme, "plan"),
        lines,
        maxBodyLines: 40,
      });
    },
  });

  pi.registerCommand("world-model", {
    description: "Show or update the lightweight investigation world model (orientation only, not findings).",
    getArgumentCompletions: projectCompletions,
    async handler(args: string, ctx: ExtensionCommandContext) {
      const project = args.trim();
      if (!project) {
        if (ctx.hasUI) ctx.ui.notify("Usage: /world-model <project>", "warning");
        return;
      }
      pi.sendUserMessage(
        `Call world_model with mode=read for project "${project}" and summarize the current working question, open questions, assumptions, and dead ends. If the investigation has moved on, call world_model with mode=update to record the new orientation — never record settled findings there (those belong in the claim ledger).`,
      );
    },
  });
}
