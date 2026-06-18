import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import berilAudit from "../extensions/beril-audit.ts";

function harness() {
  const tools: any = {};
  const commands: any = {};
  const handlers: Record<string, any> = {};
  const messages: string[] = [];
  const pi: any = {
    registerTool: (t: any) => (tools[t.name] = t),
    registerCommand: (n: string, o: any) => (commands[n] = o),
    on: (event: string, handler: any) => {
      handlers[event] = handler;
    },
    sendUserMessage: (m: string) => messages.push(m),
  };
  berilAudit(pi);
  return { tools, commands, handlers, messages };
}

test("registers provenance and trace tools/commands", () => {
  const h = harness();
  assert.ok(h.tools.project_provenance);
  assert.ok(h.tools.project_trace);
  assert.ok(h.commands.provenance);
  assert.ok(h.commands.trace);
});

test("project_provenance writes and returns current runtime context", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "beril-audit-"));
  await mkdir(join(cwd, "projects", "demo"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({
      version: "0.1.0",
      devDependencies: { "@earendil-works/pi-coding-agent": "0.79.1" },
    }),
  );
  const h = harness();
  const res = await h.tools.project_provenance.execute("id", { project: "demo" }, undefined, undefined, {
    cwd,
    mode: "json",
    model: { id: "model-x" },
  });
  assert.equal((res.details as any).project, "demo");
  assert.equal((res.details as any).runtime.model_id, "model-x");
  assert.match(await readFile(join(cwd, "projects", "demo", "provenance.json"), "utf8"), /model-x/);
});

test("project_trace reads recent rows", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "beril-trace-"));
  await mkdir(join(cwd, "projects", "demo"), { recursive: true });
  await writeFile(
    join(cwd, "projects", "demo", "TRACE.jsonl"),
    `${JSON.stringify({ at: "a", project: "demo", event: "one" })}\n${JSON.stringify({
      at: "b",
      project: "demo",
      event: "two",
    })}\n`,
  );
  const h = harness();
  const res = await h.tools.project_trace.execute("id", { project: "demo", limit: 1 }, undefined, undefined, { cwd });
  assert.equal((res.details as any).rows.length, 1);
  assert.equal((res.details as any).rows[0].event, "two");
});

test("tool_execution_start appends trace when args include a project", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "beril-trace-hook-"));
  await mkdir(join(cwd, "projects", "demo"), { recursive: true });
  const h = harness();
  await h.handlers.tool_execution_start(
    { type: "tool_execution_start", toolCallId: "tc1", toolName: "notebook_run", args: { project: "demo" } },
    { cwd },
  );
  const rows = (await readFile(join(cwd, "projects", "demo", "TRACE.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(rows[0].event, "tool_execution_start");
  assert.equal(rows[0].tool, "notebook_run");
});

test("/aside input is not traced", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "beril-aside-trace-"));
  await mkdir(join(cwd, "projects", "demo"), { recursive: true });
  const h = harness();
  await h.handlers.input({ type: "input", text: "/aside private", source: "interactive" }, { cwd });
  await assert.rejects(() => readFile(join(cwd, "projects", "demo", "TRACE.jsonl"), "utf8"), /ENOENT/);
});
