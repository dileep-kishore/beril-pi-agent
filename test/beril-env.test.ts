import assert from "node:assert/strict";
import { test } from "node:test";
import berilEnv from "../extensions/beril-env.ts";

const READY = { ready: true, location: "off-cluster", checks: {}, next_steps: [] };

// Minimal shared event bus matching pi.events (emit/on) so listeners can be driven.
function fakeBus() {
  const listeners: Record<string, Array<(data: any) => void>> = {};
  return {
    emit: (channel: string, data: any) => {
      for (const h of listeners[channel] ?? []) h(data);
    },
    on: (channel: string, handler: (data: any) => void) => {
      (listeners[channel] ??= []).push(handler);
      return () => {};
    },
  };
}

function harness(execResult: any = READY) {
  const tools: any = {};
  const commands: any = {};
  const handlers: any = {};
  const events = fakeBus();
  const pi: any = {
    registerTool: (t: any) => (tools[t.name] = t),
    registerCommand: (n: string, o: any) => (commands[n] = o),
    on: (e: string, h: any) => (handlers[e] = h),
    exec: async () => ({ stdout: JSON.stringify(execResult), stderr: "", code: 0, killed: false }),
    events,
  };
  return { pi, tools, commands, handlers, events };
}

function uiCtx(hasUI: boolean) {
  const set: Array<[string, string | undefined]> = [];
  const widgets: Array<[string, string[] | undefined]> = [];
  const notes: string[] = [];
  const ctx: any = {
    hasUI,
    mode: hasUI ? "tui" : "json",
    ui: {
      setStatus: (k: string, v?: string) => set.push([k, v]),
      setWidget: (k: string, v?: string[]) => widgets.push([k, v]),
      notify: (m: string) => notes.push(m),
      theme: { fg: (_c: string, s: string) => s, bold: (s: string) => s },
    },
  };
  return { ctx, set, widgets, notes };
}

/** The lines most recently pushed to the workflow widget, joined for matching. */
function lastWidget(widgets: Array<[string, string[] | undefined]>): string {
  const entry = [...widgets].reverse().find(([k]) => k === "beril-workflow");
  return (entry?.[1] ?? []).join("\n");
}

test("registers env tool + connect/status commands + session hooks", () => {
  const h = harness();
  berilEnv(h.pi);
  assert.ok(h.tools.berdl_env_check, "berdl_env_check tool");
  assert.ok(h.commands["berdl-connect"] && h.commands["berdl-status"], "commands");
  assert.ok(h.handlers.session_start && h.handlers.session_shutdown, "session hooks");
});

test("session_start sets the connection footer and the workflow widget when hasUI", async () => {
  const h = harness();
  berilEnv(h.pi);
  const { ctx, set, widgets } = uiCtx(true);
  await h.handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
  assert.ok(
    set.find(([k]) => k === "beril-connection"),
    "connection footer set",
  );
  assert.ok(
    widgets.find(([k]) => k === "beril-workflow"),
    "workflow widget set",
  );
  assert.match(lastWidget(widgets), /BERDL off-cluster ✓ ready/);
});

test("session_start is a no-op without UI", async () => {
  const h = harness();
  berilEnv(h.pi);
  const { ctx, set, widgets } = uiCtx(false);
  await h.handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
  assert.equal(set.length, 0);
  assert.equal(widgets.length, 0);
});

test("berdl_env_check tool returns readiness in details", async () => {
  const h = harness();
  berilEnv(h.pi);
  const { ctx } = uiCtx(false);
  const res = await h.tools.berdl_env_check.execute("id", {}, undefined, undefined, ctx);
  assert.equal((res.details as any).location, "off-cluster");
  assert.match(res.content[0].text, /ready/);
});

test("session_shutdown clears the connection footer and the widget", async () => {
  const h = harness();
  berilEnv(h.pi);
  const { ctx, set, widgets } = uiCtx(true);
  h.handlers.session_shutdown({ type: "session_shutdown", reason: "quit" }, ctx);
  assert.deepEqual(
    set.find(([k]) => k === "beril-connection"),
    ["beril-connection", undefined],
  );
  assert.deepEqual(
    widgets.find(([k]) => k === "beril-workflow"),
    ["beril-workflow", undefined],
  );
});

test("beril:lifecycle event updates the workflow HUD with the current step + next action", async () => {
  const h = harness();
  berilEnv(h.pi);
  const { ctx, widgets } = uiCtx(true);
  await h.handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
  h.events.emit("beril:lifecycle", { project: "demo", state: "analysis" });
  const hud = lastWidget(widgets);
  assert.match(hud, /▣ demo/, "shows the active project");
  // analysis points the scientist at the review step, with a 'Next' hint.
  assert.match(hud, /▸ review/, "marks the current step");
  assert.match(hud, /Next:.*review the report/, "shows the next action");
});

test("beril:lifecycle event is a no-op without UI", async () => {
  const h = harness();
  berilEnv(h.pi);
  const { ctx, widgets } = uiCtx(false);
  await h.handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
  h.events.emit("beril:lifecycle", { project: "demo", state: "analysis" });
  assert.equal(widgets.length, 0, "no widget when headless");
});

test("beril:submitted event marks the arc submitted in the HUD", async () => {
  const h = harness();
  berilEnv(h.pi);
  const { ctx, widgets } = uiCtx(true);
  await h.handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
  h.events.emit("beril:submitted", { project: "demo" });
  assert.match(lastWidget(widgets), /submitted/i);
});
