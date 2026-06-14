import assert from "node:assert/strict";
import { test } from "node:test";
import berilCheckpoint from "../extensions/beril-checkpoint.ts";

function harness() {
  const tools: any = {};
  const emitted: { channel: string; data: any }[] = [];
  const pi: any = {
    registerTool: (t: any) => (tools[t.name] = t),
    on: () => {},
    events: { emit: (channel: string, data: any) => emitted.push({ channel, data }) },
  };
  berilCheckpoint(pi);
  return { tools, emitted };
}

const theme = {
  fg: (_c: string, s: string) => s,
  bold: (s: string) => s,
  italic: (s: string) => s,
  strikethrough: (s: string) => s,
  underline: (s: string) => s,
  getColorMode: () => "truecolor",
} as any;

test("registers the request_checkpoint tool", () => {
  assert.ok(harness().tools.request_checkpoint);
});

test("tui mode: returns the choice the overlay resolves and emits the bus event", async () => {
  const { tools, emitted } = harness();
  const ctx = {
    mode: "tui",
    hasUI: true,
    ui: { custom: async () => ({ labels: ["Adjust"] }) },
  };
  const res = await tools.request_checkpoint.execute(
    "id",
    { title: "Plan ready?", options: ["Approve", "Adjust", "Stop"] },
    undefined,
    undefined,
    ctx,
  );
  assert.equal((res.details as any).choice, "Adjust");
  assert.deepEqual((res.details as any).choices, ["Adjust"]);
  assert.match(res.content[0].text, /Adjust/);
  assert.deepEqual(emitted, [{ channel: "beril:checkpoint", data: { title: "Plan ready?", choice: "Adjust" } }]);
});

test("tui mode multi: joins multiple labels into the choice string", async () => {
  const { tools } = harness();
  const ctx = {
    mode: "tui",
    hasUI: true,
    ui: { custom: async () => ({ labels: ["Approve", "Adjust"] }) },
  };
  const res = await tools.request_checkpoint.execute(
    "id",
    { title: "Pick all", multi: true },
    undefined,
    undefined,
    ctx,
  );
  assert.deepEqual((res.details as any).choices, ["Approve", "Adjust"]);
  assert.equal((res.details as any).choice, "Approve, Adjust");
});

test("rpc mode: degrades to single-select via ctx.ui.select", async () => {
  const { tools } = harness();
  let customCalled = false;
  const ctx = {
    mode: "rpc",
    hasUI: true,
    ui: {
      custom: async () => {
        customCalled = true;
        return { labels: [] };
      },
      select: async (_t: string, opts: string[]) => opts[1],
    },
  };
  const res = await tools.request_checkpoint.execute(
    "id",
    { title: "Plan ready?", options: ["Approve", "Adjust", "Stop"] },
    undefined,
    undefined,
    ctx,
  );
  assert.equal(customCalled, false, "custom is TUI-only, must not be used in rpc");
  assert.equal((res.details as any).choices.length, 1);
  assert.equal((res.details as any).choice, "Adjust");
});

test("falls back to proceed (first option) in headless runs", async () => {
  const { tools } = harness();
  const ctx = { mode: "print", hasUI: false, ui: {} };
  const res = await tools.request_checkpoint.execute("id", { title: "Continue?" }, undefined, undefined, ctx);
  assert.match((res.details as any).choice, /Approve and continue \(auto/);
});

test("notes when the scientist dismisses the overlay (and records no decision on the bus)", async () => {
  const { tools, emitted } = harness();
  const ctx = { mode: "tui", hasUI: true, ui: { custom: async () => ({ labels: [] }) } };
  const res = await tools.request_checkpoint.execute("id", { title: "Proceed?" }, undefined, undefined, ctx);
  assert.match((res.details as any).choice, /dismissed/);
  assert.deepEqual((res.details as any).choices, []);
  // A dismissed prompt is a non-decision: it must NOT be broadcast as a "last checkpoint".
  assert.deepEqual(emitted, []);
});

test("renderResult records a single decision in a checkpoint card", async () => {
  const { tools } = harness();
  const ctx = { mode: "tui", hasUI: true, ui: { custom: async () => ({ labels: ["Approve and continue"] }) } };
  const res = await tools.request_checkpoint.execute(
    "id",
    { title: "Plan ready?", summary: "Drafted a 3-notebook plan." },
    undefined,
    undefined,
    ctx,
  );
  const lines = tools.request_checkpoint.renderResult(res, { expanded: false, isPartial: false }, theme).render(60);
  assert.ok(lines.some((l: string) => l.includes("Checkpoint · Plan ready?")));
  assert.ok(lines.some((l: string) => l.includes("Decision:")));
});

test("renderResult lists several decisions when multi-selected", async () => {
  const { tools } = harness();
  const ctx = { mode: "tui", hasUI: true, ui: { custom: async () => ({ labels: ["Approve", "Adjust"] }) } };
  const res = await tools.request_checkpoint.execute(
    "id",
    { title: "Pick all", multi: true },
    undefined,
    undefined,
    ctx,
  );
  const lines = tools.request_checkpoint.renderResult(res, { expanded: false, isPartial: false }, theme).render(60);
  assert.ok(lines.some((l: string) => l.includes("Decisions:")));
});

test("renderResult guards the failure case", () => {
  const { tools } = harness();
  const lines = tools.request_checkpoint
    .renderResult(
      { content: [{ type: "text", text: "boom" }], details: {} },
      { expanded: false, isPartial: false },
      theme,
      { isError: true },
    )
    .render(60);
  assert.ok(lines.some((l: string) => l.includes("Error")));
});
