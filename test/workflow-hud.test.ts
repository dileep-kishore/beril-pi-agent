import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { glyph } from "../lib/ui/glyphs.ts";
import { applyToolStart, substepRail, substepsForPhase } from "../lib/ui/substeps.ts";
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
  assert.match(text, /✓ explore.*✓ plan/, "rail lists earlier steps as done");
  assert.match(text, /Next: finish the notebooks/);
  // connection + project now live in the statusline, not the HUD.
  assert.doesNotMatch(text, /◆/, "no project chip in the HUD");
  assert.doesNotMatch(text, /BERDL/, "no connection label in the HUD");
  assert.match(text, /Actions:/);
  assert.match(text, /\/analyze demo --first-result/);
});

test("marks a submitted project on the rail", () => {
  const lines = workflowHud(theme, { project: "demo", state: "complete", submitted: true });
  assert.match(lines.join("\n"), /↑ submitted/);
});

test("before any project, shows just a getting-started next hint", () => {
  const lines = workflowHud(theme, {});
  assert.equal(lines.length, 2);
  assert.match(lines[0], /Next:/);
  assert.match(lines[0], /frame the question.*discover/i);
  assert.match(lines[1], /Actions:/);
  assert.doesNotMatch(lines[0], /▸/, "no current-step marker without a project state");
});

test("exploration next hint frames the question before querying or planning", () => {
  const text = workflowHud(theme, { project: "demo", state: "exploration" }).join("\n");
  assert.match(text, /Next:.*frame the question.*query.*plan/i);
});

test("renders an indented sub-step line between the rail and the next hint", () => {
  const substeps = applyToolStart(substepsForPhase("analyze"), "notebook_run", {});
  const lines = workflowHud(theme, { project: "demo", state: "active", substeps });
  // rail, sub-step line, next hint, actions — four lines.
  assert.equal(lines.length, 4);
  // The sub-step line is the rendered rail, two-space indented, and marks `run` active.
  assert.equal(lines[1], `  ${substepRail(theme, substeps)}`, "the sub-step line is two-space indented");
  assert.ok(lines[1].includes(`${glyph("here")} run`), "run is active on the sub-step line");
  assert.match(lines[2], /Next:/, "the next hint still comes before actions");
  assert.match(lines[3], /Actions:/);
});

test("renders no sub-step line when substeps is undefined (regression: 3-test contract)", () => {
  // Existing-contract states with substeps undefined must keep their exact line counts.
  assert.equal(workflowHud(theme, {}).length, 2, "no project → next + actions");
  assert.equal(workflowHud(theme, { project: "demo", state: "active" }).length, 3, "project → rail + next + actions");
  // An empty (no-manifest) overlay also adds no line.
  const empty = substepsForPhase("review");
  assert.equal(
    workflowHud(theme, { project: "demo", state: "reviewed", substeps: empty }).length,
    3,
    "empty overlay adds no line beyond actions",
  );
});
