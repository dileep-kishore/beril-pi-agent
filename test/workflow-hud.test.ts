import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { workflowHud } from "../lib/ui/workflow-hud.ts";

const theme = {
  fg: (_c: string, s: string) => s,
  bold: (s: string) => s,
  getColorMode: () => "truecolor",
} as unknown as Theme;

test("shows the step rail with the current step and the next action", () => {
  const lines = workflowHud(theme, { project: "demo", state: "active" });
  const text = lines.join("\n");
  // active → the analyze step is current.
  assert.match(text, /▸ analyze/);
  assert.match(text, /✔ explore.*✔ plan/, "rail lists earlier steps as done");
  assert.match(text, /Next: finish the notebooks/);
  // connection + project now live in the statusline, not the HUD.
  assert.doesNotMatch(text, /◆/, "no project chip in the HUD");
  assert.doesNotMatch(text, /BERDL/, "no connection label in the HUD");
});

test("marks a submitted project on the rail", () => {
  const lines = workflowHud(theme, { project: "demo", state: "complete", submitted: true });
  assert.match(lines.join("\n"), /↑ submitted/);
});

test("before any project, shows just a getting-started next hint", () => {
  const lines = workflowHud(theme, {});
  assert.equal(lines.length, 1);
  assert.match(lines[0], /Next:/);
  assert.doesNotMatch(lines[0], /▸/, "no current-step marker without a project state");
});
