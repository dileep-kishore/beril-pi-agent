import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { readCachedEnv, requireReady, resetReadinessCache, setCachedEnv } from "../lib/readiness.ts";

const pi = (env: any) =>
  ({ exec: async () => ({ stdout: JSON.stringify(env), stderr: "", code: 0, killed: false }) }) as any;

/** A pi whose exec records each invocation so tests can count execs. */
const spyPi = (env: any) => {
  const calls: string[][] = [];
  const p = {
    exec: async (_c: string, args: string[]) => {
      calls.push(args);
      return { stdout: JSON.stringify(env), stderr: "", code: 0, killed: false };
    },
  } as any;
  return { pi: p, calls };
};

beforeEach(() => resetReadinessCache());

test("returns env when ready", async () => {
  const e = await requireReady(pi({ ready: true, location: "off-cluster", checks: {}, next_steps: [] }));
  assert.equal(e.location, "off-cluster");
});

test("throws with next_steps when not ready", async () => {
  await assert.rejects(
    () => requireReady(pi({ ready: false, location: "off-cluster", checks: {}, next_steps: ["start pproxy"] })),
    (err: any) => /start pproxy/.test(err.message),
  );
});

test("first call execs, second within TTL is a cache hit and returns the same env", async () => {
  const { pi: p, calls } = spyPi({ ready: true, location: "off-cluster", checks: {}, next_steps: [] });
  const first = await requireReady(p);
  const second = await requireReady(p);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["env", "--json"]);
  assert.deepEqual(second, first);
});

test("setCachedEnv seeds the cache so requireReady returns it without exec", async () => {
  setCachedEnv({ ready: true, location: "on-cluster", checks: {}, next_steps: [] });
  const { pi: p, calls } = spyPi({ ready: true, location: "off-cluster", checks: {}, next_steps: [] });
  const env = await requireReady(p);
  assert.equal(calls.length, 0);
  assert.equal(env.location, "on-cluster");
});

test("readCachedEnv returns the seeded env while fresh, undefined when cold", () => {
  assert.equal(readCachedEnv(), undefined);
  setCachedEnv({ ready: true, location: "on-cluster", checks: {}, next_steps: [] });
  assert.equal(readCachedEnv()?.location, "on-cluster");
});

test("not-ready env throws and is not served as a fast-path on the next call", async () => {
  const { pi: p, calls } = spyPi({ ready: false, location: "off-cluster", checks: {}, next_steps: ["start pproxy"] });
  await assert.rejects(() => requireReady(p), /start pproxy/);
  await assert.rejects(() => requireReady(p), /start pproxy/);
  // Each call re-verifies a not-ready state; no short-circuit.
  assert.equal(calls.length, 2);
});
