import assert from "node:assert/strict";
import { test } from "node:test";
import { requireReady } from "../lib/readiness.ts";

const pi = (env: any) =>
  ({ exec: async () => ({ stdout: JSON.stringify(env), stderr: "", code: 0, killed: false }) }) as any;

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
