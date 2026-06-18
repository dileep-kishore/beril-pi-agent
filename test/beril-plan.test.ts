import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import berilPlan from "../extensions/beril-plan.ts";

function harness() {
  const tools: any = {};
  const commands: any = {};
  const messages: string[] = [];
  const pi: any = {
    registerTool: (t: any) => (tools[t.name] = t),
    registerCommand: (n: string, o: any) => (commands[n] = o),
    sendUserMessage: (m: string) => messages.push(m),
    on: () => {},
    events: { emit: () => {}, on: () => () => {} },
  };
  berilPlan(pi);
  return { tools, commands, messages };
}

const theme = {
  fg: (_c: string, s: string) => s,
  bold: (s: string) => s,
  italic: (s: string) => s,
  strikethrough: (s: string) => s,
  underline: (s: string) => s,
  getColorMode: () => "truecolor", // the plan card's violet accentStyle calls getColorMode
} as any;

test("registers the research_plan tool and /research-plan command", () => {
  const { tools, commands } = harness();
  assert.ok(tools.research_plan);
  assert.ok(tools.planning_preflight);
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

test("planning_preflight writes an inspectable artifact and renders a card", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "beril-preflight-"));
  await mkdir(join(cwd, "projects", "demo"), { recursive: true });
  const { tools } = harness();
  const res = await tools.planning_preflight.execute(
    "id",
    {
      project: "demo",
      question: "Does X correlate with Y?",
      feasibility: "answerable",
      tables: ["db.t"],
      assumptions: ["Y is measured consistently"],
    },
    undefined,
    undefined,
    { cwd },
  );
  assert.equal((res.details as any).project, "demo");
  const saved = JSON.parse(await readFile(join(cwd, "projects", "demo", "PLANNING_PREFLIGHT.json"), "utf8"));
  assert.equal(saved.question, "Does X correlate with Y?");
  assert.deepEqual(saved.tables, ["db.t"]);
  const lines = tools.planning_preflight.renderResult(res, { expanded: false, isPartial: false }, theme).render(70);
  assert.ok(lines[0].includes("Planning preflight · demo"));
});

test("/research-plan requires planning_preflight before RESEARCH_PLAN.md", async () => {
  const { commands, messages } = harness();
  await commands["research-plan"].handler("demo", { hasUI: false });
  assert.equal(messages.length, 1);
  assert.match(messages[0], /planning_preflight/);
  assert.match(messages[0], /before drafting RESEARCH_PLAN\.md/);
  assert.match(messages[0], /request_checkpoint/);
});
