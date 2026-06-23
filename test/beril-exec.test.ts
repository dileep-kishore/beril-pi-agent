import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BerilError,
  berilExec,
  classifyBerilError,
  isConnectivityError,
  isPermissionError,
  permissionGuidance,
} from "../lib/beril-exec.ts";

// The verbatim sanitized strings scripts/run_sql.py emits on stderr. The TS
// classifier and the Python sanitizer share this wording; a Python contract
// test (tests/test_run_sql_errors.py) pins it so drift breaks a test.
const SANITIZED_AUTH =
  "Query failed: BERDL authentication is missing or expired. Stop here and refresh KBASE_AUTH_TOKEN with `uv run beril setup` (`beril setup` inside an activated environment), then inspect `/berdl-status` before retrying.";
const SANITIZED_PERMISSION =
  "Query failed: BERDL authorization blocked this request. Stop here: the current user does not appear to have permission for one or more requested resources. Request access or choose a readable table before retrying.";
const SANITIZED_CONNECTIVITY =
  "Query failed: the BERDL Spark Connect server is unreachable (retries exhausted). Its JupyterHub server may not be running — check `berdl-remote status` and that the SSH tunnels + pproxy are up, then retry.";

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

test("classifies the verbatim sanitized run_sql.py PERMISSION / AUTH stderr", () => {
  // run_sql.py rewrites permission/auth exceptions into prose that contains NONE
  // of the raw markers (AccessControlException, KBASE_AUTH_TOKEN-only, ...). The
  // classifier must recognize that stable sanitized phrasing too, or a real
  // permission denial round-trips as "unknown" and downstream tools mis-read it
  // as an ABSENT table.
  const permErr = new BerilError(1, SANITIZED_PERMISSION, SANITIZED_PERMISSION);
  assert.equal(classifyBerilError(permErr), "permission");
  assert.equal(isPermissionError(permErr), true);

  const authErr = new BerilError(1, SANITIZED_AUTH, SANITIZED_AUTH);
  assert.equal(classifyBerilError(authErr), "auth");
  assert.equal(isPermissionError(authErr), true);
});

test("permissionGuidance picks auth vs permission text from the sanitized stderr", () => {
  const authErr = new BerilError(1, SANITIZED_AUTH, SANITIZED_AUTH);
  const authGuidance = permissionGuidance(authErr);
  assert.match(authGuidance, /refresh credentials|beril setup/);

  const permErr = new BerilError(1, SANITIZED_PERMISSION, SANITIZED_PERMISSION);
  const permGuidance = permissionGuidance(permErr);
  assert.match(permGuidance, /[Rr]equest access/);
});

test("the sanitized connectivity / missing-table prose keeps its own class", () => {
  // Adding permission/auth phrasing must not steal the connectivity or query
  // strings. Order matters (usage→connectivity→auth→permission→query).
  const connErr = new BerilError(1, SANITIZED_CONNECTIVITY, SANITIZED_CONNECTIVITY);
  assert.equal(classifyBerilError(connErr), "connectivity");
  assert.equal(classifyBerilError(new Error("[TABLE_OR_VIEW_NOT_FOUND] db.t missing")), "query");
});
