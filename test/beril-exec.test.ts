import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BerilError,
  berilExec,
  classifyBerilError,
  isConnectivityError,
  isPermissionError,
} from "../lib/beril-exec.ts";

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

test("classifies connectivity, permission, auth, usage, and query errors", () => {
  assert.equal(classifyBerilError(new Error("UNAVAILABLE: failed to connect")), "connectivity");
  assert.equal(classifyBerilError(new Error("AccessControlException: User cannot access table")), "permission");
  assert.equal(classifyBerilError(new Error("KBASE_AUTH_TOKEN is required.")), "auth");
  assert.equal(classifyBerilError(new BerilError(2, "bad args", "bad args")), "usage");
  assert.equal(classifyBerilError(new Error("[TABLE_OR_VIEW_NOT_FOUND] nope")), "query");
  assert.equal(classifyBerilError(new Error("some other failure")), "unknown");
});

test("compatibility predicates expose connectivity and permission classes", () => {
  assert.equal(isConnectivityError(new Error("RETRIES_EXCEEDED")), true);
  assert.equal(isPermissionError(new Error("Token denied: missing tenant grant")), true);
  assert.equal(isPermissionError(new Error("403 Forbidden: Access denied")), true);
  assert.equal(isPermissionError(new Error("[TABLE_OR_VIEW_NOT_FOUND] nope")), false);
});
