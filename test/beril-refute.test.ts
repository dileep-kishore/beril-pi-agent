import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import berilRefute from "../extensions/beril-refute.ts";
import { parseRefuteArgs } from "../extensions/beril-refute.ts";
import { summarizeRefutationChecks } from "../lib/refutation.ts";

test("parses project", () => {
  assert.deepEqual(parseRefuteArgs("amr_atlas"), { project: "amr_atlas", model: undefined });
});

test("parses --model", () => {
  assert.deepEqual(parseRefuteArgs("amr_atlas --model claude-opus-4-8"), {
    project: "amr_atlas",
    model: "claude-opus-4-8",
  });
});

test("missing project → undefined", () => {
  assert.equal(parseRefuteArgs("   "), undefined);
});

test("summarizeRefutationChecks extracts actionable checks", () => {
  const checks = summarizeRefutationChecks(`# Refutation

## Surviving disconfirming checks

- H1 lacks a habitat-balance control.
- Literature contradiction: PMID 123 reports the opposite trend.
`);
  assert.deepEqual(checks, [
    "H1 lacks a habitat-balance control.",
    "Literature contradiction: PMID 123 reports the opposite trend.",
  ]);
});

test("/berdl-refute writes a pass and sends a red-team custom card", async () => {
  const root = await mkdtemp(join(tmpdir(), "beril-refute-"));
  try {
    const projectDir = join(root, "projects", "demo");
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, "REPORT.md"), "# Report\n", "utf8");
    const commands: any = {};
    const sent: any[] = [];
    const pi: any = {
      registerCommand: (name: string, opts: any) => (commands[name] = opts),
      sendMessage: (message: any, options: any) => sent.push({ message, options }),
      sendUserMessage: (message: string) => sent.push({ user: message }),
    };
    berilRefute(pi);
    const ctx: any = {
      cwd: root,
      hasUI: false,
      isIdle: () => true,
      __reviewSubagent: async () =>
        "## Surviving disconfirming checks\n\n- H1 lacks a control.\n- PMID 7 contradicts the trend.\n",
    };
    await commands["berdl-refute"].handler("demo", ctx);
    assert.match(await readFile(join(projectDir, "REFUTATION_1.md"), "utf8"), /H1 lacks/);
    const card = sent.find((s) => s.message?.customType === "beril-refutation");
    assert.ok(card);
    assert.deepEqual(card.message.details.surviving, ["H1 lacks a control.", "PMID 7 contradicts the trend."]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
