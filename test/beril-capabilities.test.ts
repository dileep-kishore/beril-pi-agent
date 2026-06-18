import assert from "node:assert/strict";
import { test } from "node:test";
import berilCapabilities from "../extensions/beril-capabilities.ts";

function harness() {
  const commands: Record<string, any> = {};
  const renderers: Record<string, any> = {};
  const handlers: Record<string, any> = {};
  const shortcuts: Record<string, any> = {};
  const messages: any[] = [];
  const pi: any = {
    registerCommand: (name: string, opts: any) => (commands[name] = opts),
    registerMessageRenderer: (name: string, renderer: any) => (renderers[name] = renderer),
    registerShortcut: (key: string, opts: any) => (shortcuts[key] = opts),
    on: (event: string, handler: any) => (handlers[event] = handler),
    sendMessage: (message: any, options: any) => messages.push({ message, options }),
    getCommands: () => [{ name: "skills" }, { name: "whereami" }],
    getAllTools: () => [{ name: "berdl_query" }, { name: "claim_state" }],
  };
  berilCapabilities(pi);
  return { commands, renderers, handlers, shortcuts, messages };
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
  const res = await h.handlers.before_agent_start({
    prompt: "Can we find literature that refutes this?",
    systemPrompt: "base",
  });
  assert.match(res.systemPrompt, /Possible BERIL route/);
  assert.match(res.systemPrompt, /or keep exploring/i);
  assert.equal(res.message.customType, "beril-skill-nudge");
  assert.match(res.message.content, /literature/i);
  assert.match(res.message.content, /Use it only if it fits/i);
});
