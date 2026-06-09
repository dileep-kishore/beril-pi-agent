import assert from "node:assert/strict";
import { test } from "node:test";
import berilDisplay from "../extensions/beril-display.ts";

function harness() {
  const handlers: Record<string, any> = {};
  const pi: any = { on: (e: string, h: any) => (handlers[e] = h) };
  berilDisplay(pi);
  return { handlers };
}

function ctx(mode: string) {
  const calls: boolean[] = [];
  return { c: { mode, ui: { setToolsExpanded: (b: boolean) => calls.push(b) } } as any, calls };
}

test("registers a session_start handler", () => {
  assert.ok(harness().handlers.session_start);
});

test("collapses routine tool output by default in TUI", () => {
  const { handlers } = harness();
  const { c, calls } = ctx("tui");
  handlers.session_start({ type: "session_start", reason: "startup" }, c);
  assert.deepEqual(calls, [false]);
});

test("is a no-op outside the TUI (headless modes)", () => {
  const { handlers } = harness();
  for (const mode of ["json", "print", "rpc"]) {
    const { c, calls } = ctx(mode);
    handlers.session_start({ type: "session_start", reason: "startup" }, c);
    assert.equal(calls.length, 0, `no toggle in ${mode}`);
  }
});
