import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import berilPaper from "../extensions/beril-paper.ts";

function harness() {
  const tools: any = {};
  const commands: any = {};
  const messages: string[] = [];
  const pi: any = {
    registerTool: (t: any) => (tools[t.name] = t),
    registerCommand: (n: string, o: any) => (commands[n] = o),
    sendUserMessage: (m: string) => messages.push(m),
  };
  berilPaper(pi);
  return { tools, commands, messages };
}

const theme = {
  fg: (_c: string, s: string) => s,
  bold: (s: string) => s,
  italic: (s: string) => s,
  strikethrough: (s: string) => s,
  underline: (s: string) => s,
  getColorMode: () => "truecolor",
} as any;

test("registers paper_plan and /paper-plan", () => {
  const { tools, commands } = harness();
  assert.ok(tools.paper_plan);
  assert.ok(commands["paper-plan"]);
});

test("paper_plan reads PAPER_PLAN.md and renders a card", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "beril-paper-"));
  await mkdir(join(cwd, "projects", "demo"), { recursive: true });
  await writeFile(join(cwd, "projects", "demo", "PAPER_PLAN.md"), "# Paper Plan\n\n## Story\n");
  const { tools } = harness();
  const res = await tools.paper_plan.execute("id", { project: "demo" }, undefined, undefined, { cwd });
  assert.match((res.details as any).markdown, /Story/);
  const lines = tools.paper_plan.renderResult(res, { expanded: false, isPartial: false }, theme).render(70);
  for (const line of lines) assert.equal(visibleWidth(line), 70);
  assert.ok(lines[0].includes("Paper plan · demo"));
});

test("/paper-plan prompts for skill-guided PAPER_PLAN.md and checkpoint", async () => {
  const { commands, messages } = harness();
  await commands["paper-plan"].handler("demo", { hasUI: false });
  assert.equal(messages.length, 1);
  assert.match(messages[0], /paper-plan skill/);
  assert.match(messages[0], /PAPER_PLAN\.md/);
  assert.match(messages[0], /request_checkpoint/);
  assert.match(messages[0], /\/synthesize demo/);
});
