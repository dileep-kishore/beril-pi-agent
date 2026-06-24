import assert from "node:assert/strict";
import { test } from "node:test";
import berilCapabilities from "../extensions/beril-capabilities.ts";
import { recommendedCommand } from "../lib/workflow.ts";

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

type ExecFixture = any | ((args: string[]) => any | Promise<any>);

function harness(execResult: ExecFixture = {}) {
  const commands: Record<string, any> = {};
  const renderers: Record<string, any> = {};
  const handlers: Record<string, any> = {};
  const shortcuts: Record<string, any> = {};
  const messages: any[] = [];
  const events = fakeBus();
  const pi: any = {
    registerCommand: (name: string, opts: any) => (commands[name] = opts),
    registerMessageRenderer: (name: string, renderer: any) => (renderers[name] = renderer),
    registerShortcut: (key: string, opts: any) => (shortcuts[key] = opts),
    on: (event: string, handler: any) => (handlers[event] = handler),
    sendMessage: (message: any, options: any) => messages.push({ message, options }),
    getCommands: () => [{ name: "skills" }, { name: "whereami" }],
    getAllTools: () => [{ name: "berdl_query" }, { name: "claim_state" }],
    exec: async (_cmd: string, args: string[]) => {
      const payload = typeof execResult === "function" ? await execResult(args) : execResult;
      return { stdout: JSON.stringify(payload), stderr: "", code: 0, killed: false };
    },
    events,
  };
  berilCapabilities(pi);
  return { commands, renderers, handlers, shortcuts, messages, events };
}

/** A trusted, interactive hook ctx; override per test (e.g. untrusted, headless). */
function ctx(over: Record<string, any> = {}) {
  return {
    isProjectTrusted: () => true,
    hasUI: true,
    mode: "tui",
    sessionManager: { getBranch: () => [] },
    ...over,
  } as any;
}

const theme = {
  fg: (_c: string, s: string) => s,
  bold: (s: string) => s,
  dim: (s: string) => s,
  italic: (s: string) => s,
  strikethrough: (s: string) => s,
  underline: (s: string) => s,
  getColorMode: () => "truecolor",
} as any;

test("registers /skills and /capabilities", async () => {
  const h = harness();
  assert.ok(h.commands.skills);
  assert.ok(h.commands.capabilities);
  await h.commands.skills.handler("", { hasUI: true, ui: { notify: () => {} } });
  assert.equal(h.messages[0].message.customType, "beril-capabilities");
  assert.match(h.messages[0].message.content, /BERIL Guide/);
  assert.match(h.messages[0].message.content, /Explore data/);
  assert.doesNotMatch(h.messages[0].message.content, /Tools:/);
  assert.deepEqual(h.messages[0].options, { triggerTurn: false });
});

test("/capabilities --all shows the expert inventory", async () => {
  const h = harness();
  await h.commands.capabilities.handler("--all", { hasUI: true, ui: { notify: () => {} } });
  assert.equal(h.messages[0].message.customType, "beril-capabilities");
  assert.match(h.messages[0].message.content, /BERIL Capability Inventory/);
  assert.match(h.messages[0].message.content, /Tools:/);
});

test("capability shortcut also displays immediately", () => {
  const h = harness();
  const shortcut = Object.values(h.shortcuts)[0] as any;
  shortcut.handler({ hasUI: true });
  assert.equal(h.messages[0].message.customType, "beril-capabilities");
  assert.deepEqual(h.messages[0].options, { triggerTurn: false });
});

test("renders the capability catalog as a custom card", () => {
  const h = harness();
  const component = h.renderers["beril-capabilities"]({ details: { markdown: "# Capabilities\n\n- item" } }, {}, theme);
  assert.match(component.render(80).join("\n"), /Capabilities/);
});

test("before_agent_start injects a visible route nudge and system hint", async () => {
  const h = harness();
  const res = await h.handlers.before_agent_start(
    { prompt: "Can we find literature that refutes this?", systemPrompt: "base" },
    ctx(),
  );
  assert.match(res.systemPrompt, /Possible BERIL route/);
  assert.match(res.systemPrompt, /or keep exploring/i);
  assert.equal(res.message.customType, "beril-skill-nudge");
  assert.match(res.message.content, /literature/i);
  assert.match(res.message.content, /Use it only if it fits/i);
});

test("untrusted project suppresses the nudge entirely (fail-closed)", async () => {
  const h = harness();
  const res = await h.handlers.before_agent_start(
    { prompt: "let's discover the schema", systemPrompt: "base" },
    ctx({ isProjectTrusted: () => false }),
  );
  assert.equal(res, undefined);
});

test("headless mode suppresses the nudge", async () => {
  const h = harness();
  const res = await h.handlers.before_agent_start(
    { prompt: "let's discover the schema", systemPrompt: "base" },
    ctx({ hasUI: false, mode: "json" }),
  );
  assert.equal(res, undefined);
});

test("a matched route is nudged at most once per status (throttle)", async () => {
  const h = harness();
  const event = { prompt: "find literature on this", systemPrompt: "base" };
  const first = await h.handlers.before_agent_start(event, ctx());
  assert.equal(first.message.customType, "beril-skill-nudge");
  const second = await h.handlers.before_agent_start(event, ctx());
  assert.equal(second, undefined, "second identical turn in the same status is throttled");
});

test("a lifecycle status change re-arms the nudge", async () => {
  const h = harness();
  const event = { prompt: "find literature on this", systemPrompt: "base" };
  assert.ok(await h.handlers.before_agent_start(event, ctx()));
  assert.equal(await h.handlers.before_agent_start(event, ctx()), undefined);
  h.events.emit("beril:lifecycle", { project: "aquila", state: "active" });
  const after = await h.handlers.before_agent_start(event, ctx());
  assert.ok(after, "the same match nudges again after the phase changes");
  assert.match(after.message.content, /literature/i);
});

test("an off-phase match redirects to the phase-correct command, not the matched route", async () => {
  const h = harness();
  h.events.emit("beril:lifecycle", { project: "aquila", state: "exploration" });
  const res = await h.handlers.before_agent_start(
    { prompt: "can we submit this project now?", systemPrompt: "base" },
    ctx(),
  );
  assert.ok(res, "an off-phase prompt still produces a steer (a redirect)");
  assert.equal(res.message.details.command, recommendedCommand("exploration", "aquila"));
  assert.match(res.message.content, /\/berdl-preview <table>/);
  assert.doesNotMatch(res.message.content, /Possible BERIL route: Submit/);
  // The redirect shares one throttle key per status.
  const again = await h.handlers.before_agent_start(
    { prompt: "approve and publish please", systemPrompt: "base" },
    ctx(),
  );
  assert.equal(again, undefined, "a second off-phase prompt in the same status is throttled");
});

test("session_start seeds the phase cache from `lifecycle current` (reason-gated)", async () => {
  const h = harness((args: string[]) =>
    args.join(" ") === "lifecycle current" ? { project: "aquila", status: "active" } : {},
  );
  await h.handlers.session_start({ reason: "startup" }, ctx());
  // With status seeded to `active`, a `submit` prompt is off-phase → redirect.
  const res = await h.handlers.before_agent_start({ prompt: "let's submit this", systemPrompt: "base" }, ctx());
  assert.ok(res);
  assert.equal(res.message.details.command, recommendedCommand("active", "aquila"));
  assert.doesNotMatch(res.message.content, /Possible BERIL route: Submit/);
});

test("session_start does not seed on a fresh `/new` session", async () => {
  let called = false;
  const h = harness(() => {
    called = true;
    return { project: "aquila", status: "active" };
  });
  await h.handlers.session_start({ reason: "new" }, ctx());
  assert.equal(called, false, "a fresh /new session must not gate on a stale prior project");
});

test("unknown status does not gate: even a far-ahead route nudges once, then throttles", async () => {
  const h = harness();
  const event = { prompt: "let's submit this", systemPrompt: "base" };
  const first = await h.handlers.before_agent_start(event, ctx());
  assert.ok(first, "unknown phase falls through to the keyword nudge");
  assert.match(first.message.content, /Possible BERIL route/);
  const second = await h.handlers.before_agent_start(event, ctx());
  assert.equal(second, undefined, "throttled under the @unknown key");
});

test("a casual 'I updated the data table' no longer matches the discover route", async () => {
  const h = harness();
  const res = await h.handlers.before_agent_start({ prompt: "I updated the data table", systemPrompt: "base" }, ctx());
  assert.equal(res, undefined, "generic data/table words must not trip the discover nudge");
});
