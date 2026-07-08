import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { BerilError, berilExec } from "../lib/beril-exec.ts";
import { type ClaimRow, parseClaimLedger, parseEvidence, tallyClaims } from "../lib/claim-ledger.ts";
import { type ClaimState, buildClaimState, claimStateSummary, serializeClaimState } from "../lib/claim-state.ts";
import { GATE_CATALOG, type GateRecord } from "../lib/gates.ts";
import { projectCompletions } from "../lib/project-completions.ts";
import { requireReady } from "../lib/readiness.ts";
import { collectReviewPreflight, submitReadinessProblems } from "../lib/review-preflight.ts";
import type { EvidenceView } from "../lib/science.ts";
import { linesCard } from "../lib/ui/card.ts";
import { GLYPH } from "../lib/ui/glyphs.ts";
import { gateReferenceCard } from "../lib/ui/koros-cards.ts";
import {
  callLine,
  claimLedgerCard,
  claimStateCard,
  destructiveResultCard,
  errorCard,
  evidenceCard,
  hashCard,
  kvLines,
  lifecycleCard,
  partialLine,
  reviewPreflightCard,
  toolErrorText,
  userCard,
} from "../lib/ui/science-cards.ts";

const LIFECYCLE_STATES = ["exploration", "proposed", "active", "analysis", "reviewed", "complete"] as const;

// Footer key for the active-project segment. The built-in footer renders all
// setStatus keys sorted by key, space-joined; the glyph prefix self-identifies
// the segment alongside beril-env's "beril-connection" key.
const PROJECT_STATUS_KEY = "beril-2-project";

// Session-scoped active project, surfaced in the footer. Display-only: it never
// feeds a hash or beril.yaml.
let activeProject: string | undefined;

/** Record the active project and reflect it in the footer (UI only). */
function setActiveProject(ctx: ExtensionContext | ExtensionCommandContext, project: string): void {
  activeProject = project;
  if (ctx.hasUI) ctx.ui.setStatus(PROJECT_STATUS_KEY, `${GLYPH.project} ${project}`);
}

interface Identity {
  name: string;
  affiliation: string;
  orcid: string;
}

/**
 * Governance tools: notebook hashing, the lifecycle state machine, the ORCID
 * identity oracle, and the irreversible lakehouse upload. Each shells to a
 * `beril` subcommand; `lakehouse_submit` is in the destructive registry and is
 * additionally gated by the beril-safety extension.
 */
export default function berilGovernance(pi: ExtensionAPI) {
  pi.registerTool({
    name: "notebook_hash",
    label: "Hash project notebooks",
    description:
      "Compute reproducibility hashes (sha256:) for a project's notebooks. Use to verify integrity before review/submit.",
    parameters: Type.Object({
      project: Type.String({ description: "Project id (directory under projects/)." }),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const hashes = await berilExec<Record<string, string>>(pi, ["hash", params.project]);
      const entries = Object.entries(hashes);
      // Hand the model a compact summary (the card renders the full digest from
      // details) so it doesn't echo the raw JSON hash map.
      const summary = entries.length
        ? `${entries.length} notebook hash(es):\n${entries.map(([nb, h]) => `- ${nb}  ${h.slice(0, 19)}…`).join("\n")}`
        : "No notebooks to hash.";
      return { content: [{ type: "text", text: summary }], details: hashes };
    },
    renderCall(args, theme) {
      return callLine(theme, `hash · ${args.project}`);
    },
    renderResult(result, { isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      if (isPartial) return partialLine(theme, "Hashing notebooks…");
      return hashCard(theme, result.details as Record<string, string>);
    },
  });

  pi.registerTool({
    name: "claim_ledger",
    label: "Show claim ledger",
    description:
      "Read-only: parse a project's RESEARCH_PLAN.md hypotheses and REPORT.md confidence/status + supports/refutes lines into a Status | Confidence | Supports | Refutes table. Use to see, at a glance, where each claim stands. Persists nothing; renders a card only.",
    parameters: Type.Object({
      project: Type.String({ description: "Project id (directory under projects/)." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx: ExtensionContext) {
      const dir = join(ctx.cwd, "projects", params.project);
      const read = async (name: string) => readFile(join(dir, name), "utf8").catch(() => "");
      const [planMd, reportMd] = await Promise.all([read("RESEARCH_PLAN.md"), read("REPORT.md")]);
      const rows = parseClaimLedger(planMd, reportMd);
      // Broadcast the tally so the statusline reflects where the science stands.
      pi.events.emit("beril:claims", { project: params.project, ...tallyClaims(rows) });
      const text = rows.length
        ? `${rows.length} claim(s): ${rows.map((r) => `${r.status}/${r.confidence}`).join(", ")}`
        : "No hypotheses or findings parsed.";
      return { content: [{ type: "text", text }], details: { rows } };
    },
    renderCall(args, theme) {
      return callLine(theme, `claim ledger · ${args.project}`);
    },
    renderResult(result, { isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      if (isPartial) return partialLine(theme, "Reading claim ledger…");
      const d = result.details as { rows: ClaimRow[] };
      return claimLedgerCard(theme, d.rows);
    },
  });

  pi.registerTool({
    name: "claim_state",
    label: "Update claim state",
    description:
      "Build a first-class project-local claims.json from RESEARCH_PLAN.md and REPORT.md. Preserves existing claim IDs/reviewer notes, optionally persists the updated ledger, and highlights unsupported claims / empty refutes before review.",
    parameters: Type.Object({
      project: Type.String({ description: "Project id (directory under projects/)." }),
      persist: Type.Optional(Type.Boolean({ description: "Write projects/<id>/claims.json (default false)." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx: ExtensionContext) {
      const dir = join(ctx.cwd, "projects", params.project);
      const read = async (name: string) => readFile(join(dir, name), "utf8").catch(() => "");
      const [planMd, reportMd, existingRaw] = await Promise.all([
        read("RESEARCH_PLAN.md"),
        read("REPORT.md"),
        read("claims.json"),
      ]);
      let existing: ClaimState | undefined;
      try {
        existing = existingRaw ? (JSON.parse(existingRaw) as ClaimState) : undefined;
      } catch {
        existing = undefined;
      }
      const state = buildClaimState({ project: params.project, planMd, reportMd, existing });
      const summary = claimStateSummary(state.rows);
      const path = join(dir, "claims.json");
      if (params.persist) await writeFile(path, serializeClaimState(state), "utf8");
      pi.events.emit("beril:claims", {
        project: params.project,
        total: summary.total,
        supported: summary.supported,
        refuted: summary.refuted,
      });
      const text = `${summary.total} claim(s): ${summary.supported} supported, ${summary.refuted} refuted, ${summary.unsupported} unsupported, ${summary.emptyRefutes} with empty refutes.`;
      return {
        content: [{ type: "text", text }],
        details: { state, rows: state.rows, summary, path, persisted: params.persist === true },
      };
    },
    renderCall(args, theme) {
      return callLine(theme, `claim state · ${args.project}${args.persist ? " · persist" : ""}`);
    },
    renderResult(result, { isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      if (isPartial) return partialLine(theme, "Building claim state…");
      const d = result.details as {
        rows: ClaimState["rows"];
        summary: ReturnType<typeof claimStateSummary>;
        persisted?: boolean;
      };
      return claimStateCard(theme, d.rows, d.summary, d.persisted);
    },
  });

  pi.registerTool({
    name: "review_preflight",
    label: "Review preflight",
    description:
      "Read-only: summarize whether a project is ready for review and submit by checking report presence, notebook hashes, claim support/refutes, red-team pass, and review record.",
    parameters: Type.Object({
      project: Type.String({ description: "Project id (directory under projects/)." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx: ExtensionContext) {
      const view = await collectReviewPreflight(pi, ctx.cwd, params.project);
      const text = `${params.project}: ${view.reviewReady ? "review ready" : "review not ready"}; ${view.submitReady ? "submit ready" : "submit not ready"}.`;
      return { content: [{ type: "text", text }], details: view };
    },
    renderCall(args, theme) {
      return callLine(theme, `review preflight · ${args.project}`);
    },
    renderResult(result, { isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      if (isPartial) return partialLine(theme, "Checking review readiness…");
      return reviewPreflightCard(theme, result.details as Parameters<typeof reviewPreflightCard>[1]);
    },
  });

  pi.registerTool({
    name: "evidence",
    label: "Show evidence for a finding",
    description:
      "Read-only: parse a project's REPORT.md into the supporting AND refuting evidence behind one finding — each a re-openable pointer (query/notebook/figure/paper) — with its read-off status and confidence. Optionally pick a finding by substring; defaults to the first. Persists nothing; renders a card only.",
    parameters: Type.Object({
      project: Type.String({ description: "Project id (directory under projects/)." }),
      finding: Type.Optional(
        Type.String({ description: "Substring of the finding to show (case-insensitive). Defaults to the first." }),
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx: ExtensionContext) {
      const dir = join(ctx.cwd, "projects", params.project);
      const reportMd = await readFile(join(dir, "REPORT.md"), "utf8").catch(() => "");
      const view = parseEvidence(reportMd, params.finding);
      const text = view
        ? `${view.status}/${view.confidence} · ${view.supports.length} support(s), ${view.refutes.length} refute(s): ${view.claim}`
        : `No evidence parsed for ${params.finding ?? params.project}.`;
      return { content: [{ type: "text", text }], details: { view } };
    },
    renderCall(args, theme) {
      return callLine(theme, `evidence · ${args.project}${args.finding ? ` (${args.finding})` : ""}`);
    },
    renderResult(result, { isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      if (isPartial) return partialLine(theme, "Reading evidence…");
      const d = result.details as { view: EvidenceView | null };
      if (d.view) return evidenceCard(theme, d.view);
      const what = context.args.finding ?? context.args.project;
      return linesCard(theme, { title: "Evidence", lines: [theme.fg("muted", `(no evidence parsed for ${what})`)] });
    },
  });

  pi.registerTool({
    name: "lifecycle_transition",
    label: "Transition project lifecycle",
    description:
      "Move a project to a new lifecycle state (exploration→proposed→active→analysis→reviewed→complete, or a legal demote). Rejects illegal transitions.",
    parameters: Type.Object({
      project: Type.String({ description: "Project id." }),
      state: StringEnum([...LIFECYCLE_STATES], { description: "Target lifecycle state." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      let result: { status: string };
      try {
        result = await berilExec<{ status: string }>(pi, ["lifecycle", "set", params.project, params.state]);
      } catch (err) {
        // The reviewed → complete edge is guarded by the coherence AUTO gate
        // (record-currency, filesystem-only). Overriding it is a HUMAN act:
        // confirm interactively, capture a reason, attribute it to the ORCID —
        // never silently, never headless (fail-closed like every beril gate).
        const coherenceBlock =
          err instanceof BerilError && params.state === "complete" && /blocked by coherence checks/.test(err.message);
        if (!coherenceBlock || !ctx.hasUI) throw err;
        const ok = await ctx.ui.confirm(
          "Coherence gate",
          `${err.message}\n\nThe project record is behind the work products. Override and complete anyway? (The override is recorded, attributed to your ORCID.)`,
        );
        if (!ok) throw new Error(`Completion stopped at the coherence gate: ${err.message}`);
        const reason = ((await ctx.ui.input("Override reason", "why is the record acceptable as-is?")) ?? "").trim();
        if (!reason) throw new Error("Coherence override cancelled: no reason given.");
        const who = await pi.exec("beril", ["user", "--json"], { timeout: 30_000 });
        let orcid = "";
        try {
          orcid = (JSON.parse(who.stdout) as Identity).orcid ?? "";
        } catch {
          orcid = "";
        }
        if (!orcid) throw new Error("Coherence override requires an ORCID — run `beril setup` to add one.");
        result = await berilExec<{ status: string }>(pi, [
          "lifecycle",
          "set",
          params.project,
          params.state,
          "--override-coherence",
          "--reason",
          reason,
          "--by",
          orcid,
        ]);
      }
      setActiveProject(ctx, params.project);
      // Broadcast the state the machine RETURNED (not the requested target) for the footer.
      pi.events.emit("beril:lifecycle", { project: params.project, state: result.status });
      return { content: [{ type: "text", text: `Project ${params.project} → ${result.status}` }], details: result };
    },
    renderCall(args, theme) {
      return callLine(theme, `lifecycle · ${args.project} → ${args.state}`);
    },
    renderResult(res, { isPartial }, theme, ctx) {
      if (ctx?.isError) return errorCard(theme, toolErrorText(res));
      if (isPartial) return partialLine(theme, "Updating lifecycle…");
      const d = res.details as { status: string };
      return lifecycleCard(theme, ctx.args.project, d.status);
    },
  });

  pi.registerTool({
    name: "gate_record",
    label: "Record a gate verdict",
    description:
      "Record a pass/fail verdict for a JUDGMENT gate (data-validity, feasibility, independent-review, commons-landed) in the project's beril.yaml gate ledger, with a one-line note saying why. Verdicts are append-only and auditable. Overrides are NOT available here — overriding a gate is a human act done at the gate itself. See /gates for the catalog.",
    parameters: Type.Object({
      project: Type.String({ description: "Project id." }),
      gate: StringEnum(GATE_CATALOG.filter((g) => g.type === "judgment").map((g) => g.id) as [string, ...string[]], {
        description: "The judgment gate to record.",
      }),
      verdict: StringEnum(["pass", "fail"], { description: "The recorded verdict." }),
      note: Type.String({ description: "One line: what the verdict rests on." }),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const res = await berilExec<{ gate: GateRecord }>(pi, [
        "lifecycle",
        "gate",
        params.project,
        "--record",
        params.gate,
        "--verdict",
        params.verdict,
        "--note",
        params.note,
      ]);
      return {
        content: [{ type: "text", text: `Recorded ${params.gate}: ${params.verdict} — ${params.note}` }],
        details: res,
      };
    },
    renderCall(args, theme) {
      return callLine(theme, `gate · ${args.gate} → ${args.verdict}`);
    },
    renderResult(result, { isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      if (isPartial) return partialLine(theme, "Recording gate verdict…");
      const d = result.details as { gate: GateRecord };
      return linesCard(theme, {
        title: "Gate recorded",
        lines: kvLines(theme, d.gate as unknown as Record<string, unknown>),
      });
    },
  });

  pi.registerMessageRenderer<{ recorded?: GateRecord[] }>("beril-gates", (message, _opts, theme) =>
    gateReferenceCard(theme, message.details?.recorded),
  );

  pi.registerCommand("gates", {
    description: "Show the lifecycle gate catalog in plain language, with recorded verdicts and overrides.",
    getArgumentCompletions: projectCompletions,
    async handler(args: string, ctx: ExtensionCommandContext) {
      let project = args.trim();
      if (!project) {
        const current = await berilExec<{ project?: string }>(pi, ["lifecycle", "current"]).catch(() => undefined);
        project = current?.project ?? "";
      }
      let recorded: GateRecord[] = [];
      if (project) {
        const listed = await berilExec<{ gates: GateRecord[] }>(pi, ["lifecycle", "gate", project, "--list"]).catch(
          () => undefined,
        );
        recorded = listed?.gates ?? [];
      }
      pi.sendMessage(
        {
          customType: "beril-gates",
          content: project ? `Gate reference for ${project}` : "Gate reference",
          display: true,
          details: { recorded },
        },
        { triggerTurn: false, deliverAs: "nextTurn" },
      );
      if (ctx.hasUI && !project) ctx.ui.notify("No active project — showing the catalog only.", "info");
    },
  });

  pi.registerTool({
    name: "beril_user",
    label: "Get researcher identity",
    description:
      "Return the researcher identity (name, affiliation, ORCID) and whether it is complete. Required before submission.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, _ctx) {
      // `beril user --json` prints identity JSON on stdout but exits 1 when fields
      // are missing, so read stdout directly rather than via the throwing wrapper.
      const res = await pi.exec("beril", ["user", "--json"], { timeout: 30_000 });
      let identity: Identity;
      try {
        identity = JSON.parse(res.stdout) as Identity;
      } catch {
        throw new Error(`beril user: unexpected output: ${res.stdout.slice(0, 200)}${res.stderr}`);
      }
      const details = { ...identity, complete: res.code === 0 };
      const text = `Researcher: ${identity.name || "(unset)"} · ${identity.affiliation || "(unset)"} · ORCID ${identity.orcid || "(unset)"}`;
      return { content: [{ type: "text", text }], details };
    },
    renderCall(_args, theme) {
      return callLine(theme, "researcher identity");
    },
    renderResult(result, { isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      if (isPartial) return partialLine(theme, "Reading identity…");
      return userCard(
        theme,
        result.details as { name?: string; affiliation?: string; orcid?: string; complete?: boolean },
      );
    },
  });

  pi.registerTool({
    name: "lakehouse_submit",
    label: "Submit project to lakehouse",
    description:
      "Irreversibly upload an approved project to the BERDL lakehouse (clears and replaces the remote archive). Requires a prior ORCID-gated approval.",
    parameters: Type.Object({
      project: Type.String({ description: "Project id." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      await requireReady(pi);
      // Exit 2 (partial archive) and exit 1 both surface as a thrown BerilError.
      const manifest = await berilExec<Record<string, unknown>>(pi, ["submit", params.project]);
      setActiveProject(ctx, params.project);
      const files = manifest.file_count != null ? `${manifest.file_count} files` : "archived";
      const key = manifest.archive_key != null ? ` → ${manifest.archive_key}` : "";
      return {
        content: [{ type: "text", text: `Submitted ${params.project} (${files})${key}.` }],
        details: manifest,
      };
    },
    renderCall(args, theme) {
      return callLine(theme, `submit → lakehouse · ${args.project} (irreversible)`);
    },
    renderResult(result, { isPartial }, theme, ctx) {
      if (ctx?.isError) return errorCard(theme, toolErrorText(result));
      if (isPartial) return partialLine(theme, "Uploading to lakehouse…");
      const manifest = result.details as Record<string, unknown>;
      return destructiveResultCard(theme, `Submitted ${ctx.args.project}`, kvLines(theme, manifest));
    },
  });

  // --- Commands: orchestration; scientific judgment lives in the matching skills ---

  pi.registerCommand("synthesize", {
    description: "Synthesize results into REPORT.md for a project (delegates to the synthesize skill).",
    getArgumentCompletions: projectCompletions,
    async handler(args: string, ctx: ExtensionCommandContext) {
      const project = args.trim();
      if (!project) {
        if (ctx.hasUI) ctx.ui.notify("Usage: /synthesize <project>", "warning");
        return;
      }
      setActiveProject(ctx, project);
      pi.sendUserMessage(
        `Follow the synthesize skill to interpret the analysis for project "${project}" and write REPORT.md. Before lifecycle_transition, update first-class claims: call claim_state with persist=true after drafting REPORT.md, then run claim_ledger and evidence on the weakest findings. Search for refuting literature/checks with lit_stance or /literature-review and offer /berdl-refute ${project}; empty Refutes slots must say what was searched. Only when REPORT.md and claims.json are current should you call lifecycle_transition to move "${project}" to "analysis".`,
      );
    },
  });

  pi.registerCommand("submit", {
    description: "Submit an approved project to the lakehouse (ORCID-gated, irreversible).",
    getArgumentCompletions: projectCompletions,
    async handler(args: string, ctx: ExtensionCommandContext) {
      const project = args.trim();
      if (!project) {
        if (ctx.hasUI) ctx.ui.notify("Usage: /submit <project>", "warning");
        return;
      }
      setActiveProject(ctx, project);
      // ORCID gate — read identity from stdout regardless of exit code.
      const res = await pi.exec("beril", ["user", "--json"], { timeout: 30_000 });
      let identity: Identity;
      try {
        identity = JSON.parse(res.stdout) as Identity;
      } catch {
        if (ctx.hasUI) ctx.ui.notify("Could not read researcher identity. Run `beril setup`.", "error");
        return;
      }
      if (!identity.orcid) {
        if (ctx.hasUI) ctx.ui.notify("No ORCID configured — cannot submit. Run `beril setup` to add it.", "error");
        return;
      }
      if (!ctx.hasUI) {
        throw new Error(
          `/submit ${project} blocked in non-interactive mode; irreversible submission requires UI approval.`,
        );
      }
      const preflight = await collectReviewPreflight(pi, ctx.cwd, project);
      if (!preflight.submitReady) {
        const problems = submitReadinessProblems(preflight);
        ctx.ui.notify(`Submission blocked by review preflight: ${problems.join("; ")}`, "error");
        return;
      }
      // Destructive: confirm in-session (the safety gate covers the model-tool path, not this command path).
      const ok = await ctx.ui.confirm(
        `Submit "${project}"?`,
        `This irreversibly replaces the remote archive, attributed to ORCID ${identity.orcid}. Proceed?`,
      );
      if (!ok) {
        ctx.ui.notify("Submission cancelled.", "info");
        return;
      }
      // Regenerate the RO-Crate metadata so every submission carries an
      // interoperable provenance package (derived artifact — best-effort).
      try {
        await berilExec(pi, ["crate", project]);
      } catch (err) {
        if (ctx.hasUI) ctx.ui.notify(`RO-Crate metadata not written: ${(err as Error).message}`, "warning");
      }
      try {
        const manifest = await berilExec<Record<string, unknown>>(pi, ["submit", project]);
        await berilExec(pi, ["lifecycle", "marker", project, "--kind", "submitted"]);
        // A marker, not a state transition: signal submission distinctly, never claim a lifecycle state.
        pi.events.emit("beril:submitted", { project });
        // Land findings/gaps/lessons in the knowledge commons at the finalize
        // seam (KOROS D115): cumulative memory, dedup'd, project-visibility.
        const landed = await berilExec<{ landed: number; skipped_duplicates: number }>(pi, [
          "commons",
          "land",
          project,
          "--from-report",
        ]).catch(() => undefined);
        if (ctx.hasUI) {
          const files = manifest.file_count != null ? ` (${manifest.file_count} files)` : "";
          const commons = landed ? ` Commons: ${landed.landed} entr(ies) landed.` : "";
          ctx.ui.notify(`Submitted ${project}${files}.${commons}`, "info");
        }
      } catch (err) {
        await berilExec(pi, ["lifecycle", "marker", project, "--kind", "failed"]).catch(() => {});
        if (ctx.hasUI) ctx.ui.notify(`Submission failed: ${(err as Error).message}`, "error");
        throw err;
      }
    },
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.setStatus(PROJECT_STATUS_KEY, undefined);
  });

  pi.on("session_start", (event, ctx) => {
    const freshStart = event.reason === "startup" && process.env.BERIL_START_SESSION_MODE === "fresh";
    if (event.reason !== "new" && !freshStart) return;
    activeProject = undefined;
    if (ctx.hasUI) ctx.ui.setStatus(PROJECT_STATUS_KEY, undefined);
  });
}
