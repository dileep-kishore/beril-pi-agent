import assert from "node:assert/strict";
import { test } from "node:test";
import { type ReviewSession, isolatedLoader, runReviewSubagent } from "../lib/review-agent.ts";

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
  // Override model resolves but its auth is {ok:false}; ctx.model exists → use it,
  // and the factory still runs (no throw).
  const { session } = fakeSession("## Review\nfallback");
  const ctx: any = {
    model: MODEL,
    modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: false, error: "no key" }) },
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
