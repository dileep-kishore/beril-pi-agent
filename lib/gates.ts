/**
 * The lifecycle gate registry — the one place that turns beril's EXISTING,
 * scattered enforcement (analysis-gate validators, ORCID sign-off, feasibility
 * probes, the coherence check) into a single legible catalog a scientist can
 * read. KOROS's two-arm finding was that mechanically walling gates adds ~nothing
 * for capable agents; the win is LEGIBILITY — telling the human, in plain
 * language, what each seam checks, what their move is, and who decides. So this
 * file carries no enforcement: it maps edges to gate definitions and merges in
 * whatever verdicts/overrides were actually recorded (`beril lifecycle gate`).
 *
 * Every `what`/`needs`/`whoDecides` is deliberately jargon-free — no tool names,
 * no doc references — because this is the text a researcher reads at a checkpoint.
 */

export type GateType = "auto" | "judgment" | "human";

/** A gate on a lifecycle edge — what it checks and who resolves it, in plain words. */
export interface GateDef {
  /** Stable id, e.g. "data-validity". */
  id: string;
  /** The lifecycle edge it guards, e.g. "active→analysis". */
  edge: string;
  /** auto = checked from the files · judgment = a recorded call · human = your sign-off. */
  type: GateType;
  /** Plain-language description of what the gate confirms. */
  what: string;
  /** The reader's move to satisfy it, in plain words. */
  needs: string;
  /** Who resolves it: "you" | "the record" | "a recorded judgment". */
  whoDecides: string;
}

/**
 * A recorded gate outcome, appended to `beril.yaml`'s `gates:` list. A plain
 * verdict carries `verdict` (+ optional `note`); a human override carries
 * `override: true` (+ `reason`, `by`). Readers take the LAST entry per gate id.
 */
export interface GateRecord {
  gate: string;
  verdict?: "pass" | "fail";
  override?: boolean;
  note?: string;
  reason?: string;
  by?: string;
  at: string;
}

/**
 * The catalog: maps beril's existing enforcement points (plus the two new
 * KOROS-mined ones — data-validity and coherence) to legible gates. Order is
 * the lifecycle order, so grouping by `edge` walks the research arc top to bottom.
 */
export const GATE_CATALOG: readonly GateDef[] = [
  {
    id: "commons-check",
    edge: "exploration→proposed",
    type: "auto",
    what: "Looks for prior work on this question in your shared memory before you commit to it.",
    needs: "nothing — it runs on its own when you start.",
    whoDecides: "the record",
  },
  {
    id: "feasibility",
    edge: "exploration→proposed",
    type: "judgment",
    what: "Confirms the data can actually answer the question you are about to propose.",
    needs: "run a feasibility check and record whether it can.",
    whoDecides: "a recorded judgment",
  },
  {
    id: "plan-approval",
    edge: "proposed→active",
    type: "human",
    what: "Gets your go-ahead on the research plan before any analysis starts.",
    needs: "you approve the plan at the checkpoint.",
    whoDecides: "you",
  },
  {
    id: "report-present",
    edge: "active→analysis",
    type: "auto",
    what: "Confirms a written report exists to hold the results.",
    needs: "nothing — it is read from the files.",
    whoDecides: "the record",
  },
  {
    id: "claims-present",
    edge: "active→analysis",
    type: "auto",
    what: "Confirms at least one claim has been written down.",
    needs: "nothing — it is read from the files.",
    whoDecides: "the record",
  },
  {
    id: "data-validity",
    edge: "active→analysis",
    type: "judgment",
    what: "Checks the data for quiet traps — stand-in zeros, numbers stored as text, repeated measurements posing as independent ones.",
    needs: "run a data-validity check and record what you decided about the warnings.",
    whoDecides: "a recorded judgment",
  },
  {
    id: "independent-review",
    edge: "analysis→reviewed",
    type: "judgment",
    what: "Has a fresh reviewer read the report and point out gaps you may have missed.",
    needs: "run a review and record the outcome.",
    whoDecides: "a recorded judgment",
  },
  {
    id: "orcid-signoff",
    edge: "analysis→reviewed",
    type: "human",
    what: "Puts your name on the results — you stand behind them under your identity.",
    needs: "you sign off with your ORCID.",
    whoDecides: "you",
  },
  {
    id: "coherence",
    edge: "reviewed→complete",
    type: "auto",
    what: "Confirms the report, the claims, and the saved record are all up to date with each other.",
    needs: "nothing — it is read from the files; you can override it with a reason if you disagree.",
    whoDecides: "the record",
  },
  {
    id: "commons-landed",
    edge: "reviewed→complete",
    type: "judgment",
    what: "Saves what you learned — including what did not work — back to your shared memory for the next project.",
    needs: "land the findings and record that you did.",
    whoDecides: "a recorded judgment",
  },
] as const;

/** Gates guarding the `from→to` edge, in catalog order. */
export function gatesForEdge(from: string, to: string): GateDef[] {
  const edge = `${from}→${to}`;
  return GATE_CATALOG.filter((g) => g.edge === edge);
}

/**
 * The current verdict/override per gate id: the LAST record wins, because
 * recording is append-only and a re-record supersedes by being later in the list.
 */
export function latestVerdicts(records: GateRecord[]): Map<string, GateRecord> {
  const latest = new Map<string, GateRecord>();
  for (const r of records ?? []) {
    if (r?.gate) latest.set(r.gate, r);
  }
  return latest;
}

/** " → "-joined edge for display (e.g. "active → analysis"). */
function displayEdge(edge: string): string {
  return edge.split("→").join(" → ");
}

/** One recorded outcome as a compact trailing phrase, or "" when nothing is recorded. */
function recordedPhrase(rec: GateRecord | undefined): string {
  if (!rec) return "";
  if (rec.override) {
    const by = rec.by ? ` by ${rec.by}` : "";
    const why = rec.reason ? `: ${rec.reason}` : "";
    return ` · overridden${by}${why}`;
  }
  if (rec.verdict) {
    const by = rec.by ? ` by ${rec.by}` : "";
    return ` · ${rec.verdict}${by}`;
  }
  return "";
}

/**
 * The `/gates` body as plain lines: the catalog grouped by lifecycle edge, each
 * gate on one line with its plain-language `what`, a `needs`/`whoDecides` line,
 * and — when present — the recorded verdict/override merged in. Pure; no styling
 * (the TUI card in `lib/ui` reskins this same structure).
 */
export function formatGateReference(recorded?: GateRecord[]): string[] {
  const latest = latestVerdicts(recorded ?? []);
  const lines: string[] = [];
  let lastEdge: string | undefined;
  for (const gate of GATE_CATALOG) {
    if (gate.edge !== lastEdge) {
      if (lines.length) lines.push("");
      lines.push(displayEdge(gate.edge));
      lastEdge = gate.edge;
    }
    lines.push(`  ${gate.id} [${gate.type}]  ${gate.what}${recordedPhrase(latest.get(gate.id))}`);
    lines.push(`      ${gate.needs}  ·  decided by ${gate.whoDecides}`);
  }
  return lines;
}
