import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  CAPABILITIES,
  capabilityCatalogMarkdown,
  matchCapability,
  routeNudge,
  runtimeSurfaceSummary,
} from "../lib/capabilities.ts";

test("capabilityCatalogMarkdown groups skills by scientist intent", () => {
  const md = capabilityCatalogMarkdown({ commandCount: 12, toolCount: 18 });
  assert.match(md, /BERIL Guide/);
  assert.match(md, /map, not a lock/i);
  assert.match(md, /Explore and branch/);
  assert.match(md, /Build the study/);
  assert.match(md, /Check and archive/);
  assert.match(md, /Start or Continue/);
  assert.match(md, /Explore data/);
  assert.match(md, /\/research-plan <project>/);
  assert.match(md, /\/paper-plan <project>/);
  assert.match(md, /\/berdl-refute <project>/);
  assert.doesNotMatch(md, /Tools:/, "default catalog should not expose implementation tools");
  assert.doesNotMatch(md, /Prompt: `berdl-start`/, "default catalog should hide package internals");
  assert.match(md, /\/capabilities --all/);
});

test("capabilityCatalogMarkdown all mode shows the full expert inventory", () => {
  const md = capabilityCatalogMarkdown({ commandCount: 12, toolCount: 18 }, { mode: "all" });
  assert.match(md, /BERIL Capability Inventory/);
  assert.match(md, /Prompt: `berdl-start`/);
  assert.match(md, /Tools: `berdl_discover`/);
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
  assert.equal(matchCapability("Help me shape the paper story")?.command, "/paper-plan <project>");
});

test("runtimeSurfaceSummary counts runtime commands and tools defensively", () => {
  const summary = runtimeSurfaceSummary(
    [{ name: "whereami" }, { name: "skills" }],
    [{ name: "berdl_query" }, { name: "claim_state" }, { name: "science_memory" }],
  );
  assert.deepEqual(summary, { commandCount: 2, toolCount: 3 });
});

test("routeNudge asks for missing alignment before vague routes", () => {
  const cap = matchCapability("Explore this data");
  assert.ok(cap);
  const nudge = routeNudge(cap);
  assert.match(nudge, /Possible BERIL route/);
  assert.match(nudge, /or keep exploring/i);
  assert.match(nudge, /Use it only if it fits/i);
});

test("every advertised capability resource is installed", () => {
  for (const cap of CAPABILITIES) {
    assert.ok(cap.skill || cap.prompt, `${cap.id} should advertise a skill or prompt`);
    if (cap.skill) {
      assert.equal(
        existsSync(join(process.cwd(), "skills", cap.skill, "SKILL.md")),
        true,
        `${cap.id} advertises missing skill ${cap.skill}`,
      );
    }
    if (cap.prompt) {
      assert.equal(
        existsSync(join(process.cwd(), "prompts", `${cap.prompt}.md`)),
        true,
        `${cap.id} advertises missing prompt ${cap.prompt}`,
      );
    }
  }
});
