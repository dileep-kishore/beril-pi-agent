import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { berilExec } from "../lib/beril-exec.ts";
import { requireReady } from "../lib/readiness.ts";
import {
  callLine,
  destructiveResultCard,
  hashCard,
  lifecycleCard,
  partialLine,
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
  if (ctx.hasUI) ctx.ui.setStatus(PROJECT_STATUS_KEY, `▣ ${project}`);
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
      return { content: [{ type: "text", text: JSON.stringify(hashes, null, 2) }], details: hashes };
    },
    renderCall(args, theme) {
      return callLine(theme, `hash · ${args.project}`);
    },
    renderResult(result, { isPartial }, theme) {
      if (isPartial) return partialLine(theme, "Hashing notebooks…");
      return hashCard(theme, result.details as Record<string, string>);
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
      const result = await berilExec<{ status: string }>(pi, ["lifecycle", "set", params.project, params.state]);
      setActiveProject(ctx, params.project);
      // Broadcast the state the machine RETURNED (not the requested target) for the footer.
      pi.events.emit("beril:lifecycle", { project: params.project, state: result.status });
      return { content: [{ type: "text", text: `Project ${params.project} → ${result.status}` }], details: result };
    },
    renderCall(args, theme) {
      return callLine(theme, `lifecycle · ${args.project} → ${args.state}`);
    },
    renderResult(res, { isPartial }, theme, ctx) {
      if (isPartial) return partialLine(theme, "Updating lifecycle…");
      const d = res.details as { status: string };
      return lifecycleCard(theme, ctx.args.project, d.status);
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
    renderResult(result, { isPartial }, theme) {
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
      return {
        content: [{ type: "text", text: `Submitted ${params.project}: ${JSON.stringify(manifest)}` }],
        details: manifest,
      };
    },
    renderCall(args, theme) {
      return callLine(theme, `submit → lakehouse · ${args.project} (irreversible)`);
    },
    renderResult(result, { isPartial }, theme, ctx) {
      if (isPartial) return partialLine(theme, "Uploading to lakehouse…");
      const manifest = result.details as Record<string, unknown>;
      return destructiveResultCard(
        theme,
        `Submitted ${ctx.args.project}`,
        JSON.stringify(manifest, null, 2).split("\n"),
      );
    },
  });

  // --- Commands: orchestration; scientific judgment lives in the matching skills ---

  pi.registerCommand("synthesize", {
    description: "Synthesize results into REPORT.md for a project (delegates to the synthesize skill).",
    async handler(args: string, ctx: ExtensionCommandContext) {
      const project = args.trim();
      if (!project) {
        if (ctx.hasUI) ctx.ui.notify("Usage: /synthesize <project>", "warning");
        return;
      }
      setActiveProject(ctx, project);
      pi.sendUserMessage(
        `Follow the synthesize skill to interpret the analysis for project "${project}" and write REPORT.md. ` +
          `When the report is complete, call the lifecycle_transition tool to move "${project}" to "analysis".`,
      );
    },
  });

  pi.registerCommand("submit", {
    description: "Submit an approved project to the lakehouse (ORCID-gated, irreversible).",
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
      // Destructive: confirm in-session (the safety gate covers the model-tool path, not this command path).
      if (ctx.hasUI) {
        const ok = await ctx.ui.confirm(
          `Submit "${project}"?`,
          `This irreversibly replaces the remote archive, attributed to ORCID ${identity.orcid}. Proceed?`,
        );
        if (!ok) {
          ctx.ui.notify("Submission cancelled.", "info");
          return;
        }
      }
      try {
        const manifest = await berilExec<Record<string, unknown>>(pi, ["submit", project]);
        await berilExec(pi, ["lifecycle", "marker", project, "--kind", "submitted"]);
        // A marker, not a state transition: signal submission distinctly, never claim a lifecycle state.
        pi.events.emit("beril:submitted", { project });
        if (ctx.hasUI) ctx.ui.notify(`Submitted ${project}: ${JSON.stringify(manifest)}`, "info");
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
}
