import assert from "node:assert/strict";
import { test } from "node:test";
import { parallelMap } from "../lib/parallel-map.ts";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("preserves input order despite out-of-order completion", async () => {
  const out = await parallelMap([20, 0, 8], 3, async (ms, i) => {
    await delay(ms);
    return i;
  });
  assert.deepEqual(out, [
    { ok: true, value: 0 },
    { ok: true, value: 1 },
    { ok: true, value: 2 },
  ]);
});

test("tags a failure without sinking the batch", async () => {
  const out = await parallelMap([1, 2, 3], 3, async (n) => {
    if (n === 2) throw new Error("boom");
    return n * 10;
  });
  assert.deepEqual(out[0], { ok: true, value: 10 });
  assert.equal(out[1].ok, false);
  assert.match((out[1] as { error: Error }).error.message, /boom/);
  assert.deepEqual(out[2], { ok: true, value: 30 });
});

test("bounds concurrency to the limit", async () => {
  let live = 0;
  let max = 0;
  await parallelMap([1, 2, 3, 4, 5], 2, async () => {
    live++;
    max = Math.max(max, live);
    await delay(5);
    live--;
  });
  assert.ok(max <= 2, `max concurrent ${max} should be <= 2`);
});

test("wraps a non-Error rejection in an Error", async () => {
  const out = await parallelMap([1], 1, () => Promise.reject("stringly"));
  assert.equal(out[0].ok, false);
  assert.ok((out[0] as { error: Error }).error instanceof Error);
});
