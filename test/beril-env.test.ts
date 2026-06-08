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
  const shortcuts: any = {};
  const renderers: any = {};
  const messages: any[] = [];
  const events = fakeBus();
  const pi: any = {
    registerTool: (t: any) => (tools[t.name] = t),
    registerCommand: (n: string, o: any) => (commands[n] = o),
    registerShortcut: (k: string, o: any) => (shortcuts[k] = o),
    registerMessageRenderer: (t: string, r: any) => (renderers[t] = r),
    sendMessage: (m: any) => messages.push(m),
    on: (e: string, h: any) => (handlers[e] = h),
    exec: async () => ({ stdout: JSON.stringify(execResult), stderr: "", code: 0, killed: false }),
    events,
  };
  return { pi, tools, commands, handlers, shortcuts, renderers, messages, events };
}

function uiCtx(hasUI: boolean) {
  const set: Array<[string, string | undefined]> = [];
  const widgets: Array<[string, string[] | undefined]> = [];
  const notes: string[] = [];
  const headerCalls: Array<unknown> = [];
  const theme = { fg: (_c: string, s: string) => s, bold: (s: string) => s };
  const tui = { requestRender: () => {} };
  const footerData = {
    onBranchChange: () => () => {},
    getGitBranch: () => null,
    getExtensionStatuses: () => new Map(),
  };
  let footerFactory: any;
  let headerFactory: any;
  const ctx: any = {
    hasUI,
    mode: hasUI ? "tui" : "json",
    model: { id: "opus-4.8" },
    getContextUsage: () => ({ tokens: 1000, percent: 12, contextWindow: 200_000 }),
    ui: {
      setStatus: (k: string, v?: string) => set.push([k, v]),
      setWidget: (k: string, v?: string[]) => widgets.push([k, v]),
      notify: (m: string) => notes.push(m),
      setFooter: (f: any) => {
        footerFactory = f;
      },
      setHeader: (f: any) => {
        headerFactory = f;
        headerCalls.push(f);
      },
      theme,
    },
  };
  const renderFooter = (width = 100): string =>
    footerFactory ? footerFactory(tui, theme, footerData).render(width).join("\n") : "";
  const renderHeader = (width = 100): string =>
    headerFactory ? headerFactory(tui, theme).render(width).join("\n") : "";
  return { ctx, set, widgets, notes, headerCalls, renderFooter, renderHeader };
}

/** The lines most recently pushed to the workflow widget, joined for matching. */
function lastWidget(widgets: Array<[string, string[] | undefined]>): string {
  const entry = [...widgets].reverse().find(([k]) => k === "beril-workflow");
  return (entry?.[1] ?? []).join("\n");
}

test("registers env tool + connect/status/welcome commands + session hooks", () => {
  const h = harness();
  berilEnv(h.pi);
  assert.ok(h.tools.berdl_env_check, "berdl_env_check tool");
  assert.ok(h.commands["berdl-connect"] && h.commands["berdl-status"], "connect/status commands");
  assert.ok(h.commands["berdl-welcome"], "welcome command");
  assert.ok(h.handlers.session_start && h.handlers.session_shutdown && h.handlers.input, "session + input hooks");
});

test("session_start sets the connection chip, the HUD, and the rich footer when hasUI", async () => {
  const h = harness();
  berilEnv(h.pi);
  const { ctx, set, widgets, renderFooter } = uiCtx(true);
  await h.handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
  const chip = set.find(([k]) => k === "beril-connection");
  assert.equal(chip?.[1], "BERDL off-cluster ✓ ready", "connection chip (RPC fallback)");
  assert.ok(
    widgets.find(([k]) => k === "beril-workflow"),
    "workflow widget set",
  );
  // The statusline owns connection + model now.
  const footer = renderFooter();
  assert.match(footer, /BERDL off-cluster ✓/, "footer shows the compact connection");
  assert.match(footer, /opus-4\.8/, "footer shows the model");
  assert.match(footer, /ctx 12%/, "footer shows context usage");
});

test("session_start greets with the welcome header on a fresh start", async () => {
  const h = harness();
  berilEnv(h.pi);
  const { ctx, renderHeader } = uiCtx(true);
  await h.handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
  const header = renderHeader();
  assert.match(header, /beril/, "branded title");
  assert.match(header, /explore/, "the research arc");
});

test("a reload does not re-show the welcome header", async () => {
  const h = harness();
  berilEnv(h.pi);
  const { ctx, renderHeader } = uiCtx(true);
  await h.handlers.session_start({ type: "session_start", reason: "reload" }, ctx);
  assert.equal(renderHeader(), "", "no header on reload");
});

test("the welcome header clears on first input", async () => {
  const h = harness();
  berilEnv(h.pi);
  const { ctx, headerCalls } = uiCtx(true);
  await h.handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
  assert.equal(typeof headerCalls.at(-1), "function", "header installed at startup");
  await h.handlers.input({ type: "input", text: "hi", source: "interactive" }, ctx);
  assert.equal(headerCalls.at(-1), undefined, "header cleared on first input");
});

test("session_start is a no-op without UI", async () => {
  const h = harness();
  berilEnv(h.pi);
  const { ctx, set, widgets, renderFooter, renderHeader } = uiCtx(false);
  await h.handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
  assert.equal(set.length, 0);
  assert.equal(widgets.length, 0);
  assert.equal(renderFooter(), "", "no custom footer when headless");
  assert.equal(renderHeader(), "", "no header when headless");
});

test("berdl_env_check tool returns readiness in details", async () => {
  const h = harness();
  berilEnv(h.pi);
  const { ctx } = uiCtx(false);
  const res = await h.tools.berdl_env_check.execute("id", {}, undefined, undefined, ctx);
  assert.equal((res.details as any).location, "off-cluster");
  assert.match(res.content[0].text, /ready/);
});

test("session_shutdown clears the chip, the widget, the footer, and the header", async () => {
  const h = harness();
  berilEnv(h.pi);
  const { ctx, set, widgets, headerCalls } = uiCtx(true);
  await h.handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
  h.handlers.session_shutdown({ type: "session_shutdown", reason: "quit" }, ctx);
  assert.deepEqual(
    set.find(([k]) => k === "beril-connection" && k),
    ["beril-connection", "BERDL off-cluster ✓ ready"],
  );
  assert.deepEqual([...set].reverse()[0], ["beril-connection", undefined], "chip cleared last");
  assert.deepEqual([...widgets].reverse()[0], ["beril-workflow", undefined], "widget cleared");
  assert.equal(headerCalls.at(-1), undefined, "header cleared");
});

test("beril:lifecycle puts the step rail in the HUD and the project in the footer", async () => {
  const h = harness();
  berilEnv(h.pi);
  const { ctx, widgets, renderFooter } = uiCtx(true);
  await h.handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
  h.events.emit("beril:lifecycle", { project: "demo", state: "analysis" });
  const hud = lastWidget(widgets);
  // analysis points the scientist at the review step, with a 'Next' hint.
  assert.match(hud, /▸ review/, "marks the current step in the HUD");
  assert.match(hud, /Next:.*review the report/, "shows the next action");
  assert.doesNotMatch(hud, /▣ demo/, "project no longer duplicated in the HUD");
  assert.match(renderFooter(), /▣ demo/, "project shows in the footer");
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

test("registers the phase-banner renderer and the orientation shortcut", () => {
  const h = harness();
  berilEnv(h.pi);
  assert.ok(h.renderers["beril-phase"], "phase-banner renderer");
  const keys = Object.keys(h.shortcuts);
  assert.equal(keys.length, 1, "one shortcut registered");
  assert.match(h.shortcuts[keys[0]].description, /orientation/i, "the orientation shortcut");
});

test("a lifecycle phase change pins a banner — once per phase, not per event", async () => {
  const h = harness();
  berilEnv(h.pi);
  const { ctx } = uiCtx(true);
  await h.handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
  h.events.emit("beril:lifecycle", { project: "demo", state: "analysis" }); // → review phase
  h.events.emit("beril:lifecycle", { project: "demo", state: "analysis" }); // same phase, no banner
  assert.equal(h.messages.length, 1, "one banner for the analysis→review phase");
  assert.equal(h.messages[0].customType, "beril-phase");
  assert.match(h.messages[0].content, /review/);
  h.events.emit("beril:lifecycle", { project: "demo", state: "reviewed" }); // → submit phase
  assert.equal(h.messages.length, 2, "a new banner when the phase actually changes");
});

test("phase banners are suppressed without UI", async () => {
  const h = harness();
  berilEnv(h.pi);
  const { ctx } = uiCtx(false);
  await h.handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
  h.events.emit("beril:lifecycle", { project: "demo", state: "analysis" });
  assert.equal(h.messages.length, 0, "no banner when headless");
});
