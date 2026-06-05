import assert from "node:assert/strict";
import { test } from "node:test";
import berilGov from "../extensions/beril-governance.ts";

const READY = { ready: true, location: "off-cluster", checks: {}, next_steps: [] };

function harness(execImpl: any) {
  const tools: any = {};
  const commands: any = {};
  const handlers: any = {};
  const emitted: [string, any][] = [];
  const pi: any = {
    registerTool: (t: any) => (tools[t.name] = t),
    registerCommand: (n: string, o: any) => (commands[n] = o),
    on: (event: string, h: any) => (handlers[event] = h),
    sendUserMessage: () => {},
    exec: execImpl,
    events: { emit: (channel: string, data: any) => emitted.push([channel, data]), on: () => () => {} },
  };
  berilGov(pi);
  return { tools, commands, handlers, emitted };
}
const ctx: any = { hasUI: false, mode: "json" };

// Tool-execute ctx with a setStatus spy (5th arg to execute). Captures (key,text).
function statusCtx() {
  const statuses: [string, string | undefined][] = [];
  const c: any = {
    hasUI: true,
    mode: "tui",
    ui: { setStatus: (k: string, t: string | undefined) => statuses.push([k, t]) },
  };
  return { ctx: c, statuses };
}

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
  const statuses: [string, string | undefined][] = [];
  const c: any = {
    hasUI: true,
    mode: "tui",
    ui: {
      notify: (m: string) => notes.push(m),
      confirm: async () => true,
      setStatus: (k: string, t: string | undefined) => statuses.push([k, t]),
    },
  };
  return { ctx: c, notes, statuses };
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

test("lifecycle_transition sets the active-project footer key under hasUI", async () => {
  const { tools } = harness(async () => ({
    stdout: JSON.stringify({ status: "reviewed" }),
    stderr: "",
    code: 0,
    killed: false,
  }));
  const { ctx: sctx, statuses } = statusCtx();
  await tools.lifecycle_transition.execute("id", { project: "demo", state: "reviewed" }, undefined, undefined, sctx);
  const entry = statuses.find((s) => s[0] === "beril-2-project");
  assert.ok(entry, "set beril-2-project");
  assert.match(String(entry?.[1]), /demo/);
});

test("lifecycle_transition does not touch the footer when headless", async () => {
  let setStatusCalled = false;
  const { tools } = harness(async () => ({
    stdout: JSON.stringify({ status: "reviewed" }),
    stderr: "",
    code: 0,
    killed: false,
  }));
  const headless: any = { hasUI: false, mode: "json", ui: { setStatus: () => (setStatusCalled = true) } };
  await tools.lifecycle_transition.execute(
    "id",
    { project: "demo", state: "reviewed" },
    undefined,
    undefined,
    headless,
  );
  assert.equal(setStatusCalled, false, "setStatus must not be called when hasUI is false");
});

test("session_shutdown clears the active-project footer key", async () => {
  const { handlers } = harness(async () => ({ stdout: "{}", stderr: "", code: 0, killed: false }));
  const { ctx: sctx, statuses } = statusCtx();
  await handlers.session_shutdown({ type: "session_shutdown", reason: "quit" }, sctx);
  assert.deepEqual(
    statuses.find((s) => s[0] === "beril-2-project"),
    ["beril-2-project", undefined],
  );
});

test("lifecycle_transition emits the RETURNED state on beril:lifecycle", async () => {
  // The state machine returns "analysis" even though the requested target was "reviewed".
  const { tools, emitted } = harness(async () => ({
    stdout: JSON.stringify({ status: "analysis" }),
    stderr: "",
    code: 0,
    killed: false,
  }));
  await tools.lifecycle_transition.execute("id", { project: "demo", state: "reviewed" }, undefined, undefined, ctx);
  const ev = emitted.find((e) => e[0] === "beril:lifecycle");
  assert.ok(ev, "emitted beril:lifecycle");
  assert.deepEqual(ev?.[1], { project: "demo", state: "analysis" });
});

test("lifecycle_transition emits nothing when the transition throws", async () => {
  const { tools, emitted } = harness(async () => ({
    stdout: "",
    stderr: "illegal transition",
    code: 1,
    killed: false,
  }));
  await assert.rejects(() =>
    tools.lifecycle_transition.execute("id", { project: "demo", state: "complete" }, undefined, undefined, ctx),
  );
  assert.equal(
    emitted.find((e) => e[0] === "beril:lifecycle"),
    undefined,
    "no lifecycle event on failure",
  );
});

test("/submit success emits beril:submitted, not beril:lifecycle", async () => {
  const { commands, emitted } = harness(async (_c: string, args: string[]) => {
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
  assert.deepEqual(
    emitted.find((e) => e[0] === "beril:submitted"),
    ["beril:submitted", { project: "demo" }],
  );
  assert.equal(
    emitted.find((e) => e[0] === "beril:lifecycle"),
    undefined,
    "submit must not claim a lifecycle transition",
  );
});
