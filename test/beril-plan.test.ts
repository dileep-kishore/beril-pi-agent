import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import berilPlan from "../extensions/beril-plan.ts";

function harness() {
  const tools: any = {};
  const commands: any = {};
  const pi: any = {
    registerTool: (t: any) => (tools[t.name] = t),
    registerCommand: (n: string, o: any) => (commands[n] = o),
    on: () => {},
    events: { emit: () => {}, on: () => () => {} },
  };
  berilPlan(pi);
  return { tools, commands };
}

const theme = {
  fg: (_c: string, s: string) => s,
  bold: (s: string) => s,
  italic: (s: string) => s,
  strikethrough: (s: string) => s,
  underline: (s: string) => s,
} as any;

test("registers the research_plan tool and /research-plan command", () => {
  const { tools, commands } = harness();
  assert.ok(tools.research_plan);
  assert.ok(commands["research-plan"]);
});

test("research_plan reads RESEARCH_PLAN.md and renders a framed card", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "beril-plan-"));
  await mkdir(join(cwd, "projects", "demo"), { recursive: true });
  await writeFile(
    join(cwd, "projects", "demo", "RESEARCH_PLAN.md"),
    "# Research Plan: Demo\n\n## Research Question\nIs X?\n",
  );
  const { tools } = harness();
  const res = await tools.research_plan.execute("id", { project: "demo" }, undefined, undefined, { cwd });
  assert.match((res.details as any).markdown, /Research Question/);
  const lines = tools.research_plan.renderResult(res, { expanded: false, isPartial: false }, theme).render(70);
  for (const line of lines) assert.equal(visibleWidth(line), 70);
  assert.ok(lines[0].includes("Research plan · demo"));
});

test("research_plan throws a helpful error when no plan exists", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "beril-plan-"));
  const { tools } = harness();
  await assert.rejects(
    () => tools.research_plan.execute("id", { project: "ghost" }, undefined, undefined, { cwd }),
    /No RESEARCH_PLAN\.md/,
  );
});
