import { getModel } from "@earendil-works/pi-ai";
import type { Model } from "@earendil-works/pi-ai";
import {
  type ExtensionCommandContext,
  type ModelRegistry,
  type ResourceLoader,
  SessionManager,
  createAgentSession,
  createExtensionRuntime,
} from "@earendil-works/pi-coding-agent";

/** Default reviewer model — direct Anthropic Opus 4.8 (1M ctx). */
const DEFAULT_REVIEW_MODEL = "claude-opus-4-8";

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
    tools: ["read", "grep", "find", "ls"],
    resourceLoader: isolatedLoader(rubric),
    sessionManager: SessionManager.inMemory(cwd),
    modelRegistry,
  });
  return session as ReviewSession;
};

/** `getModel` is statically typed against known ids; loosen for a runtime id string. */
const getModelLoose = getModel as unknown as (provider: string, modelId: string) => Model<any> | undefined;

/**
 * Run an isolated, read-only review subagent and return its review markdown.
 *
 * Resolves the reviewer model (override or Opus 4.8); if that model has no
 * resolvable auth, falls back to the parent session's `ctx.model`. Bails with a
 * clear error if neither is usable. Wires `ctx.signal` to `session.abort()` and
 * disposes the session in `finally`.
 */
export async function runReviewSubagent(
  ctx: Pick<ExtensionCommandContext, "model" | "modelRegistry" | "signal">,
  req: ReviewRequest,
  factory: SessionFactory = defaultFactory,
): Promise<string> {
  const chosen = getModelLoose("anthropic", req.modelOverride ?? DEFAULT_REVIEW_MODEL);
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
