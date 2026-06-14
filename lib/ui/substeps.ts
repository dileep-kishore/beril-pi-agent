import { basename } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { glyph } from "./glyphs.ts";

/**
 * The live lifecycle sub-step overlay: a TUI-only line *under* the phase rail
 * showing progress *within* the current lifecycle phase, derived strictly from
 * observed `tool_execution_*` events — never a model-authored todo. Bounded by a
 * static per-phase manifest, so it is O(manifest), not O(tool calls): a phase has
 * a fixed handful of named steps, each owned by a set of tool names, and a step
 * lights up only when one of its tools actually runs.
 *
 * Pure + strip-safe (plain interfaces, a const `Record`, and functions — no enum,
 * param-props, or namespace). The `beril-env` extension owns the live state and
 * the `setWidget` call; this module just maps events → state → a rendered line.
 */

/** A single named step within a phase, owned by a set of registerTool(...) names. */
export interface SubstepDef {
  key: string;
  label: string;
  /** Tool names that mark this step active — must mirror registerTool(...) names. */
  tools: string[];
}

/** The live status of one sub-step as the phase progresses. */
export type SubstepStatus = "pending" | "active" | "done" | "failed";

/** One sub-step's live state: its definition plus status + an optional one-line detail. */
export interface SubstepInstance {
  key: string;
  label: string;
  status: SubstepStatus;
  /** A short, tool-derived detail for the active step (e.g. a notebook name). */
  detail?: string;
}

/** The whole overlay's state for the current phase: the phase string + its steps in order. */
export interface SubstepState {
  /** The rail phase this overlay is for (`""` for a phase with no manifest entry). */
  phase: string;
  steps: SubstepInstance[];
}

/**
 * The per-phase manifest, keyed by the **rail phase string** (`currentStep`'s
 * return). Only `explore`/`plan`/`analyze` have entries — `review`/`submit`/
 * `complete`/unknown map to an empty overlay, which is correct: review/submit run
 * in an isolated subagent session whose tool calls never surface on this bus.
 *
 * Tool names mirror `registerTool(...)` names exactly; a rename there without a
 * matching edit here is a silent drop (UI-only, no functional impact) — caught in
 * review, not at runtime.
 */
const PHASE_SUBSTEPS: Record<string, SubstepDef[]> = {
  explore: [
    { key: "discover", label: "discover", tools: ["berdl_discover", "berdl_peek", "berdl_feasibility"] },
    { key: "query", label: "query", tools: ["berdl_query"] },
    { key: "search", label: "search", tools: ["lit_search", "lit_fetch", "lit_abstract", "web_read", "docs_lookup"] },
    { key: "screen", label: "screen", tools: ["lit_stance"] },
  ],
  plan: [{ key: "plan", label: "plan", tools: ["research_plan"] }],
  analyze: [
    { key: "scaffold", label: "scaffold", tools: ["notebook_scaffold"] },
    { key: "run", label: "run", tools: ["notebook_run"] },
    { key: "hash", label: "hash", tools: ["notebook_hash"] },
    { key: "promote", label: "promote", tools: ["lifecycle_transition"] },
  ],
};

/** Reverse index `toolName → { phase, key }`, built once at module load. */
const toolToStep: Record<string, { phase: string; key: string }> = (() => {
  const index: Record<string, { phase: string; key: string }> = {};
  for (const phase of Object.keys(PHASE_SUBSTEPS)) {
    for (const def of PHASE_SUBSTEPS[phase]) {
      for (const tool of def.tools) index[tool] = { phase, key: def.key };
    }
  }
  return index;
})();

/**
 * The fresh sub-step state for a lifecycle phase — accepts `undefined` because
 * `currentStep` returns `undefined`/`"complete"`. Any phase with no manifest entry
 * (review/submit/complete/unknown) returns an empty overlay (no steps).
 */
export function substepsForPhase(phase: string | undefined): SubstepState {
  const defs = phase ? PHASE_SUBSTEPS[phase] : undefined;
  if (!defs) return { phase: phase ?? "", steps: [] };
  return {
    phase: phase ?? "",
    steps: defs.map((d) => ({ key: d.key, label: d.label, status: "pending" as SubstepStatus })),
  };
}

/**
 * Mark the step that owns `toolName` active, marking earlier steps `done`
 * (monotonic forward — a later tool never reopens a finished step). Returns the
 * **same reference** when nothing changed (the tool is not in this phase, or its
 * step is already `active`) — the mandatory no-op short-circuit, without which
 * every tool call would repaint the HUD.
 */
export function applyToolStart(s: SubstepState, toolName: string, args: unknown): SubstepState {
  const target = toolToStep[toolName];
  if (!target || target.phase !== s.phase) return s;
  const idx = s.steps.findIndex((step) => step.key === target.key);
  if (idx < 0) return s;
  const detail = detailFromArgs(toolName, args);
  if (s.steps[idx].status === "active" && s.steps[idx].detail === detail) return s;
  return {
    phase: s.phase,
    steps: s.steps.map((step, i) => {
      // Earlier steps are superseded → done (but a recorded failure stays failed).
      if (i < idx) return step.status === "pending" || step.status === "active" ? { ...step, status: "done" } : step;
      if (i === idx) return { ...step, status: "active", detail };
      return step;
    }),
  };
}

/**
 * Mark the step that owns `toolName` `done` (or `failed` on error). Returns the
 * **same reference** when nothing changed (unknown tool, wrong phase, or the step
 * already at the target status).
 */
export function applyToolEnd(s: SubstepState, toolName: string, isError: boolean): SubstepState {
  const target = toolToStep[toolName];
  if (!target || target.phase !== s.phase) return s;
  const idx = s.steps.findIndex((step) => step.key === target.key);
  if (idx < 0) return s;
  const next: SubstepStatus = isError ? "failed" : "done";
  if (s.steps[idx].status === next) return s;
  return {
    phase: s.phase,
    steps: s.steps.map((step, i) => (i === idx ? { ...step, status: next, detail: undefined } : step)),
  };
}

/**
 * A short, tool-derived detail for the active step. `args` is typed `any` at the
 * event boundary, so treat it as `unknown` and guard every field access; never
 * throws. Returns `undefined` when there is nothing useful to show.
 */
export function detailFromArgs(toolName: string, args: unknown): string | undefined {
  if (args == null || typeof args !== "object") return undefined;
  const a = args as Record<string, unknown>;
  if (toolName === "notebook_run") {
    if (typeof a.notebook !== "string" || !a.notebook) return undefined;
    return basename(a.notebook).replace(/\.ipynb$/, "");
  }
  if (toolName === "berdl_discover") {
    return typeof a.database === "string" && a.database ? a.database : undefined;
  }
  if (toolName === "lit_search") {
    if (typeof a.query !== "string" || !a.query) return undefined;
    return a.query.length > 40 ? `${a.query.slice(0, 40)}…` : a.query;
  }
  return undefined;
}

/**
 * Render the sub-step overlay as one line, or `undefined` when there is nothing to
 * show (empty manifest). Mirrors `step-rail.ts`'s glyph>word>color channel
 * ordering: done dim `✓`, active accent-bold `▸` (+ detail), failed error `✗`,
 * pending muted `○`. Uses `glyph(name)` (NO_COLOR-aware), never the raw `GLYPH`.
 */
export function substepRail(theme: Pick<Theme, "fg" | "bold">, s: SubstepState): string | undefined {
  if (s.steps.length === 0) return undefined;
  const sep = theme.fg("dim", ` ${glyph("arrow")} `);
  return s.steps
    .map((step) => {
      if (step.status === "done") return theme.fg("dim", `${glyph("ok")} ${step.label}`);
      if (step.status === "failed") return theme.fg("error", `${glyph("bad")} ${step.label}`);
      if (step.status === "active") {
        const label = step.detail ? `${step.label} ${step.detail}` : step.label;
        return theme.bold(theme.fg("accent", `${glyph("here")} ${label}`));
      }
      return theme.fg("muted", `${glyph("pending")} ${step.label}`);
    })
    .join(sep);
}
