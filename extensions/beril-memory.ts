import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { berilExec } from "../lib/beril-exec.ts";
import { type ClaimTally, parseClaimLedger, tallyClaims } from "../lib/claim-ledger.ts";
import { type ResearchStateSnapshot, buildSnapshot, formatReinjection } from "../lib/session-state.ts";

/**
 * Cross-session research-state memory.
 *
 * A long arc loses its thread when Pi compacts the conversation. This extension
 * flushes a small, tool-derived snapshot to `beril.yaml` (via the Python CLI —
 * TS never writes YAML) at `session_before_compact`, and re-injects it as
 * clearly-labelled *background* context on the first turn after compaction so
 * the agent never re-asks "which project are we on?". The block carries only
 * counts + identifiers, never claim text or a verdict, so an unverified claim
 * cannot be laundered back in as fact.
 *
 * It registers NO tool — there is no card and no `renderResult` surface; the
 * re-injection is plain ASCII appended to the system prompt. It is not
 * destructive (it writes a non-authoritative annotation block, not lifecycle
 * state or remote data) so it stays outside `lib/destructive.ts` and the
 * beril-safety gate — but the project-trust guard still applies (fail-closed):
 * an untrusted project gets neither a flush nor a re-injection.
 */
export default function berilMemory(pi: ExtensionAPI) {
  // The scientist's most recent checkpoint choice, captured from the shared bus
  // (`beril:checkpoint`, emitted by beril-checkpoint). A tool-derived fact, not
  // model prose. Stays undefined until a checkpoint resolves — and the emit is
  // added by a separate item, so this listener tolerates its total absence.
  let lastCheckpoint: string | undefined;
  // One-shot: a compaction just happened, so the next turn re-injects. Armed by
  // `session_compact`, disarmed after the first `before_agent_start` consumes it.
  let pendingReinject = false;

  // Stash the raw `title -> choice`; buildSnapshot owns the single-line clamp.
  pi.events.on("beril:checkpoint", (data) => {
    const d = data as { title?: string; choice?: string };
    const title = (d.title ?? "").trim();
    const choice = (d.choice ?? "").trim();
    if (!choice) return;
    lastCheckpoint = `${title} -> ${choice}`;
  });

  /** Parse a project's plan + report into a claim tally (best-effort; never throws). */
  async function readClaimTally(cwd: string, project: string): Promise<ClaimTally> {
    try {
      const dir = join(cwd, "projects", project);
      const [plan, report] = await Promise.all([
        readFile(join(dir, "RESEARCH_PLAN.md"), "utf8").catch(() => ""),
        readFile(join(dir, "REPORT.md"), "utf8").catch(() => ""),
      ]);
      return tallyClaims(parseClaimLedger(plan, report));
    } catch {
      return { total: 0, supported: 0, refuted: 0 };
    }
  }

  // Flush the snapshot just before compaction. Returns `undefined` so we neither
  // cancel the compaction nor override it — the snapshot is a side-effect. We
  // ignore `event.preparation`/`branchEntries`/`signal`: we snapshot *tool*
  // state (the active project + tally + last checkpoint), not the conversation.
  //
  // NOTE (must-confirm-live): whether Pi *awaits* this async handler before
  // compacting is not provable from the `.d.ts`. The design tolerates a late
  // flush — re-injection reads the store back on the next turn — so the worst
  // case is the snapshot landing a turn late, which is harmless.
  pi.on("session_before_compact", async (_event, ctx) => {
    if (!ctx.isProjectTrusted()) return undefined; // fail-closed on an untrusted project
    try {
      const cur = await berilExec<{ project?: string; status?: string }>(pi, ["lifecycle", "current"]);
      if (!cur.project) return undefined;
      const claims = await readClaimTally(ctx.cwd, cur.project);
      const snap = buildSnapshot({
        project: cur.project,
        phase: cur.status ?? "",
        claims,
        lastCheckpoint,
      });
      // The Python CLI owns beril.yaml; it server-stamps `updated_at` and appends
      // `research_state` after the canonical keys. TS never touches YAML.
      await berilExec(pi, ["lifecycle", "session-state", cur.project, "--set", JSON.stringify(snap)]);
    } catch {
      // best-effort: a missing/unreadable project must never block compaction
    }
    return undefined;
  });

  // `session_compact` fires AFTER compaction — the only reliable "a compaction
  // just happened" signal. Arm the one-shot so the next turn re-injects once.
  pi.on("session_compact", () => {
    pendingReinject = true;
  });

  // On the first post-compaction turn, append the formatted block to the system
  // prompt (NOT a transcript message, which would read as a fresh finding). Pi
  // chains this with the conduct append. Short-circuit BEFORE any berilExec so a
  // normal turn pays zero cost; read the snapshot back from `beril.yaml` (the
  // store is the source of truth — a compaction can fire in a resumed session
  // that never flushed).
  pi.on("before_agent_start", async (event, ctx) => {
    if (!pendingReinject) return undefined;
    // Consume the one-shot regardless of trust, so a compaction that happened while
    // untrusted can't replay a stale snapshot if trust is granted later this session.
    pendingReinject = false;
    if (!ctx.isProjectTrusted()) return undefined; // fail-closed: no re-injection on an untrusted project
    try {
      const cur = await berilExec<{ project?: string }>(pi, ["lifecycle", "current"]);
      if (!cur.project) return undefined;
      const res = await berilExec<ResearchStateSnapshot | Record<string, never>>(pi, [
        "lifecycle",
        "session-state",
        cur.project,
        "--get",
      ]);
      if (!res || typeof res !== "object" || !("project" in res) || !res.project) return undefined;
      return { systemPrompt: `${event.systemPrompt}\n\n${formatReinjection(res as ResearchStateSnapshot)}` };
    } catch {
      return undefined;
    }
  });
}
