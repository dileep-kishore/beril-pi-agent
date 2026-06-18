import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import berilIdeas from "../extensions/beril-ideas.ts";

function harness() {
  const tools: any = {};
  const commands: any = {};
  const sent: string[] = [];
  const pi: any = {
    registerTool: (t: any) => (tools[t.name] = t),
    registerCommand: (name: string, opts: any) => (commands[name] = opts),
    sendUserMessage: (m: string) => sent.push(m),
  };
  berilIdeas(pi);
  return { tools, commands, sent };
}

test("science_memory tool returns approved memory records", async () => {
  const root = await mkdtemp(join(tmpdir(), "beril-ideas-"));
  try {
    const projectDir = join(root, "projects", "done");
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, "beril.yaml"), "project_id: done\nstatus: complete\n", "utf8");
    await writeFile(join(projectDir, "REPORT.md"), "## Discoveries\n\n- A reviewed result.\n", "utf8");
    const h = harness();
    const res = await h.tools.science_memory.execute("id", {}, undefined, undefined, { cwd: root });
    assert.equal((res.details as any).records.length, 1);
    assert.match(res.content[0].text, /1 approved memory/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("/idea-tournament sends a structured co-scientist prompt", async () => {
  const root = await mkdtemp(join(tmpdir(), "beril-ideas-command-"));
  try {
    const projectDir = join(root, "projects", "done");
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, "beril.yaml"), "project_id: done\nstatus: complete\n", "utf8");
    await writeFile(join(projectDir, "REPORT.md"), "## Discoveries\n\n- A reviewed result.\n", "utf8");
    const h = harness();
    await h.commands["idea-tournament"].handler("AMR ecology", { cwd: root, hasUI: false });
    assert.match(h.sent[0], /AMR ecology/);
    assert.match(h.sent[0], /data scout/i);
    assert.match(h.sent[0], /refuter/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
