import { test } from "node:test";
import assert from "node:assert/strict";
import { berilExec, BerilError } from "../lib/beril-exec.ts";

function fakePi(result: { stdout: string; stderr: string; code: number }) {
  return { exec: async () => ({ ...result, killed: false }) } as any;
}

test("parses JSON stdout on exit 0", async () => {
  const pi = fakePi({ stdout: '{"ready":true}', stderr: "", code: 0 });
  assert.deepEqual(await berilExec(pi, ["env"]), { ready: true });
});

test("throws BerilError on exit 1 with stderr", async () => {
  const pi = fakePi({ stdout: "", stderr: "boom", code: 1 });
  await assert.rejects(
    () => berilExec(pi, ["query"]),
    (e: any) => e instanceof BerilError && e.code === 1 && /boom/.test(e.message),
  );
});

test("exit 2 marks usage error", async () => {
  const pi = fakePi({ stdout: "", stderr: "missing token", code: 2 });
  await assert.rejects(
    () => berilExec(pi, ["env"]),
    (e: any) => e.code === 2 && e.isUsage === true,
  );
});

test("throws when stdout is not JSON on exit 0", async () => {
  const pi = fakePi({ stdout: "not json", stderr: "", code: 0 });
  await assert.rejects(() => berilExec(pi, ["env"]), /not JSON/);
});
