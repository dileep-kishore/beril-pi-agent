import assert from "node:assert/strict";
import { test } from "node:test";
import berilSafety from "../extensions/beril-safety.ts";
import { isDestructive } from "../lib/destructive.ts";

function harness() {
  const handlers: any = {};
  const pi: any = { on: (e: string, h: any) => (handlers[e] = h) };
  berilSafety(pi);
  return handlers;
}
const ctx = (hasUI: boolean, confirm: boolean) => ({ hasUI, ui: { confirm: async () => confirm } }) as any;

test("blocks destructive tool when user declines", async () => {
  const h = harness();
  const r = await h.tool_call({ type: "tool_call", toolName: "berdl_export", input: {} }, ctx(true, false));
  assert.deepEqual(r, { block: true, reason: "User declined berdl_export" });
});

test("allows destructive tool when user confirms", async () => {
  const h = harness();
  const r = await h.tool_call({ type: "tool_call", toolName: "berdl_export", input: {} }, ctx(true, true));
  assert.equal(r, undefined);
});

test("auto-denies destructive tool with no UI", async () => {
  const h = harness();
  const r = await h.tool_call({ type: "tool_call", toolName: "lakehouse_submit", input: {} }, ctx(false, true));
  assert.equal(r?.block, true);
});

test("ignores non-destructive tools", async () => {
  const h = harness();
  const r = await h.tool_call({ type: "tool_call", toolName: "berdl_query", input: {} }, ctx(true, false));
  assert.equal(r, undefined);
});

test("flags destructive bash (mc rm / rm -rf)", () => {
  assert.equal(isDestructive("bash", { command: "mc rm --recursive --force s3a://x" }), true);
  assert.equal(isDestructive("bash", { command: "rm -rf build" }), true);
  assert.equal(isDestructive("bash", { command: "ls -la" }), false);
  assert.equal(isDestructive("berdl_query", {}), false);
  assert.equal(isDestructive("berdl_export", {}), true);
});
