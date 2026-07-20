import type { Model } from "@earendil-works/pi-ai";
import {
  type ExtensionCommandContext,
  type ModelRegistry,
  type ResourceLoader,
  SessionManager,
  createAgentSession,
  createExtensionRuntime,
} from "@earendil-works/pi-coding-agent";
import { resolveModelReference, resolveRoleModel } from "./model-roles.ts";
import { parallelMap } from "./parallel-map.ts";
import { REVIEW_PANEL, type SpecialistSpec } from "./review-rubric.ts";

/** Default reviewer model — direct Anthropic Opus 4.8 (1M ctx). */
const DEFAULT_REVIEW_MODEL = "claude-opus-4-8";

/**
 * The read-only tool allowlist every review subagent (single or panel) is built
 * with — by construction it can never reach a destructive tool, `bash`, `edit`,
 * or `write`. The fan-out safety invariant is a test over this constant.
 */
export const REVIEW_TOOLS = ["read", "grep", "find", "ls"] as const;

/** The minimal session surface {@link runReviewSubagent} drives. */
export interface ReviewSession {
  prompt(text: string): Promise<void>;
  getLastAssistantText(): string | undefined;
  abort(): Promise<void>;
  dispose(): void;
}

export interface ReviewRequest {
  /** Project directory the reviewer reads (read-only). */
  projectDir: string;
  /** Self-sufficient reviewer system prompt (replaces Pi's default persona). */
  rubric: string;
  /** The instruction sent as the single user turn. */
  task: string;
  /** Override the default reviewer model by id. */
  modelOverride?: string;
}

/**
 * Builds the session that runs the review. Injectable so tests can substitute a
 * fake (no real LLM). The default builds an isolated, read-only Pi session.
 */
export type SessionFactory = (cfg: {
  model: Model<any>;
  cwd: string;
  rubric: string;
  modelRegistry: ModelRegistry;
}) => Promise<ReviewSession>;

/**
 * An isolated `ResourceLoader`: empty extensions/skills/prompts/themes so the
 * child session never re-loads the `beril-*` extensions or the safety gate, and
 * `getSystemPrompt` returns the rubric (which REPLACES Pi's default persona —
 * the rubric is therefore self-sufficient).
 */
export function isolatedLoader(rubric: string): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => rubric,
    getAppendSystemPrompt: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

/** The default factory: an isolated, read-only Pi review session. */
const defaultFactory: SessionFactory = async ({ model, cwd, rubric, modelRegistry }) => {
  const { session } = await createAgentSession({
    model,
    cwd,
    tools: [...REVIEW_TOOLS],
    resourceLoader: isolatedLoader(rubric),
    sessionManager: SessionManager.inMemory(cwd),
    modelRegistry,
  });
  return session as ReviewSession;
};

/**
 * Run an isolated, read-only review subagent and return its review markdown.
 *
 * Resolves the reviewer model — an explicit override (`provider/modelId` or a
 * bare id, e.g. a CBORG alias), else the `review` role (`BERIL_REVIEW_MODEL`),
 * else Opus 4.8 — via the registry, so custom-provider models resolve too. If
 * the chosen model has no resolvable auth, falls back to the parent session's
 * `ctx.model`. Bails with a clear error if neither is usable. Wires
 * `ctx.signal` to `session.abort()` and disposes the session in `finally`.
 */
export async function runReviewSubagent(
  ctx: Pick<ExtensionCommandContext, "model" | "modelRegistry" | "signal">,
  req: ReviewRequest,
  factory: SessionFactory = defaultFactory,
): Promise<string> {
  const chosen = req.modelOverride
    ? resolveModelReference(ctx.modelRegistry, req.modelOverride, "anthropic")
    : resolveRoleModel(ctx, "review", { provider: "anthropic", model: DEFAULT_REVIEW_MODEL });
  let model: Model<any> | undefined;
  if (chosen) {
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(chosen);
    if (auth.ok) model = chosen;
  }
  // Fall back to the parent session's model when the chosen one has no auth.
  if (!model) model = ctx.model;
  if (!model) throw new Error("no usable model/auth for review");

  const session = await factory({
    model,
    cwd: req.projectDir,
    rubric: req.rubric,
    modelRegistry: ctx.modelRegistry,
  });
  const onAbort = () => {
    void session.abort();
  };
  ctx.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    await session.prompt(req.task);
    return session.getLastAssistantText() ?? "";
  } finally {
    ctx.signal?.removeEventListener("abort", onAbort);
    session.dispose();
  }
}

/** One specialist's panel result — its markdown section, or null + the error. */
export interface PanelResult {
  spec: SpecialistSpec;
  text: string | null;
  error?: string;
}

/**
 * Run N specialist reviewers CONCURRENTLY over the same project, each an isolated
 * read-only subagent via {@link runReviewSubagent} (so the read-only allowlist is
 * inherited, not re-implemented). Bounded by `concurrency` (default: panel size).
 * One failing panelist is captured as `{ text: null, error }`, never sinking the
 * batch. `ctx.signal` aborts every in-flight panelist through runReviewSubagent.
 */
export async function runReviewPanel(
  ctx: Pick<ExtensionCommandContext, "model" | "modelRegistry" | "signal">,
  opts: {
    projectDir: string;
    project: string;
    modelOverride?: string;
    panel?: readonly SpecialistSpec[];
    concurrency?: number;
  },
  factory: SessionFactory = defaultFactory,
): Promise<PanelResult[]> {
  const panel = opts.panel ?? REVIEW_PANEL;
  // CBORG asks on-prem clients to hold to <=5 parallel requests (no-op for the
  // default 4-specialist panel; bites only for custom panels).
  const cap = process.env.BERIL_MODEL_PROVIDER === "cborg" ? 5 : Number.POSITIVE_INFINITY;
  const settled = await parallelMap(panel, Math.min(opts.concurrency ?? panel.length, cap), (spec) =>
    runReviewSubagent(
      ctx,
      {
        projectDir: opts.projectDir,
        rubric: spec.rubric,
        task: `Review project "${opts.project}" at ${opts.projectDir} against your rubric. Output only your assigned section.`,
        modelOverride: opts.modelOverride,
      },
      factory,
    ),
  );
  return panel.map((spec, i) => {
    const r = settled[i];
    return r.ok ? { spec, text: r.value } : { spec, text: null, error: r.error.message };
  });
}

/** Strip a single leading YAML frontmatter block (`---\n…\n---`) from markdown. Pure. */
export function stripFrontmatter(md: string): string {
  return md.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

/**
 * Merge specialist panel results into ONE review document: a single panel
 * frontmatter + `# Panel Review` title, then each panelist's section (its own
 * frontmatter stripped, since the merge owns the header). A failed/empty panelist
 * becomes an explicit "did not complete" stub so the gap is visible, not silent.
 * Pure — the caller still owns the report_hash footer. `dateISO` is YYYY-MM-DD.
 */
export function mergePanelReviews(project: string, results: PanelResult[], dateISO: string): string {
  const head = `---\nreviewer: BERIL Multi-Specialist Panel\ndate: ${dateISO}\nproject: ${project}\n---\n\n# Panel Review: ${project}\n`;
  const sections = results.map((r) => {
    const body = (r.text ?? "").trim();
    if (!body) return `## ${r.spec.title}\n\n_Reviewer did not complete${r.error ? `: ${r.error}` : ""}._\n`;
    return stripFrontmatter(body);
  });
  return `${head}\n${sections.join("\n\n")}\n`;
}
