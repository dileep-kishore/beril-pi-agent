import assert from "node:assert/strict";
import { test } from "node:test";
import berilEnv from "../extensions/beril-env.ts";

const READY = { ready: true, location: "off-cluster", checks: {}, next_steps: [] };

function harness(execResult: any = READY) {
  const tools: any = {};
  const commands: any = {};
  const handlers: any = {};
  const pi: any = {
    registerTool: (t: any) => (tools[t.name] = t),
    registerCommand: (n: string, o: any) => (commands[n] = o),
    on: (e: string, h: any) => (handlers[e] = h),
    exec: async () => ({ stdout: JSON.stringify(execResult), stderr: "", code: 0, killed: false }),
  };
  return { pi, tools, commands, handlers };
}

function uiCtx(hasUI: boolean) {
  const set: Array<[string, string | undefined]> = [];
  const notes: string[] = [];
  const ctx: any = {
    hasUI,
    mode: hasUI ? "tui" : "json",
    ui: {
      setStatus: (k: string, v?: string) => set.push([k, v]),
      notify: (m: string) => notes.push(m),
      theme: { fg: (_c: string, s: string) => s },
    },
  };
  return { ctx, set, notes };
}

test("registers env tool + connect/status commands + session hooks", () => {
  const h = harness();
  berilEnv(h.pi);
  assert.ok(h.tools.berdl_env_check, "berdl_env_check tool");
  assert.ok(h.commands["berdl-connect"] && h.commands["berdl-status"], "commands");
  assert.ok(h.handlers.session_start && h.handlers.session_shutdown, "session hooks");
});

test("session_start sets a connection status widget when hasUI", async () => {
  const h = harness();
  berilEnv(h.pi);
  const { ctx, set } = uiCtx(true);
  await h.handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
  assert.ok(set.find(([k]) => k === "beril-connection"));
});

test("session_start is a no-op without UI", async () => {
  const h = harness();
  berilEnv(h.pi);
  const { ctx, set } = uiCtx(false);
  await h.handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
  assert.equal(set.length, 0);
});

test("berdl_env_check tool returns readiness in details", async () => {
  const h = harness();
  berilEnv(h.pi);
  const { ctx } = uiCtx(false);
  const res = await h.tools.berdl_env_check.execute("id", {}, undefined, undefined, ctx);
  assert.equal((res.details as any).location, "off-cluster");
  assert.match(res.content[0].text, /ready/);
});

test("session_shutdown clears the status widget", async () => {
  const h = harness();
  berilEnv(h.pi);
  const { ctx, set } = uiCtx(true);
  h.handlers.session_shutdown({ type: "session_shutdown", reason: "quit" }, ctx);
  assert.deepEqual(set.at(-1), ["beril-connection", undefined]);
});
