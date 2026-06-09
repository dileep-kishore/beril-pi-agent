import assert from "node:assert/strict";
import { test } from "node:test";
import berilCheckpoint from "../extensions/beril-checkpoint.ts";

function harness() {
  const tools: any = {};
  const pi: any = { registerTool: (t: any) => (tools[t.name] = t), on: () => {} };
  berilCheckpoint(pi);
  return tools;
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
  assert.ok(harness().request_checkpoint);
});

test("returns the scientist's selected choice when there is a UI", async () => {
  const tools = harness();
  const ctx = { hasUI: true, ui: { select: async (_t: string, opts: string[]) => opts[1] } };
  const res = await tools.request_checkpoint.execute(
    "id",
    { title: "Plan ready?", options: ["Approve", "Adjust", "Stop"] },
    undefined,
    undefined,
    ctx,
  );
  assert.equal((res.details as any).choice, "Adjust");
  assert.match(res.content[0].text, /Adjust/);
});

test("falls back to proceed (first option) in headless runs", async () => {
  const tools = harness();
  const ctx = { hasUI: false, ui: {} };
  const res = await tools.request_checkpoint.execute("id", { title: "Continue?" }, undefined, undefined, ctx);
  assert.match((res.details as any).choice, /Approve and continue \(auto/);
});

test("notes when the scientist dismisses the prompt", async () => {
  const tools = harness();
  const ctx = { hasUI: true, ui: { select: async () => undefined } };
  const res = await tools.request_checkpoint.execute("id", { title: "Proceed?" }, undefined, undefined, ctx);
  assert.match((res.details as any).choice, /dismissed/);
});

test("renderResult records the decision in a checkpoint card", async () => {
  const tools = harness();
  const ctx = { hasUI: true, ui: { select: async (_t: string, o: string[]) => o[0] } };
  const res = await tools.request_checkpoint.execute(
    "id",
    { title: "Plan ready?", summary: "Drafted a 3-notebook plan." },
    undefined,
    undefined,
    ctx,
  );
  const lines = tools.request_checkpoint.renderResult(res, { expanded: false, isPartial: false }, theme).render(60);
  assert.ok(lines.some((l: string) => l.includes("Checkpoint · Plan ready?")));
});
