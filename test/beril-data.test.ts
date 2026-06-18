import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import berilData from "../extensions/beril-data.ts";
import { isConnectivityError, isPermissionError } from "../lib/beril-exec.ts";
import { isDestructive } from "../lib/destructive.ts";
import { resetReadinessCache } from "../lib/readiness.ts";
import { renderTable } from "../lib/render.ts";
import { feasibilityVerdict } from "../lib/ui/science-cards.ts";

beforeEach(() => resetReadinessCache());

function harness(execImpl: any) {
  const tools: any = {};
  const commands: any = {};
  const messages: string[] = [];
  const pi: any = {
    registerTool: (t: any) => (tools[t.name] = t),
    registerCommand: (name: string, opts: any) => (commands[name] = opts),
    sendUserMessage: (m: string) => messages.push(m),
    exec: execImpl,
    on: () => {},
  };
  berilData(pi);
  return Object.assign(tools, { __commands: commands, __messages: messages });
}
const ctx: any = { hasUI: false, mode: "json" };
const ready = { ready: true, location: "off-cluster", checks: {}, next_steps: [] };

// The verbatim sanitized stderr scripts/run_sql.py emits for a real authz/auth
// denial — prose that contains NONE of the raw permission markers. A real
// permission denial used to round-trip as "unknown", so berdl_feasibility
// recorded the table as ABSENT (a false "not-answerable" verdict). These are the
// regression fixtures for that HIGH bug.
const SANITIZED_PERMISSION =
  "Query failed: BERDL authorization blocked this request. Stop here: the current user does not appear to have permission for one or more requested resources. Request access or choose a readable table before retrying.";
const SANITIZED_AUTH =
  "Query failed: BERDL authentication is missing or expired. Stop here and refresh KBASE_AUTH_TOKEN with `uv run beril setup` (`beril setup` inside an activated environment), then inspect `/berdl-status` before retrying.";

test("registers berdl_query + berdl_discover + berdl_peek + berdl_export", () => {
  const tools = harness(async () => ({ stdout: "{}", stderr: "", code: 0, killed: false }));
  assert.ok(tools.berdl_query && tools.berdl_discover && tools.berdl_peek && tools.berdl_export);
});

test("berdl_export shells 'beril export' with path/format/mode and is destructive", async () => {
  const calls: string[][] = [];
  const tools = harness(async (_c: string, args: string[]) => {
    calls.push(args);
    if (args[0] === "env") return { stdout: JSON.stringify(ready), stderr: "", code: 0, killed: false };
    return { stdout: JSON.stringify({ path: "s3a://x", count: 5 }), stderr: "", code: 0, killed: false };
  });
  const res = await tools.berdl_export.execute(
    "id",
    { query: "SELECT 1", path: "s3a://x", format: "parquet", mode: "overwrite" },
    undefined,
    undefined,
    ctx,
  );
  assert.equal((res.details as any).count, 5);
  assert.deepEqual(calls[1], [
    "export",
    "--query",
    "SELECT 1",
    "--path",
    "s3a://x",
    "--format",
    "parquet",
    "--mode",
    "overwrite",
  ]);
  // The safety gate must recognize this tool as destructive.
  assert.equal(isDestructive("berdl_export", {}), true);
});

test("berdl_peek checks readiness, then DESCRIBEs and samples the table", async () => {
  const calls: string[][] = [];
  const tools = harness(async (_c: string, args: string[]) => {
    calls.push(args);
    if (args[0] === "env") return { stdout: JSON.stringify(ready), stderr: "", code: 0, killed: false };
    const isDescribe = (args[2] ?? "").startsWith("DESCRIBE");
    const payload = isDescribe
      ? { returned_rows: 1, limit_applied: 500, rows: [{ col_name: "genome_id", data_type: "string", comment: "id" }] }
      : { returned_rows: 1, limit_applied: 5, rows: [{ genome_id: "RS_GCF_1" }] };
    return { stdout: JSON.stringify(payload), stderr: "", code: 0, killed: false };
  });
  const res = await tools.berdl_peek.execute("id", { table: "ke_pangenome.genome" }, undefined, undefined, ctx);
  assert.equal(calls[0][0], "env"); // readiness first
  assert.deepEqual(calls[1], ["query", "--query", "DESCRIBE ke_pangenome.genome", "--limit", "500"]);
  assert.deepEqual(calls[2], ["query", "--query", "SELECT * FROM ke_pangenome.genome LIMIT 5", "--limit", "5"]);
  assert.match(res.content[0].text, /genome_id: string — id/);
  assert.match(res.content[0].text, /RS_GCF_1/);
});

test("berdl_peek rejects an invalid table identifier before querying", async () => {
  const calls: string[][] = [];
  const tools = harness(async (_c: string, args: string[]) => {
    calls.push(args);
    return { stdout: JSON.stringify(ready), stderr: "", code: 0, killed: false };
  });
  await assert.rejects(
    () => tools.berdl_peek.execute("id", { table: "genome; DROP TABLE x" }, undefined, undefined, ctx),
    /valid table identifier/,
  );
  assert.equal(calls.length, 1); // only the readiness check ran; no DESCRIBE/SELECT
});

test("/berdl-preview asks the model to peek the named table", async () => {
  const tools = harness(async () => ({ stdout: "{}", stderr: "", code: 0, killed: false }));
  await tools.__commands["berdl-preview"].handler("ke_pangenome.genome", ctx);
  assert.equal(tools.__messages.length, 1);
  assert.match(tools.__messages[0], /berdl_peek/);
  assert.match(tools.__messages[0], /ke_pangenome\.genome/);
});

test("berdl_query runs readiness check first, then query", async () => {
  const calls: string[][] = [];
  const tools = harness(async (_c: string, args: string[]) => {
    calls.push(args);
    if (args[0] === "env") return { stdout: JSON.stringify(ready), stderr: "", code: 0, killed: false };
    return {
      stdout: JSON.stringify({ returned_rows: 1, rows: [{ a: 1 }], limit_applied: 100 }),
      stderr: "",
      code: 0,
      killed: false,
    };
  });
  const res = await tools.berdl_query.execute("id", { query: "SELECT 1", limit: 100 }, undefined, undefined, ctx);
  assert.equal((res.details as any).returned_rows, 1);
  assert.deepEqual(calls[0], ["env", "--json"]);
  assert.equal(calls[1][0], "query");
  assert.ok(calls[1].includes("--limit") && calls[1].includes("100"));
});

test("berdl_query throws guidance when not ready", async () => {
  const tools = harness(async () => ({
    stdout: JSON.stringify({ ready: false, location: "off-cluster", checks: {}, next_steps: ["start pproxy"] }),
    stderr: "",
    code: 0,
    killed: false,
  }));
  await assert.rejects(
    () => tools.berdl_query.execute("id", { query: "SELECT 1", limit: 100 }, undefined, undefined, ctx),
    /start pproxy/,
  );
});

test("berdl_discover returns the snapshot", async () => {
  const tools = harness(async (_c: string, args: string[]) => {
    if (args[0] === "env") return { stdout: JSON.stringify(ready), stderr: "", code: 0, killed: false };
    return { stdout: JSON.stringify({ databases: [{ name: "db1" }] }), stderr: "", code: 0, killed: false };
  });
  const res = await tools.berdl_discover.execute("id", {}, undefined, undefined, ctx);
  assert.equal((res.details as any).databases[0].name, "db1");
});

test("renderTable formats rows and truncates", () => {
  assert.match(renderTable([{ a: 1, b: 2 }]), /a \| b/);
  assert.equal(renderTable([]), "(0 rows)");
  const many = Array.from({ length: 25 }, (_, i) => ({ n: i }));
  assert.match(renderTable(many, 20), /5 more rows/);
});

test("isConnectivityError flags transport outages but not SQL/analysis errors", () => {
  assert.ok(isConnectivityError(new Error("the BERDL Spark Connect server is unreachable (retries exhausted)")));
  assert.ok(isConnectivityError(new Error("[RETRIES_EXCEEDED] Exceeded retries")));
  assert.ok(isConnectivityError(new Error("UNAVAILABLE: failed to connect to all addresses")));
  // Genuine query/resolution errors are NOT connectivity failures.
  assert.ok(!isConnectivityError(new Error("[TABLE_OR_VIEW_NOT_FOUND] The table `db`.`t` cannot be found")));
  assert.ok(!isConnectivityError(new Error("[PARSE_SYNTAX_ERROR] Syntax error at or near 'SELCT'")));
});

test("isPermissionError flags BERDL authorization failures", () => {
  assert.ok(isPermissionError(new Error("Query failed: AccessControlException: access denied to tenant table")));
  assert.ok(isPermissionError(new Error("Token denied for resource kbase.ke_pangenome.genome")));
  assert.ok(isPermissionError(new Error("403 Forbidden: not authorized")));
  assert.ok(!isPermissionError(new Error("[TABLE_OR_VIEW_NOT_FOUND] The table `db`.`t` cannot be found")));
});

test("berdl_feasibility surfaces a Spark-unreachable outage as an error, never as 'absent'", async () => {
  // When the schema probe fails because Spark Connect is down, the tool must NOT
  // claim the column is absent (a false 'not-answerable' verdict). It must abort
  // and surface the connectivity error so the user knows the DATA PLANE is down.
  const tools = harness(async (_c: string, args: string[]) => {
    if (args[0] === "env") return { stdout: JSON.stringify(ready), stderr: "", code: 0, killed: false };
    return {
      stdout: "",
      stderr: "Query failed: the BERDL Spark Connect server is unreachable (retries exhausted).",
      code: 1,
      killed: false,
    };
  });
  await assert.rejects(
    () =>
      tools.berdl_feasibility.execute(
        "id",
        { question: "Q", checks: [{ table: "db.t", column: "c" }] },
        undefined,
        undefined,
        ctx,
      ),
    /unreachable/,
  );
});

test("berdl_feasibility surfaces authorization failures as stop conditions", async () => {
  const tools = harness(async (_c: string, args: string[]) => {
    if (args[0] === "env") return { stdout: JSON.stringify(ready), stderr: "", code: 0, killed: false };
    return {
      stdout: "",
      stderr: "Query failed: AccessControlException: access denied to table db.t.",
      code: 1,
      killed: false,
    };
  });
  await assert.rejects(
    () =>
      tools.berdl_feasibility.execute(
        "id",
        { question: "Q", checks: [{ table: "db.t", column: "c" }] },
        undefined,
        undefined,
        ctx,
      ),
    /access denied|permission|authorization/i,
  );
});

test("berdl_feasibility aborts on the VERBATIM sanitized PERMISSION stderr (never 'absent')", async () => {
  // The HIGH-bug regression: run_sql.py rewrites the denial into prose with none
  // of the raw markers. Before the classifier learned that phrasing, this fell
  // through to checked.push({ exists: false }) and rendered the table as MISSING.
  const tools = harness(async (_c: string, args: string[]) => {
    if (args[0] === "env") return { stdout: JSON.stringify(ready), stderr: "", code: 0, killed: false };
    return { stdout: "", stderr: SANITIZED_PERMISSION, code: 1, killed: false };
  });
  await assert.rejects(
    () =>
      tools.berdl_feasibility.execute(
        "id",
        { question: "Q", checks: [{ table: "db.t", column: "c" }] },
        undefined,
        undefined,
        ctx,
      ),
    (err: any) => /[Rr]equest access|authorization|permission/.test(err.message) && !/exists|MISSING/.test(err.message),
  );
});

test("berdl_feasibility aborts on the VERBATIM sanitized AUTH stderr (auth-subclass stop)", async () => {
  const tools = harness(async (_c: string, args: string[]) => {
    if (args[0] === "env") return { stdout: JSON.stringify(ready), stderr: "", code: 0, killed: false };
    return { stdout: "", stderr: SANITIZED_AUTH, code: 1, killed: false };
  });
  await assert.rejects(
    () =>
      tools.berdl_feasibility.execute(
        "id",
        { question: "Q", checks: [{ table: "db.t", column: "c" }] },
        undefined,
        undefined,
        ctx,
      ),
    (err: any) => /credentials|beril setup|authentication/i.test(err.message) && !/MISSING/.test(err.message),
  );
});

test("berdl_query throws the permission guidance for the VERBATIM sanitized PERMISSION stderr", async () => {
  const tools = harness(async (_c: string, args: string[]) => {
    if (args[0] === "env") return { stdout: JSON.stringify(ready), stderr: "", code: 0, killed: false };
    return { stdout: "", stderr: SANITIZED_PERMISSION, code: 1, killed: false };
  });
  await assert.rejects(
    () => tools.berdl_query.execute("id", { query: "SELECT * FROM db.t", limit: 100 }, undefined, undefined, ctx),
    /[Rr]equest access/,
  );
});

test("berdl_query throws the auth guidance for the VERBATIM sanitized AUTH stderr", async () => {
  const tools = harness(async (_c: string, args: string[]) => {
    if (args[0] === "env") return { stdout: JSON.stringify(ready), stderr: "", code: 0, killed: false };
    return { stdout: "", stderr: SANITIZED_AUTH, code: 1, killed: false };
  });
  await assert.rejects(
    () => tools.berdl_query.execute("id", { query: "SELECT * FROM db.t", limit: 100 }, undefined, undefined, ctx),
    /refresh credentials|beril setup/,
  );
});

test("berdl_query sanitizes authorization failures", async () => {
  const tools = harness(async (_c: string, args: string[]) => {
    if (args[0] === "env") return { stdout: JSON.stringify(ready), stderr: "", code: 0, killed: false };
    return {
      stdout: "",
      stderr:
        "Traceback...\nAccessControlException: org.apache.hadoop.fs.s3a.auth.NoAuthWithAWSException\nsecret stack",
      code: 1,
      killed: false,
    };
  });
  await assert.rejects(
    () => tools.berdl_query.execute("id", { query: "SELECT * FROM db.t", limit: 100 }, undefined, undefined, ctx),
    (err: any) =>
      /permission|authorization|access/i.test(err.message) &&
      !/NoAuthWithAWSException|Traceback|secret stack/.test(err.message),
  );
});

test("berdl_feasibility surfaces a coverage-probe outage as an error, not a clean 'answerable'", async () => {
  // DESCRIBE succeeds (column is real), but the follow-up coverage probe hits a
  // transport outage. The bare catch used to swallow it and render the column as
  // cleanly populated/answerable; it must now surface the connectivity error.
  const tools = harness(async (_c: string, args: string[]) => {
    if (args[0] === "env") return { stdout: JSON.stringify(ready), stderr: "", code: 0, killed: false };
    const sql = args[2] ?? "";
    if (sql.startsWith("DESCRIBE")) {
      return {
        stdout: JSON.stringify({
          returned_rows: 1,
          limit_applied: 500,
          rows: [{ col_name: "c", data_type: "string" }],
        }),
        stderr: "",
        code: 0,
        killed: false,
      };
    }
    return {
      stdout: "",
      stderr: "Query failed: the BERDL Spark Connect server is unreachable (retries exhausted).",
      code: 1,
      killed: false,
    };
  });
  await assert.rejects(
    () =>
      tools.berdl_feasibility.execute(
        "id",
        { question: "Q", checks: [{ table: "db.t", column: "c" }] },
        undefined,
        undefined,
        ctx,
      ),
    /unreachable/,
  );
});

test("berdl_feasibility tolerates a non-connectivity coverage failure (coverage stays unknown)", async () => {
  const tools = harness(async (_c: string, args: string[]) => {
    if (args[0] === "env") return { stdout: JSON.stringify(ready), stderr: "", code: 0, killed: false };
    const sql = args[2] ?? "";
    if (sql.startsWith("DESCRIBE")) {
      return {
        stdout: JSON.stringify({ returned_rows: 1, limit_applied: 500, rows: [{ col_name: "c" }] }),
        stderr: "",
        code: 0,
        killed: false,
      };
    }
    return { stdout: "", stderr: "Query failed: [ARITHMETIC_OVERFLOW] value out of range", code: 1, killed: false };
  });
  const res = await tools.berdl_feasibility.execute(
    "id",
    { question: "Q", checks: [{ table: "db.t", column: "c" }] },
    undefined,
    undefined,
    ctx,
  );
  const checked = (res.details as any).checked;
  assert.equal(checked[0].exists, true);
  assert.equal(checked[0].coverage, undefined);
});

test("berdl_feasibility still records a genuinely missing table as absent (no abort)", async () => {
  const tools = harness(async (_c: string, args: string[]) => {
    if (args[0] === "env") return { stdout: JSON.stringify(ready), stderr: "", code: 0, killed: false };
    return {
      stdout: "",
      stderr: "Query failed: [TABLE_OR_VIEW_NOT_FOUND] The table or view `db`.`t` cannot be found.",
      code: 1,
      killed: false,
    };
  });
  const res = await tools.berdl_feasibility.execute(
    "id",
    { question: "Q", checks: [{ table: "db.t", column: "c" }] },
    undefined,
    undefined,
    ctx,
  );
  assert.equal((res.details as any).checked[0].exists, false);
  assert.match(res.content[0].text, /MISSING/);
});

test("feasibilityVerdict maps missing → not-answerable, sparse → partial, all-good → answerable", () => {
  assert.equal(
    feasibilityVerdict([{ table: "db.t", column: "c", exists: false }]),
    "not-answerable",
    "a missing column blocks the question",
  );
  assert.equal(
    feasibilityVerdict([{ table: "db.t", column: "c", exists: true, coverage: 0.3 }]),
    "partial",
    "an existing-but-sparse (coverage<0.5) column is partial",
  );
  assert.equal(
    feasibilityVerdict([
      { table: "db.t", column: "c", exists: true, coverage: 0.9 },
      { table: "db.u", exists: true },
    ]),
    "answerable",
    "all checks present with adequate coverage",
  );
});
