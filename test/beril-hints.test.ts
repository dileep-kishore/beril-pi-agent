import assert from "node:assert/strict";
import { test } from "node:test";
import berilData from "../extensions/beril-data.ts";

function harness() {
  let handler: any;
  const pi: any = {
    on: (evt: string, h: any) => {
      if (evt === "tool_result") handler = h;
    },
    registerTool: () => {},
    registerCommand: () => {},
    sendUserMessage: () => {},
    exec: async () => ({ stdout: "{}", stderr: "", code: 0, killed: false }),
  };
  berilData(pi);
  return (event: any) => handler(event, { hasUI: false, mode: "json" });
}

const queryEvent = (over: Record<string, unknown> = {}) => ({
  type: "tool_result",
  toolName: "berdl_query",
  toolCallId: "id",
  input: {},
  isError: false,
  content: [{ type: "text", text: "orig" }],
  details: { returned_rows: 100, limit_applied: 100 },
  ...over,
});

test("appends a hint block after the original content on a truncated query", async () => {
  const run = harness();
  const res = await run(queryEvent());
  assert.equal(res.content.length, 2);
  assert.deepEqual(res.content[0], { type: "text", text: "orig" });
  assert.equal(res.content[1].type, "text");
  assert.ok(res.content[1].text.length > 0);
});

test("never includes details in the patch (payload stays byte-identical)", async () => {
  const run = harness();
  const res = await run(queryEvent());
  assert.ok(!("details" in res));
});

test("does nothing for a non-truncated query result", async () => {
  const run = harness();
  const res = await run(queryEvent({ details: { returned_rows: 7, limit_applied: 100 } }));
  assert.equal(res, undefined);
});

test("does nothing when the result is an error", async () => {
  const run = harness();
  const res = await run(queryEvent({ isError: true }));
  assert.equal(res, undefined);
});

test("does nothing for unrelated tools", async () => {
  const run = harness();
  const res = await run(queryEvent({ toolName: "read" }));
  assert.equal(res, undefined);
});

test("appends a hint for berdl_discover when a table is present", async () => {
  const run = harness();
  const res = await run({
    type: "tool_result",
    toolName: "berdl_discover",
    toolCallId: "id",
    input: {},
    isError: false,
    content: [{ type: "text", text: "snap" }],
    // Real berdl_discover snapshot shape: tenants -> collections -> tables.
    details: {
      schema_version: 1,
      tenants: [
        {
          id: "kbase",
          name: "KBase",
          collections: [{ id: "db1", name: "DB One", tables: [{ name: "t1", columns: [] }] }],
        },
      ],
    },
  });
  assert.equal(res.content.length, 2);
  assert.deepEqual(res.content[0], { type: "text", text: "snap" });
  assert.ok(!("details" in res));
});
