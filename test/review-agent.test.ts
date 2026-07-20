import assert from "node:assert/strict";
import { test } from "node:test";
import { type ReviewSession, isolatedLoader, runReviewSubagent } from "../lib/review-agent.ts";

// Model-role resolution reads BERIL_* env vars; scrub them so these tests are
// deterministic even when run from inside a CBORG beril session.
for (const k of Object.keys(process.env)) {
  if (k === "BERIL_MODEL_PROVIDER" || /^BERIL_(MAIN|FAST|REVIEW|VISION)_MODEL$/.test(k)) {
    Reflect.deleteProperty(process.env, k);
  }
}

/** A fake session whose prompt is a no-op and whose result is canned. */
function fakeSession(text: string | undefined) {
  const calls = { prompt: [] as string[], abort: 0, dispose: 0 };
  const session: ReviewSession = {
    prompt: async (t: string) => {
      calls.prompt.push(t);
    },
    getLastAssistantText: () => text,
    abort: async () => {
      calls.abort++;
    },
    dispose: () => {
      calls.dispose++;
    },
  };
  return { session, calls };
}

const MODEL = { id: "claude-opus-4-8" };

test("runReviewSubagent returns the last assistant text from an injected session", async () => {
  const { session, calls } = fakeSession("## Review\nLGTM");
  const ctx: any = {
    model: MODEL,
    modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k" }) },
    signal: undefined,
  };
  const out = await runReviewSubagent(
    ctx,
    { projectDir: "/tmp/proj", rubric: "RUBRIC", task: "Review it" },
    async () => session,
  );
  assert.equal(out, "## Review\nLGTM");
  assert.equal(calls.prompt[0], "Review it");
  // Disposed exactly once even on the happy path.
  assert.equal(calls.dispose, 1);
});

test("runReviewSubagent disposes even when prompt throws", async () => {
  const calls = { dispose: 0 };
  const session: ReviewSession = {
    prompt: async () => {
      throw new Error("boom");
    },
    getLastAssistantText: () => undefined,
    abort: async () => {},
    dispose: () => {
      calls.dispose++;
    },
  };
  const ctx: any = {
    model: MODEL,
    modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k" }) },
    signal: undefined,
  };
  await assert.rejects(() =>
    runReviewSubagent(ctx, { projectDir: "/tmp/proj", rubric: "R", task: "t" }, async () => session),
  );
  assert.equal(calls.dispose, 1);
});

test("runReviewSubagent throws a clear error when no model/auth is usable", async () => {
  // Resolved override model has no auth AND ctx.model is undefined → bail.
  const ctx: any = {
    model: undefined,
    modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: false, error: "no key" }) },
    signal: undefined,
  };
  await assert.rejects(
    () =>
      runReviewSubagent(
        ctx,
        { projectDir: "/tmp/proj", rubric: "R", task: "t" },
        async () => fakeSession("unused").session,
      ),
    /no usable model\/auth for review/i,
  );
});

test("isolatedLoader exposes no extensions/skills/prompts (Invariant 5) and the rubric as system prompt", () => {
  // The reviewer session must NOT re-load the beril-* extensions or the safety
  // gate — empty extensions is what enforces that. Pin it so a regression is caught.
  const loader = isolatedLoader("MY RUBRIC");
  assert.deepEqual(loader.getExtensions().extensions, []);
  assert.deepEqual(loader.getSkills().skills, []);
  assert.deepEqual(loader.getPrompts().prompts, []);
  assert.deepEqual(loader.getThemes().themes, []);
  assert.deepEqual(loader.getAgentsFiles().agentsFiles, []);
  assert.equal(loader.getSystemPrompt(), "MY RUBRIC");
  assert.deepEqual(loader.getAppendSystemPrompt(), []);
});

test("runReviewSubagent falls back to ctx.model when the override has no auth", async () => {
  // Override model RESOLVES via the registry but its auth is {ok:false};
  // ctx.model exists → use it, and the factory still runs (no throw).
  const { session } = fakeSession("## Review\nfallback");
  const ctx: any = {
    model: MODEL,
    modelRegistry: findableRegistry([{ provider: "anthropic", id: "claude-opus-4-8" }], false),
    signal: undefined,
  };
  let usedModel: unknown;
  const out = await runReviewSubagent(
    ctx,
    { projectDir: "/tmp/proj", rubric: "R", task: "t", modelOverride: "claude-opus-4-8" },
    async (cfg) => {
      usedModel = cfg.model;
      return session;
    },
  );
  assert.equal(out, "## Review\nfallback");
  assert.equal(usedModel, MODEL);
});

const CBORG_MODEL = { provider: "cborg", id: "lbl/cborg-deepthought" };

/** Registry stub with resolution: find over the given models + canned auth. */
function findableRegistry(models: Array<{ provider: string; id: string }>, authOk: boolean) {
  return {
    find: (provider: string, modelId: string) => models.find((m) => m.provider === provider && m.id === modelId),
    getAll: () => models,
    getApiKeyAndHeaders: async () => (authOk ? { ok: true, apiKey: "k" } : { ok: false, error: "no key" }),
  };
}

test("runReviewSubagent resolves a cborg override reference from the registry", async () => {
  const { session } = fakeSession("## Review\ncborg");
  const ctx: any = {
    model: MODEL,
    modelRegistry: findableRegistry([CBORG_MODEL], true),
    signal: undefined,
  };
  let usedModel: unknown;
  const out = await runReviewSubagent(
    ctx,
    { projectDir: "/p", rubric: "R", task: "t", modelOverride: "cborg/lbl/cborg-deepthought" },
    async (cfg) => {
      usedModel = cfg.model;
      return session;
    },
  );
  assert.equal(out, "## Review\ncborg");
  assert.equal(usedModel, CBORG_MODEL);
});

test("runReviewSubagent resolves a bare cborg override under BERIL_MODEL_PROVIDER", async () => {
  process.env.BERIL_MODEL_PROVIDER = "cborg";
  try {
    const { session } = fakeSession("## Review\nbare");
    const ctx: any = {
      model: MODEL,
      modelRegistry: findableRegistry([CBORG_MODEL], true),
      signal: undefined,
    };
    let usedModel: unknown;
    await runReviewSubagent(
      ctx,
      { projectDir: "/p", rubric: "R", task: "t", modelOverride: "lbl/cborg-deepthought" },
      async (cfg) => {
        usedModel = cfg.model;
        return session;
      },
    );
    assert.equal(usedModel, CBORG_MODEL);
  } finally {
    Reflect.deleteProperty(process.env, "BERIL_MODEL_PROVIDER");
  }
});

test("runReviewSubagent still resolves a bare anthropic override via the registry (back-compat)", async () => {
  // No BERIL_MODEL_PROVIDER: a bare built-in id must resolve under the
  // "anthropic" preferred provider exactly like the old getModel path.
  const opus = { provider: "anthropic", id: "claude-opus-4-8" };
  const { session } = fakeSession("## Review\nopus");
  const ctx: any = {
    model: { id: "session-model" },
    modelRegistry: findableRegistry([opus], true),
    signal: undefined,
  };
  let usedModel: unknown;
  await runReviewSubagent(
    ctx,
    { projectDir: "/p", rubric: "R", task: "t", modelOverride: "claude-opus-4-8" },
    async (cfg) => {
      usedModel = cfg.model;
      return session;
    },
  );
  assert.equal(usedModel, opus);
});

test("runReviewSubagent falls back to ctx.model when CBORG auth is unavailable", async () => {
  process.env.BERIL_MODEL_PROVIDER = "cborg";
  process.env.BERIL_REVIEW_MODEL = "cborg/lbl/cborg-deepthought";
  try {
    const { session } = fakeSession("## Review\nno-auth");
    const ctx: any = {
      model: MODEL,
      modelRegistry: findableRegistry([CBORG_MODEL], false),
      signal: undefined,
    };
    let usedModel: unknown;
    await runReviewSubagent(ctx, { projectDir: "/p", rubric: "R", task: "t" }, async (cfg) => {
      usedModel = cfg.model;
      return session;
    });
    assert.equal(usedModel, MODEL);
  } finally {
    Reflect.deleteProperty(process.env, "BERIL_MODEL_PROVIDER");
    Reflect.deleteProperty(process.env, "BERIL_REVIEW_MODEL");
  }
});

test("runReviewSubagent uses the review role env model when no override is given", async () => {
  process.env.BERIL_REVIEW_MODEL = "cborg/lbl/cborg-deepthought";
  try {
    const { session } = fakeSession("## Review\nrole");
    const ctx: any = {
      model: MODEL,
      modelRegistry: findableRegistry([CBORG_MODEL], true),
      signal: undefined,
    };
    let usedModel: unknown;
    await runReviewSubagent(ctx, { projectDir: "/p", rubric: "R", task: "t" }, async (cfg) => {
      usedModel = cfg.model;
      return session;
    });
    assert.equal(usedModel, CBORG_MODEL);
  } finally {
    Reflect.deleteProperty(process.env, "BERIL_REVIEW_MODEL");
  }
});
