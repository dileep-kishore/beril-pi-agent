import assert from "node:assert/strict";
import { test } from "node:test";
import berilAnalysis from "../extensions/beril-analysis.ts";

/** Harness with a programmable `pi.exec` (one result, or a per-call function). */
function harness(exec: (cmd: string, args: string[]) => any) {
  const tools: any = {};
  const commands: any = {};
  const pi: any = {
    registerTool: (t: any) => (tools[t.name] = t),
    registerCommand: (n: string, o: any) => (commands[n] = o),
    on: () => {},
    exec: async (cmd: string, args: string[]) => exec(cmd, args),
    events: { emit: () => {}, on: () => () => {} },
  };
  berilAnalysis(pi);
  return { tools, commands };
}

const ok = (stdout: string) => ({ stdout, stderr: "", code: 0, killed: false });

test("registers the notebook tools and the /analyze command", () => {
  const h = harness(() => ok("{}"));
  assert.ok(h.tools.notebook_scaffold && h.tools.notebook_list && h.tools.notebook_run);
  assert.ok(h.commands.analyze);
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

test("notebook_run throws on an environment error (exit 2)", async () => {
  const h = harness(() => ({ stdout: "", stderr: "no jupyter in .venv-berdl", code: 2, killed: false }));
  await assert.rejects(
    () => h.tools.notebook_run.execute("id", { project: "demo" }, undefined, undefined),
    /no jupyter/,
  );
});
