import assert from "node:assert/strict";
import { test } from "node:test";
import berilAnalysis, { parseAnalyzeArgs } from "../extensions/beril-analysis.ts";

/** Harness with a programmable `pi.exec` (one result, or a per-call function). */
function harness(exec: (cmd: string, args: string[]) => any) {
  const tools: any = {};
  const commands: any = {};
  const pi: any = {
    registerTool: (t: any) => (tools[t.name] = t),
    registerCommand: (n: string, o: any) => (commands[n] = o),
    sendUserMessage: () => {},
    on: () => {},
    exec: async (cmd: string, args: string[]) => exec(cmd, args),
    events: { emit: () => {}, on: () => () => {} },
  };
  berilAnalysis(pi);
  return { tools, commands, pi };
}

const ok = (stdout: string) => ({ stdout, stderr: "", code: 0, killed: false });

test("registers the notebook tools and the /analyze command", () => {
  const h = harness(() => ok("{}"));
  assert.ok(h.tools.notebook_scaffold && h.tools.notebook_list && h.tools.notebook_run);
  assert.ok(h.commands.analyze);
});

test("parseAnalyzeArgs supports first-result and continue modes", () => {
  assert.deepEqual(parseAnalyzeArgs("demo --first-result"), { project: "demo", mode: "first-result" });
  assert.deepEqual(parseAnalyzeArgs("demo --continue"), { project: "demo", mode: "continue" });
  assert.deepEqual(parseAnalyzeArgs("demo"), { project: "demo", mode: "full" });
});

test("/analyze --first-result sends a first-result-only workflow prompt", async () => {
  const sent: string[] = [];
  const h = harness(() => ok("{}"));
  h.pi.sendUserMessage = (m: string) => sent.push(m);
  await h.commands.analyze.handler("demo --first-result", { hasUI: false });
  assert.match(sent[0], /first discriminating notebook/i);
  assert.match(sent[0], /request_checkpoint/);
  assert.doesNotMatch(sent[0], /run the rest/i);
});

test("/analyze --continue sends a continuation workflow prompt", async () => {
  const sent: string[] = [];
  const h = harness(() => ok("{}"));
  h.pi.sendUserMessage = (m: string) => sent.push(m);
  await h.commands.analyze.handler("demo --continue", { hasUI: false });
  assert.match(sent[0], /continue after the first-result checkpoint/i);
  assert.match(sent[0], /remaining notebooks/i);
  assert.match(sent[0], /resume/i);
  assert.match(sent[0], /\/paper-plan demo/);
  assert.match(sent[0], /\/synthesize demo/);
});

test("notebook_scaffold parses the created/skipped manifest", async () => {
  const payload = { project: "demo", created: ["notebooks/01_x.ipynb"], skipped: [] };
  const h = harness(() => ok(JSON.stringify(payload)));
  const res = await h.tools.notebook_scaffold.execute("id", { project: "demo" });
  assert.deepEqual((res.details as any).created, ["notebooks/01_x.ipynb"]);
  assert.match(res.content[0].text, /Scaffolded 1 notebook/);
});

test("notebook_run surfaces a partial failure (exit 1) instead of throwing", async () => {
  const payload = {
    project: "demo",
    executed: [
      { notebook: "notebooks/01_x.ipynb", ok: true, error: null },
      { notebook: "notebooks/02_y.ipynb", ok: false, error: "ValueError: boom" },
    ],
    ok: false,
  };
  const h = harness(() => ({ stdout: JSON.stringify(payload), stderr: "", code: 1, killed: false }));
  const res = await h.tools.notebook_run.execute("id", { project: "demo" }, undefined, undefined);
  assert.equal((res.details as any).ok, false);
  assert.match(res.content[0].text, /1 failed/);
});

test("notebook_run passes --resume when requested", async () => {
  let seen: string[] = [];
  const payload = { project: "demo", executed: [], skipped: [], ok: true };
  const h = harness((_cmd, args) => {
    seen = args;
    return { stdout: JSON.stringify(payload), stderr: "", code: 0, killed: false };
  });
  const res = await h.tools.notebook_run.execute("id", { project: "demo", resume: true }, undefined, undefined);
  assert.deepEqual(seen, ["notebook", "run", "demo", "--resume"]);
  assert.equal((res.details as any).ok, true);
});

test("notebook_run throws on an environment error (exit 2)", async () => {
  const h = harness(() => ({ stdout: "", stderr: "no jupyter in .venv-berdl", code: 2, killed: false }));
  await assert.rejects(
    () => h.tools.notebook_run.execute("id", { project: "demo" }, undefined, undefined),
    /no jupyter/,
  );
});
