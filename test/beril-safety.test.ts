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
const ctx = (hasUI: boolean, confirm: boolean, trusted = true) =>
  ({ hasUI, ui: { confirm: async () => confirm }, isProjectTrusted: () => trusted }) as any;

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

test("flags bash touching sensitive paths", () => {
  assert.equal(isDestructive("bash", { command: "cat .env" }), true);
  assert.equal(isDestructive("bash", { command: "cp app/.env.production /tmp/x" }), true);
  assert.equal(isDestructive("bash", { command: "cat ~/.ssh/id_rsa" }), true);
  assert.equal(isDestructive("bash", { command: "cat ~/.aws/credentials" }), true);
  assert.equal(isDestructive("bash", { command: "openssl x509 -in server.pem" }), true);
  // benign commands must NOT be flagged (guards the .env-vs-"environment" boundary)
  assert.equal(isDestructive("bash", { command: "echo set up the environment" }), false);
  assert.equal(isDestructive("bash", { command: "ls -la src" }), false);
  assert.equal(isDestructive("bash", { command: "python keynote.py" }), false);
});

test("blocks sensitive-path bash when headless", async () => {
  const h = harness();
  const r = await h.tool_call(
    { type: "tool_call", toolName: "bash", input: { command: "cat .env" } },
    ctx(false, true),
  );
  assert.equal(r?.block, true);
});

test("fail-closed: blocks destructive tool when project is untrusted", async () => {
  const h = harness();
  const r = await h.tool_call({ type: "tool_call", toolName: "berdl_export", input: {} }, ctx(true, true, false));
  assert.deepEqual(r, { block: true, reason: "Destructive tool berdl_export blocked: project is not trusted" });
});

test("untrusted project still allows non-destructive tools", async () => {
  const h = harness();
  const r = await h.tool_call({ type: "tool_call", toolName: "berdl_query", input: {} }, ctx(true, true, false));
  assert.equal(r, undefined);
});
