import assert from "node:assert/strict";
import { test } from "node:test";
import berilReroll from "../extensions/beril-reroll.ts";

function harness() {
  const commands: Record<string, any> = {};
  const eventHandlers: Record<string, any[]> = {};
  const labels = new Map<string, string | undefined>();
  const pi: any = {
    registerCommand: (name: string, opts: any) => (commands[name] = opts),
    on: () => {},
    setLabel: (id: string, label: string | undefined) => labels.set(id, label),
    events: {
      on: (name: string, handler: any) => {
        eventHandlers[name] ??= [];
        eventHandlers[name].push(handler);
      },
    },
  };
  berilReroll(pi);
  return { commands, eventHandlers, labels };
}

function ctx() {
  const notes: string[] = [];
  const forked: any[] = [];
  const entries = [{ id: "a" }, { id: "b" }];
  const labelMap = new Map([
    ["a", "beril:demo:proposed"],
    ["b", "beril:demo:checkpoint:first-result"],
  ]);
  return {
    notes,
    forked,
    ctx: {
      hasUI: true,
      mode: "tui",
      ui: { notify: (m: string) => notes.push(m) },
      fork: async (id: string, opts: any) => {
        forked.push({ id, opts });
        return { cancelled: false };
      },
      sessionManager: {
        getEntries: () => entries,
        getLabel: (id: string) => labelMap.get(id),
        getLeafEntry: () => entries[1],
      },
    },
  };
}

test("registers bookmark and reroll commands", () => {
  const h = harness();
  assert.ok(h.commands["bookmark-science"]);
  assert.ok(h.commands["back-to-plan"]);
  assert.ok(h.commands["reroll-analysis-from"]);
});

test("/reroll-analysis-from forks from a matching label", async () => {
  const h = harness();
  const c = ctx();
  await h.commands["reroll-analysis-from"].handler("first-result", c.ctx);
  assert.deepEqual(c.forked[0], { id: "b", opts: { position: "at" } });
});

test("lifecycle event labels the current leaf when a session context is known", async () => {
  const h = harness();
  const c = ctx();
  await h.commands["bookmark-science"].handler("manual", c.ctx);
  h.eventHandlers["beril:lifecycle"][0]({ project: "demo", state: "analysis" });
  assert.equal(h.labels.get("b"), "beril:demo:analysis");
});
