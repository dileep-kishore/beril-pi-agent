import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import berilData from "../extensions/beril-data.ts";
import { isDestructive } from "../lib/destructive.ts";
import { resetReadinessCache } from "../lib/readiness.ts";
import { renderTable } from "../lib/render.ts";

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
  };
  berilData(pi);
  return Object.assign(tools, { __commands: commands, __messages: messages });
}
const ctx: any = { hasUI: false, mode: "json" };
const ready = { ready: true, location: "off-cluster", checks: {}, next_steps: [] };

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
