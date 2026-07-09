import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { newFigures, openCommand } from "../lib/figures.ts";

test("newFigures returns only figures newer than the cutoff, sorted, absolute", () => {
  const project = mkdtempSync(join(tmpdir(), "beril-figs-"));
  const figs = join(project, "figures");
  mkdirSync(figs);
  const older = join(figs, "a_old.png");
  const newer = join(figs, "b_new.png");
  writeFileSync(older, "x");
  writeFileSync(newer, "y");
  // Anchor mtimes far apart (seconds since epoch) so the cutoff is unambiguous.
  utimesSync(older, new Date(1000_000), new Date(1000_000));
  utimesSync(newer, new Date(2000_000), new Date(2000_000));

  const found = newFigures(project, 1_500_000);
  assert.deepEqual(found, [newer], "only the file newer than the cutoff");
});

test("newFigures tolerates a missing figures/ dir", () => {
  const project = mkdtempSync(join(tmpdir(), "beril-nofigs-"));
  assert.deepEqual(newFigures(project, 0), []);
});

test("openCommand names a per-platform read-only viewer launcher", () => {
  const cmd = openCommand("/tmp/plot.png");
  assert.equal(cmd.length, 2);
  assert.ok(["open", "xdg-open"].includes(cmd[0]));
  assert.equal(cmd[1], "/tmp/plot.png");
});
