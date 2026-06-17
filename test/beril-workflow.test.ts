import assert from "node:assert/strict";
import { test } from "node:test";
import berilWorkflow from "../extensions/beril-workflow.ts";
import { resetReadinessCache, setCachedEnv } from "../lib/readiness.ts";
import { buildWorkflowView, recommendedActions, recommendedCommand } from "../lib/workflow.ts";

const fakeTheme = {
  fg: (_c: string, s: string) => s,
  bold: (s: string) => s,
  getColorMode: () => "truecolor" as const,
} as any;

function harness(execMap: Record<string, unknown>) {
  const commands: Record<string, any> = {};
  const renderers: Record<string, any> = {};
  const messages: any[] = [];
  const notes: string[] = [];
  const pi: any = {
    registerCommand: (name: string, opts: any) => {
      commands[name] = opts;
    },
    registerMessageRenderer: (type: string, renderer: any) => {
      renderers[type] = renderer;
    },
    sendMessage: (message: any, options: any) => {
      messages.push({ message, options });
    },
    exec: async (_cmd: string, args: string[]) => {
      const key = args.join(" ");
      if (!(key in execMap)) return { stdout: "{}", stderr: "", code: 0, killed: false };
      const value = execMap[key];
      if (value instanceof Error) return { stdout: "", stderr: value.message, code: 2, killed: false };
      return { stdout: JSON.stringify(value), stderr: "", code: 0, killed: false };
    },
  };
  const ctx: any = { hasUI: true, ui: { notify: (m: string) => notes.push(m) } };
  berilWorkflow(pi);
  return { commands, renderers, messages, notes, ctx };
}

test("recommendedCommand maps lifecycle state to deterministic commands", () => {
  assert.equal(recommendedCommand("analysis", "demo"), "/berdl-review demo");
  assert.equal(recommendedCommand("reviewed", "demo"), "/submit demo");
  assert.equal(recommendedCommand(undefined), "/berdl-status");
  assert.equal(recommendedCommand("exploration", "demo"), "/berdl-preview <table>");
});

test("recommendedActions gives concrete next commands per lifecycle phase", () => {
  assert.equal(recommendedActions(undefined)[0], "frame the question");
  assert.equal(recommendedActions("exploration", "demo")[0], "frame the question");
  assert.deepEqual(recommendedActions("active", "demo").slice(0, 2), [
    "/analyze demo --first-result",
    "/analyze demo --continue",
  ]);
  assert.ok(recommendedActions("analysis", "demo").includes("/berdl-refute demo"));
  assert.ok(recommendedActions("reviewed", "demo").includes("/submit demo"));
});

test("buildWorkflowView combines lifecycle, research_state, and cached env", () => {
  const view = buildWorkflowView(
    { project: "demo", status: "analysis" },
    {
      project: "demo",
      phase: "analysis",
      claims: { total: 3, supported: 1, refuted: 1 },
      lastCheckpoint: "Plan -> approve",
    },
    { location: "off-cluster", ready: true, checks: {}, next_steps: [] },
  );
  assert.equal(view.phase, "review");
  assert.equal(view.command, "/berdl-review demo");
  assert.deepEqual(view.env, { location: "off-cluster", ready: true });
  assert.equal(view.lastCheckpoint, "Plan -> approve");
});

test("/whereami emits a Pi custom card for the active project", async () => {
  resetReadinessCache();
  setCachedEnv({ location: "off-cluster", ready: true, checks: {}, next_steps: [] });
  const h = harness({
    "lifecycle current": { project: "demo", status: "analysis" },
    "lifecycle session-state demo --get": {
      project: "demo",
      phase: "analysis",
      claims: { total: 2, supported: 1, refuted: 0 },
      lastCheckpoint: "First figure? -> continue",
    },
  });
  await h.commands.whereami.handler("", h.ctx);
  assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0].message.customType, "beril-workflow-status");
  assert.equal(h.messages[0].message.details.focus, "whereami");
  assert.equal(h.messages[0].message.details.view.project, "demo");
  assert.match(h.notes[0], /Current project: demo/);

  const rendered = h.renderers["beril-workflow-status"](h.messages[0].message, {}, fakeTheme).render(100).join("\n");
  assert.match(rendered, /Where am I\?/);
  assert.match(rendered, /First figure\? -> continue/);
  assert.match(rendered, /\/berdl-review demo/);
});

test("/next degrades gracefully when there is no active project", async () => {
  resetReadinessCache();
  const h = harness({ "lifecycle current": {} });
  await h.commands.next.handler("", h.ctx);
  const view = h.messages[0].message.details.view;
  assert.equal(view.project, undefined);
  assert.match(view.command, /berdl-status/);
  assert.match(h.messages[0].message.content, /Next:/);
  const rendered = h.renderers["beril-workflow-status"](h.messages[0].message, {}, fakeTheme).render(100).join("\n");
  assert.match(rendered, /Next step/);
  assert.match(rendered, /Project\s+\(none\)/);
});
