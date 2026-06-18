import type { BerdlEnv } from "./readiness.ts";
import { currentStep, nextAction } from "./research-steps.ts";
import type { ResearchStateSnapshot } from "./session-state.ts";

/** The deterministic workflow orientation shown by /whereami and /next. */
export interface WorkflowView {
  project?: string;
  status?: string;
  phase?: string;
  next: string;
  command: string;
  actions: string[];
  claims?: { total: number; supported: number; refuted: number };
  lastCheckpoint?: string;
  env?: Pick<BerdlEnv, "location" | "ready">;
  updatedAt?: string;
}

/** A concrete next command/action for the lifecycle state — no model guessing. */
export function recommendedCommand(state?: string, project?: string): string {
  const p = project ? ` ${project}` : " <project>";
  switch (state) {
    case "exploration":
      return "/berdl-preview <table>";
    case "proposed":
      return `/analyze${p} --first-result`;
    case "active":
      return `/analyze${p} --first-result`;
    case "analysis":
      return `/berdl-review${p}`;
    case "reviewed":
      return `/submit${p}`;
    case "complete":
      return "done — reopen intentionally before changing the project";
    default:
      return "/berdl-status";
  }
}

export function recommendedActions(state?: string, project?: string): string[] {
  const p = project ? ` ${project}` : " <project>";
  switch (state) {
    case "exploration":
      return ["frame the question", "/berdl-preview <table>", `/research-plan${p}`];
    case "proposed":
      return [`/analyze${p} --first-result`, `/berdl-review${p} --plan`, "/whereami"];
    case "active":
      return [`/analyze${p} --first-result`, `/analyze${p} --continue`, `/paper-plan${p}`, "/whereami"];
    case "analysis":
      return [`/berdl-refute${p}`, `/berdl-review${p}`, `/paper-plan${p}`, `/synthesize${p}`];
    case "reviewed":
      return [`/submit${p}`, `/berdl-review${p} --panel`, `/reroll-analysis-from${p ? " first-result" : " <label>"}`];
    case "complete":
      return ["/science-memory", "/idea-tournament <topic>", "/tree"];
    default:
      return ["frame the question", "/berdl-status", "/skills"];
  }
}

/** Shape the UI view from current lifecycle state + optional persisted research_state. */
export function buildWorkflowView(
  current: { project?: string; status?: string } | undefined,
  researchState?: Partial<ResearchStateSnapshot>,
  env?: BerdlEnv,
): WorkflowView {
  const project = current?.project || researchState?.project;
  const status = current?.status || researchState?.phase;
  return {
    project,
    status,
    phase: status ? currentStep(status) : undefined,
    next: nextAction(status ?? ""),
    command: recommendedCommand(status, project),
    actions: recommendedActions(status, project),
    claims: researchState?.claims,
    lastCheckpoint: researchState?.lastCheckpoint,
    env: env ? { location: env.location, ready: env.ready } : undefined,
    updatedAt:
      typeof (researchState as { updated_at?: unknown } | undefined)?.updated_at === "string"
        ? (researchState as { updated_at?: string }).updated_at
        : undefined,
  };
}
