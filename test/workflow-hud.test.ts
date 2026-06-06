import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { workflowHud } from "../lib/ui/workflow-hud.ts";

const theme = { fg: (_c: string, s: string) => s, bold: (s: string) => s } as unknown as Theme;

test("shows project, connection, the step rail, and the next action", () => {
  const lines = workflowHud(theme, {
    project: "demo",
    connection: "BERDL off-cluster ✓ ready",
    ready: true,
    state: "active",
  });
  const text = lines.join("\n");
  assert.match(text, /▣ demo/);
  assert.match(text, /BERDL off-cluster ✓ ready/);
  // active → the analyze step is current.
  assert.match(text, /▸ analyze/);
  assert.match(text, /explore → plan/, "rail lists earlier steps");
  assert.match(text, /Next: finish the notebooks/);
});

test("marks a submitted project on the rail", () => {
  const lines = workflowHud(theme, { project: "demo", state: "complete", submitted: true });
  assert.match(lines.join("\n"), /↑ submitted/);
});

test("before any project, still shows a getting-started next hint", () => {
  const lines = workflowHud(theme, { connection: "BERDL off-cluster ✓ ready", ready: true });
  const text = lines.join("\n");
  assert.match(text, /BERDL off-cluster ✓ ready/);
  assert.match(text, /Next:/);
  assert.doesNotMatch(text, /▸/, "no current-step marker without a project state");
});

test("empty state yields just the getting-started hint", () => {
  const lines = workflowHud(theme, {});
  assert.equal(lines.length, 1);
  assert.match(lines[0], /Next:/);
});
