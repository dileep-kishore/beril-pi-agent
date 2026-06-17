import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  CAPABILITIES,
  capabilityCatalogMarkdown,
  matchCapability,
  runtimeSurfaceSummary,
} from "../lib/capabilities.ts";

test("capabilityCatalogMarkdown groups skills by scientist intent", () => {
  const md = capabilityCatalogMarkdown({ commandCount: 12, toolCount: 18 });
  assert.match(md, /Explore data/);
  assert.match(md, /\/research-plan <project>/);
  assert.match(md, /\/berdl-refute <project>/);
  assert.match(md, /12 commands/);
  assert.match(md, /18 tools/);
});

test("matchCapability maps plain-language science tasks to the right route", () => {
  assert.equal(
    matchCapability("Can you find papers that contradict this hypothesis?")?.command,
    "/literature-review <topic>",
  );
  assert.equal(matchCapability("Stress test and refute these findings")?.command, "/berdl-refute <project>");
  assert.equal(matchCapability("I want to archive this reviewed project")?.command, "/submit <project>");
});

test("runtimeSurfaceSummary counts runtime commands and tools defensively", () => {
  const summary = runtimeSurfaceSummary(
    [{ name: "whereami" }, { name: "skills" }],
    [{ name: "berdl_query" }, { name: "claim_state" }, { name: "science_memory" }],
  );
  assert.deepEqual(summary, { commandCount: 2, toolCount: 3 });
});

test("every advertised capability skill is installed", () => {
  for (const cap of CAPABILITIES) {
    assert.equal(
      existsSync(join(process.cwd(), "skills", cap.skill, "SKILL.md")),
      true,
      `${cap.id} advertises missing skill ${cap.skill}`,
    );
  }
});
