import assert from "node:assert/strict";
import { test } from "node:test";
import berilGov from "../extensions/beril-governance.ts";

const READY = { ready: true, location: "off-cluster", checks: {}, next_steps: [] };

function harness(execImpl: any) {
  const tools: any = {};
  const commands: any = {};
  const pi: any = {
    registerTool: (t: any) => (tools[t.name] = t),
    registerCommand: (n: string, o: any) => (commands[n] = o),
    on: () => {},
    sendUserMessage: () => {},
    exec: execImpl,
  };
  berilGov(pi);
  return { tools, commands };
}
const ctx: any = { hasUI: false, mode: "json" };

test("registers the four governance tools", () => {
  const { tools } = harness(async () => ({ stdout: "{}", stderr: "", code: 0, killed: false }));
  for (const name of ["notebook_hash", "lifecycle_transition", "beril_user", "lakehouse_submit"]) {
    assert.ok(tools[name], `tool ${name}`);
  }
});

test("beril_user returns identity (complete)", async () => {
  const { tools } = harness(async () => ({
    stdout: JSON.stringify({ name: "A", affiliation: "LBL", orcid: "0000-0001" }),
    stderr: "",
    code: 0,
    killed: false,
  }));
  const r = await tools.beril_user.execute("id", {}, undefined, undefined, ctx);
  assert.equal((r.details as any).orcid, "0000-0001");
  assert.equal((r.details as any).complete, true);
});

test("beril_user preserves identity even when incomplete (exit 1)", async () => {
  const { tools } = harness(async () => ({
    stdout: JSON.stringify({ name: "A", affiliation: "LBL", orcid: "" }),
    stderr: "Missing field(s): orcid",
    code: 1,
    killed: false,
  }));
  const r = await tools.beril_user.execute("id", {}, undefined, undefined, ctx);
  assert.equal((r.details as any).orcid, "");
  assert.equal((r.details as any).complete, false);
});

test("lifecycle_transition shells 'beril lifecycle set' and returns status", async () => {
  const calls: string[][] = [];
  const { tools } = harness(async (_c: string, args: string[]) => {
    calls.push(args);
    return { stdout: JSON.stringify({ status: "reviewed" }), stderr: "", code: 0, killed: false };
  });
  const r = await tools.lifecycle_transition.execute(
    "id",
    { project: "demo", state: "reviewed" },
    undefined,
    undefined,
    ctx,
  );
  assert.deepEqual(calls[0], ["lifecycle", "set", "demo", "reviewed"]);
  assert.equal((r.details as any).status, "reviewed");
});

test("lakehouse_submit throws on partial (exit 2)", async () => {
  const { tools } = harness(async (_c: string, args: string[]) => {
    if (args[0] === "env") return { stdout: JSON.stringify(READY), stderr: "", code: 0, killed: false };
    return { stdout: JSON.stringify({ partial: true }), stderr: "partial archive", code: 2, killed: false };
  });
  await assert.rejects(() => tools.lakehouse_submit.execute("id", { project: "demo" }, undefined, undefined, ctx));
});

test("registers /synthesize /berdl-review /submit commands", () => {
  const { commands } = harness(async () => ({ stdout: "{}", stderr: "", code: 0, killed: false }));
  for (const name of ["synthesize", "berdl-review", "submit"]) assert.ok(commands[name], `command ${name}`);
});

function cmdCtx() {
  const notes: string[] = [];
  const c: any = { hasUI: true, mode: "tui", ui: { notify: (m: string) => notes.push(m), confirm: async () => true } };
  return { ctx: c, notes };
}

test("/submit aborts before upload when ORCID missing", async () => {
  const calls: string[][] = [];
  const { commands } = harness(async (_c: string, args: string[]) => {
    calls.push(args);
    if (args[0] === "user") {
      return {
        stdout: JSON.stringify({ name: "A", affiliation: "LBL", orcid: "" }),
        stderr: "",
        code: 1,
        killed: false,
      };
    }
    return { stdout: "{}", stderr: "", code: 0, killed: false };
  });
  const { ctx: cctx, notes } = cmdCtx();
  await commands.submit.handler("demo", cctx);
  assert.ok(!calls.find((a) => a[0] === "submit"), "must not reach upload");
  assert.match(notes.join(" "), /ORCID/i);
});

test("/submit uploads and marks submitted when ORCID present", async () => {
  const calls: string[][] = [];
  const { commands } = harness(async (_c: string, args: string[]) => {
    calls.push(args);
    if (args[0] === "user") {
      return {
        stdout: JSON.stringify({ name: "A", affiliation: "LBL", orcid: "0000-0001" }),
        stderr: "",
        code: 0,
        killed: false,
      };
    }
    return { stdout: JSON.stringify({ archive_key: "k", file_count: 3 }), stderr: "", code: 0, killed: false };
  });
  const { ctx: cctx } = cmdCtx();
  await commands.submit.handler("demo", cctx);
  // Exact arg shape — `beril submit <project>` is positional (contract with the Python CLI).
  assert.deepEqual(
    calls.find((a) => a[0] === "submit"),
    ["submit", "demo"],
  );
  assert.ok(
    calls.find((a) => a[0] === "lifecycle" && a[1] === "marker" && a.includes("submitted")),
    "marked submitted",
  );
});

test("/berdl-review runs review then marks reviewed", async () => {
  const calls: string[][] = [];
  const { commands } = harness(async (_c: string, args: string[]) => {
    calls.push(args);
    if (args[0] === "review") {
      return {
        stdout: JSON.stringify({ review_file: "REVIEW_1.md", report_hash: "sha256:x" }),
        stderr: "",
        code: 0,
        killed: false,
      };
    }
    return { stdout: JSON.stringify({ status: "reviewed" }), stderr: "", code: 0, killed: false };
  });
  const { ctx: cctx } = cmdCtx();
  await commands["berdl-review"].handler("demo", cctx);
  assert.deepEqual(calls[0], ["review", "demo"]);
  assert.deepEqual(calls[1], ["lifecycle", "set", "demo", "reviewed"]);
});
