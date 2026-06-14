import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { glyph } from "../lib/ui/glyphs.ts";
import {
  type SubstepState,
  applyToolEnd,
  applyToolStart,
  detailFromArgs,
  substepRail,
  substepsForPhase,
} from "../lib/ui/substeps.ts";

const theme = {
  fg: (_c: string, s: string) => s,
  bold: (s: string) => s,
  getColorMode: () => "truecolor",
} as unknown as Theme;

test("substepsForPhase builds the analyze manifest, all pending", () => {
  const s = substepsForPhase("analyze");
  assert.equal(s.phase, "analyze");
  assert.deepEqual(
    s.steps.map((x) => x.key),
    ["scaffold", "run", "hash", "promote"],
  );
  assert.ok(
    s.steps.every((x) => x.status === "pending"),
    "every step starts pending",
  );
});

test("substepsForPhase returns an empty overlay for phases with no manifest", () => {
  for (const phase of ["review", "submit", "complete", "explore-bogus"]) {
    const s = substepsForPhase(phase);
    assert.equal(s.phase, phase);
    assert.equal(s.steps.length, 0);
  }
});

test("substepsForPhase accepts undefined (the currentStep miss case)", () => {
  const s = substepsForPhase(undefined);
  assert.equal(s.phase, "");
  assert.equal(s.steps.length, 0);
});

test("applyToolStart marks earlier steps done (monotonic forward) and the owner active", () => {
  const start = substepsForPhase("analyze");
  const afterScaffold = applyToolStart(start, "notebook_scaffold", {});
  assert.equal(afterScaffold.steps[0].status, "active");
  // A later tool advances the rail and back-fills the skipped step as done.
  const afterRun = applyToolStart(afterScaffold, "notebook_run", {});
  assert.equal(afterRun.steps[0].status, "done", "scaffold is done once run starts");
  assert.equal(afterRun.steps[1].status, "active", "run is active");
  assert.equal(afterRun.steps[2].status, "pending", "hash is still pending");
});

test("applyToolStart returns the SAME reference when nothing changes (no-op short-circuit)", () => {
  const start = substepsForPhase("analyze");
  // A tool that does not belong to this phase is a no-op.
  assert.equal(applyToolStart(start, "lit_search", {}), start, "wrong-phase tool is a no-op");
  // An unknown tool is a no-op.
  assert.equal(applyToolStart(start, "no_such_tool", {}), start, "unknown tool is a no-op");
  // Re-applying the same already-active step with the same detail is a no-op.
  const active = applyToolStart(start, "notebook_run", { notebook: "01_load.ipynb" });
  assert.equal(applyToolStart(active, "notebook_run", { notebook: "01_load.ipynb" }), active, "re-active is a no-op");
});

test("applyToolEnd marks the owning step done, or failed on error", () => {
  const active = applyToolStart(substepsForPhase("analyze"), "notebook_run", {});
  const done = applyToolEnd(active, "notebook_run", false);
  assert.equal(done.steps[1].status, "done");
  const failed = applyToolEnd(active, "notebook_run", true);
  assert.equal(failed.steps[1].status, "failed");
});

test("applyToolEnd returns the SAME reference when nothing changes", () => {
  const start = substepsForPhase("analyze");
  assert.equal(applyToolEnd(start, "lit_search", false), start, "wrong-phase tool is a no-op");
  assert.equal(applyToolEnd(start, "no_such_tool", false), start, "unknown tool is a no-op");
  const done = applyToolEnd(applyToolStart(start, "notebook_run", {}), "notebook_run", false);
  assert.equal(applyToolEnd(done, "notebook_run", false), done, "already-done is a no-op");
});

test("detailFromArgs extracts a tool-derived detail and never throws", () => {
  assert.equal(detailFromArgs("notebook_run", { notebook: "notebooks/01_load.ipynb" }), "01_load");
  assert.equal(detailFromArgs("berdl_discover", { database: "kbase_genomes" }), "kbase_genomes");
  assert.equal(detailFromArgs("lit_search", { query: "crispr" }), "crispr");
  // Long queries are truncated with an ellipsis.
  const long = "a".repeat(60);
  const out = detailFromArgs("lit_search", { query: long });
  assert.ok(out && out.length <= 41 && out.endsWith("…"), "long query is truncated");
  // Guards: null, non-object, wrong-typed field, unknown tool → undefined, never a throw.
  assert.equal(detailFromArgs("notebook_run", null), undefined);
  assert.equal(detailFromArgs("notebook_run", 42), undefined);
  assert.equal(detailFromArgs("notebook_run", { notebook: 42 }), undefined);
  assert.equal(detailFromArgs("berdl_discover", {}), undefined);
  assert.equal(detailFromArgs("research_plan", { foo: "bar" }), undefined);
});

test("substepRail renders glyph + label per status, undefined when empty", () => {
  assert.equal(substepRail(theme, substepsForPhase("review")), undefined, "empty overlay → no line");

  let s = substepsForPhase("analyze");
  s = applyToolStart(s, "notebook_run", { notebook: "notebooks/02_fit.ipynb" });
  const rail = substepRail(theme, s);
  assert.ok(rail, "non-empty overlay renders a line");
  // scaffold back-filled as done; run active with its detail; hash/promote pending.
  assert.ok(rail?.includes(`${glyph("ok")} scaffold`), "scaffold done (✓)");
  assert.ok(rail?.includes(`${glyph("here")} run 02_fit`), "run active (▸) with the notebook detail");
  assert.ok(rail?.includes(`${glyph("pending")} hash`), "hash pending (○)");
});

test("substepRail shows the failed glyph for a failed step", () => {
  let s: SubstepState = applyToolStart(substepsForPhase("analyze"), "notebook_run", {});
  s = applyToolEnd(s, "notebook_run", true);
  const rail = substepRail(theme, s);
  assert.ok(rail?.includes(`${glyph("bad")} run`), "failed run (✗)");
});

test("substepRail downgrades glyphs under NO_COLOR", () => {
  const prev = process.env.BERIL_GLYPHS;
  process.env.BERIL_GLYPHS = "ascii";
  try {
    let s = substepsForPhase("analyze");
    s = applyToolStart(s, "notebook_scaffold", {});
    const rail = substepRail(theme, s);
    assert.ok(rail?.includes(`${glyph("here")} scaffold`), "ascii tier uses the ASCII here mark");
  } finally {
    if (prev === undefined) process.env.BERIL_GLYPHS = undefined;
    else process.env.BERIL_GLYPHS = prev;
  }
});
