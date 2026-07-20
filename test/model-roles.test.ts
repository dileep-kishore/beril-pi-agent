import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveModelReference, resolveRoleModel, roleEnvName } from "../lib/model-roles.ts";

const ROLE_ENV_VARS = [
  "BERIL_MODEL_PROVIDER",
  "BERIL_MAIN_MODEL",
  "BERIL_FAST_MODEL",
  "BERIL_REVIEW_MODEL",
  "BERIL_VISION_MODEL",
];

/** Run `fn` with the given BERIL_* env vars (others cleared), restoring after. */
async function withEnv(vars: Record<string, string>, fn: () => void | Promise<void>) {
  const saved = ROLE_ENV_VARS.map((k) => [k, process.env[k]] as const);
  for (const k of ROLE_ENV_VARS) Reflect.deleteProperty(process.env, k);
  Object.assign(process.env, vars);
  try {
    await fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) Reflect.deleteProperty(process.env, k);
      else process.env[k] = v;
    }
  }
}

/** A registry over plain {provider, id} models, mirroring ModelRegistry.find/getAll. */
function fakeRegistry(models: { provider: string; id: string }[]) {
  return {
    find: (provider: string, modelId: string) => models.find((m) => m.provider === provider && m.id === modelId) as any,
    getAll: () => models as any[],
  };
}

test("roleEnvName maps roles to BERIL_*_MODEL", () => {
  assert.equal(roleEnvName("main"), "BERIL_MAIN_MODEL");
  assert.equal(roleEnvName("fast"), "BERIL_FAST_MODEL");
  assert.equal(roleEnvName("review"), "BERIL_REVIEW_MODEL");
  assert.equal(roleEnvName("vision"), "BERIL_VISION_MODEL");
});

test("resolveModelReference splits provider/modelId on the first slash only", async () => {
  await withEnv({}, () => {
    const reg = fakeRegistry([{ provider: "cborg", id: "lbl/cborg-deepthought" }]);
    const m = resolveModelReference(reg, "cborg/lbl/cborg-deepthought");
    assert.equal(m?.id, "lbl/cborg-deepthought");
    assert.equal((m as any)?.provider, "cborg");
  });
});

test("resolveModelReference resolves a bare id under BERIL_MODEL_PROVIDER", async () => {
  await withEnv({ BERIL_MODEL_PROVIDER: "cborg" }, () => {
    // "lbl/cborg-mini" contains a slash but "lbl" is not a provider — the full
    // string must be treated as the model id under the active provider.
    const reg = fakeRegistry([{ provider: "cborg", id: "lbl/cborg-mini" }]);
    const m = resolveModelReference(reg, "lbl/cborg-mini");
    assert.equal(m?.id, "lbl/cborg-mini");
  });
});

test("resolveModelReference resolves a bare id via the preferred provider", async () => {
  await withEnv({}, () => {
    const reg = fakeRegistry([{ provider: "anthropic", id: "claude-opus-4-8" }]);
    const m = resolveModelReference(reg, "claude-opus-4-8", "anthropic");
    assert.equal((m as any)?.provider, "anthropic");
  });
});

test("resolveModelReference rejects ambiguous bare ids across providers", async () => {
  await withEnv({}, () => {
    const reg = fakeRegistry([
      { provider: "a", id: "shared-model" },
      { provider: "b", id: "shared-model" },
    ]);
    assert.equal(resolveModelReference(reg, "shared-model"), undefined);
    // A unique id still resolves through the registry-wide scan.
    const uniq = fakeRegistry([{ provider: "a", id: "only-here" }]);
    assert.equal(resolveModelReference(uniq, "only-here")?.id, "only-here");
  });
});

test("resolveModelReference tolerates a registry without find/getAll", async () => {
  await withEnv({ BERIL_MODEL_PROVIDER: "cborg" }, () => {
    // Existing test stubs define only getApiKeyAndHeaders — resolution must
    // fall through, never throw.
    assert.equal(resolveModelReference({} as any, "cborg/x"), undefined);
    assert.equal(resolveModelReference(undefined, "x"), undefined);
  });
});

test("resolveRoleModel resolves the role env reference", async () => {
  await withEnv({ BERIL_MODEL_PROVIDER: "cborg", BERIL_REVIEW_MODEL: "cborg/lbl/cborg-deepthought" }, () => {
    const reg = fakeRegistry([{ provider: "cborg", id: "lbl/cborg-deepthought" }]);
    const ctx: any = { model: { id: "session" }, modelRegistry: reg };
    assert.equal(resolveRoleModel(ctx, "review")?.id, "lbl/cborg-deepthought");
  });
});

test("resolveRoleModel uses the fallback pair when no env ref resolves", async () => {
  await withEnv({}, () => {
    const reg = fakeRegistry([{ provider: "anthropic", id: "claude-opus-4-8" }]);
    const ctx: any = { model: { id: "session" }, modelRegistry: reg };
    const m = resolveRoleModel(ctx, "review", { provider: "anthropic", model: "claude-opus-4-8" });
    assert.equal(m?.id, "claude-opus-4-8");
  });
});

test("resolveRoleModel falls back to ctx.model when nothing resolves", async () => {
  await withEnv({ BERIL_FAST_MODEL: "cborg/lbl/cborg-mini" }, () => {
    const session = { id: "session" };
    // Registry can't resolve the env ref (no cborg provider) and no fallback given.
    const ctx: any = { model: session, modelRegistry: fakeRegistry([]) };
    assert.equal(resolveRoleModel(ctx, "fast"), session);
  });
});
