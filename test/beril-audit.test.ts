import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import berilAudit from "../extensions/beril-audit.ts";

function harness(exec?: any) {
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
    exec: exec ?? (async () => ({ code: 0, stdout: "{}", stderr: "" })),
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

test("project_provenance reads an existing snapshot without writing (COMP-1)", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "beril-audit-"));
  const dir = join(cwd, "projects", "demo");
  await mkdir(dir, { recursive: true });
  const provenancePath = join(dir, "provenance.json");
  await writeFile(provenancePath, JSON.stringify({ project: "demo", runtime: { model_id: "model-x" } }));
  const before = (await stat(provenancePath)).mtimeMs;
  // The mtime is what `beril lifecycle current` maxes over; a read must not bump it.
  await new Promise((r) => setTimeout(r, 10));
  const h = harness();
  const res = await h.tools.project_provenance.execute("id", { project: "demo" }, undefined, undefined, {
    cwd,
    mode: "json",
    model: { id: "model-y" },
  });
  // Read-only: returns the stored snapshot verbatim, never the live runtime.
  assert.equal((res.details as any).project, "demo");
  assert.equal((res.details as any).runtime.model_id, "model-x");
  assert.equal((await stat(provenancePath)).mtimeMs, before);
});

test("project_provenance reports cleanly when no snapshot exists", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "beril-audit-none-"));
  await mkdir(join(cwd, "projects", "demo"), { recursive: true });
  const h = harness();
  const res = await h.tools.project_provenance.execute("id", { project: "demo" }, undefined, undefined, {
    cwd,
    mode: "json",
  });
  assert.equal((res.details as any).project, "demo");
  assert.match(res.content[0].text, /No provenance recorded yet/);
  await assert.rejects(() => readFile(join(cwd, "projects", "demo", "provenance.json"), "utf8"), /ENOENT/);
});

test("before_agent_start writes provenance for the ACTIVE project only", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "beril-audit-active-"));
  await mkdir(join(cwd, "projects", "active"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({
      version: "0.1.0",
      devDependencies: { "@earendil-works/pi-coding-agent": "0.79.1" },
    }),
  );
  const exec = async () => ({ code: 0, stdout: JSON.stringify({ project: "active", status: "analysis" }), stderr: "" });
  const h = harness(exec);
  const out = await h.handlers.before_agent_start(
    { type: "before_agent_start", systemPrompt: "base" },
    { cwd, mode: "json", model: { id: "model-x" }, isProjectTrusted: () => true },
  );
  assert.equal(out, undefined); // never overrides the system prompt
  assert.match(await readFile(join(cwd, "projects", "active", "provenance.json"), "utf8"), /model-x/);
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

test("tool_execution_start does not trace the audit tools themselves (COMP-2)", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "beril-audit-self-"));
  await mkdir(join(cwd, "projects", "demo"), { recursive: true });
  const h = harness();
  for (const toolName of ["project_provenance", "project_trace"]) {
    await h.handlers.tool_execution_start(
      { type: "tool_execution_start", toolCallId: "tc", toolName, args: { project: "demo" } },
      { cwd },
    );
  }
  // Inspecting a project must never bump its TRACE.jsonl mtime, so no file is written.
  await assert.rejects(() => readFile(join(cwd, "projects", "demo", "TRACE.jsonl"), "utf8"), /ENOENT/);
});

test("there is no input-driven trace write path (only tool_execution_start writes)", () => {
  // /aside is off-the-record by construction: it runs the model with tools:[]
  // (lib/aside.ts), so it never emits tool_execution_start. The audit extension
  // registers no `input` handler — the only trace writer is tool_execution_start.
  const h = harness();
  assert.equal(h.handlers.input, undefined);
  assert.equal(typeof h.handlers.tool_execution_start, "function");
});
