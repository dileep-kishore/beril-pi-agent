import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { berilExec } from "../lib/beril-exec.ts";
import { projectCompletions } from "../lib/project-completions.ts";
import { linesCard } from "../lib/ui/card.ts";
import { type CommonsQueryResult, commonsCard } from "../lib/ui/koros-cards.ts";
import { callLine, errorCard, kvLines, partialLine, toolErrorText } from "../lib/ui/science-cards.ts";

interface LandSummary {
  landed: number;
  skipped_duplicates: number;
  by_kind: Record<string, number>;
}

/** Reuse-framed guidance for the model (KING D55 — an overlap is context to build on, never a prohibition). */
function checkGuidance(r: CommonsQueryResult): string {
  const top = r.matches?.[0];
  if (r.verdict === "novel" || !top) return "No prior work matched — proceed; this question is fresh ground.";
  const gaps = (r.matches ?? []).filter((m) => m.kind === "gap");
  const gapNote = gaps.length
    ? ` ${gaps.length} matched entr(ies) are OPEN GAPS — the most actionable kind: consider aiming the project at one.`
    : "";
  if (r.verdict === "overlap") {
    return `Strong overlap with prior work in "${top.project}" — skim that project's REPORT.md, then BUILD ON it (reuse its findings as context, extend rather than repeat).${gapNote}`;
  }
  return `Related-but-distinct prior work exists (top: "${top.project}") — reusable context, not a duplicate.${gapNote}`;
}

/**
 * The knowledge commons: a content-addressed, append-only store of findings,
 * lessons (including surviving refutations — durable negative results), and open
 * gaps across projects. `commons_check` is the anti-redundancy moment at project
 * start; landing happens automatically at `/submit` (and on demand here). The
 * store is local + keyless (`~/.beril/agora` or $BERIL_COMMONS_DIR).
 */
export default function berilCommons(pi: ExtensionAPI) {
  pi.registerTool({
    name: "commons_check",
    label: "Check the knowledge commons",
    description:
      "Before starting new work, check the cross-project knowledge commons: has a prior project already answered (or partially answered) this question — and are there recorded OPEN GAPS or negative results (lessons) nearby? Returns a reuse-framed verdict (novel / related / overlap) with the top matches. An overlap means BUILD ON the prior work, never 'don't redo'. Cheap and local; run it whenever a new research question is framed.",
    parameters: Type.Object({
      question: Type.String({ description: "The framed research question or topic, 1-2 sentences." }),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const result = await berilExec<CommonsQueryResult>(pi, ["commons", "query", "--q", params.question]);
      const matches = (result.matches ?? [])
        .map((m) => `- [${m.kind}] (${Math.round(m.score * 100)}%, ${m.project}) ${m.body}`)
        .join("\n");
      const text = `${result.verdict}. ${checkGuidance(result)}${matches ? `\n${matches}` : ""}`;
      return { content: [{ type: "text", text }], details: result };
    },
    renderCall(args, theme) {
      const q = args.question.replace(/\s+/g, " ").trim();
      return callLine(theme, `commons · ${q.length > 60 ? `${q.slice(0, 59)}…` : q}`);
    },
    renderResult(result, { isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      if (isPartial) return partialLine(theme, "Checking the commons…");
      return commonsCard(theme, result.details as CommonsQueryResult);
    },
  });

  pi.registerTool({
    name: "commons_land",
    label: "Land knowledge in the commons",
    description:
      "Add knowledge to the cross-project commons (append-only, dedup'd by content hash, project visibility, ORCID-attributed). Either from_report=true to extract a project's findings, open gaps, and surviving-refutation lessons automatically, or pass kind+text for a single entry (e.g. a lesson learned mid-project, or a gap you noticed but won't pursue). Negative results are first-class: land what did NOT hold so the next project doesn't re-run it.",
    parameters: Type.Object({
      project: Type.String({ description: "Project id the knowledge came from." }),
      from_report: Type.Optional(
        Type.Boolean({ description: "Extract findings/gaps/lessons from the project's report artifacts." }),
      ),
      kind: Type.Optional(StringEnum(["finding", "lesson", "gap"], { description: "Kind for a single entry." })),
      text: Type.Optional(Type.String({ description: "Body for a single entry (≤ 2000 chars)." })),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const args = ["commons", "land", params.project];
      if (params.from_report) args.push("--from-report");
      if (params.kind) args.push("--kind", params.kind);
      if (params.text) args.push("--text", params.text);
      const summary = await berilExec<LandSummary>(pi, args);
      const kinds = Object.entries(summary.by_kind ?? {})
        .map(([k, n]) => `${n} ${k}(s)`)
        .join(", ");
      const text = `Landed ${summary.landed} entr(ies)${kinds ? ` (${kinds})` : ""}; ${summary.skipped_duplicates} duplicate(s) skipped.`;
      return { content: [{ type: "text", text }], details: summary };
    },
    renderCall(args, theme) {
      return callLine(theme, `commons land · ${args.project}${args.from_report ? " · from report" : ""}`);
    },
    renderResult(result, { isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      if (isPartial) return partialLine(theme, "Landing knowledge…");
      const d = result.details as LandSummary;
      return linesCard(theme, {
        title: "Commons",
        lines: kvLines(theme, {
          landed: d.landed,
          duplicates_skipped: d.skipped_duplicates,
          ...(d.by_kind ?? {}),
        }),
      });
    },
  });

  pi.registerMessageRenderer<{ result: CommonsQueryResult }>("beril-commons-check", (message, _opts, theme) =>
    commonsCard(theme, message.details?.result ?? { verdict: "novel", matches: [] }),
  );

  pi.registerCommand("commons", {
    description: "Query the cross-project knowledge commons (findings, lessons, open gaps): /commons <question>.",
    getArgumentCompletions: projectCompletions,
    async handler(args: string, ctx: ExtensionCommandContext) {
      const question = args.trim();
      if (!question) {
        if (ctx.hasUI) ctx.ui.notify("Usage: /commons <question or topic>", "warning");
        return;
      }
      const result = await berilExec<CommonsQueryResult>(pi, ["commons", "query", "--q", question]).catch(
        () => undefined,
      );
      if (!result) {
        if (ctx.hasUI) ctx.ui.notify("Commons query failed (is the beril CLI installed?).", "error");
        return;
      }
      pi.sendMessage(
        {
          customType: "beril-commons-check",
          content: `Commons: ${result.verdict} (${result.matches?.length ?? 0} match(es)) for "${question}"`,
          display: true,
          details: { result },
        },
        { triggerTurn: false, deliverAs: "nextTurn" },
      );
    },
  });
}
