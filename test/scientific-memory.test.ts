import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildIdeaTournamentPrompt,
  extractApprovedMemories,
  scanApprovedMemoryIndex,
} from "../lib/scientific-memory.ts";

const REPORT = `# Report

## Discoveries

- Soil-associated taxa show broader oxidative-stress repertoires.

## Performance Notes

- Use partition filters before joining genome and environment tables.
`;

test("extractApprovedMemories pulls discoveries and performance notes", () => {
  const records = extractApprovedMemories("demo", REPORT);
  assert.deepEqual(
    records.map((r) => [r.kind, r.text]),
    [
      ["discovery", "Soil-associated taxa show broader oxidative-stress repertoires."],
      ["performance", "Use partition filters before joining genome and environment tables."],
    ],
  );
});

test("scanApprovedMemoryIndex only indexes complete/submitted projects", async () => {
  const root = await mkdtemp(join(tmpdir(), "beril-memory-"));
  try {
    const complete = join(root, "projects", "done");
    const draft = join(root, "projects", "draft");
    await mkdir(complete, { recursive: true });
    await mkdir(draft, { recursive: true });
    await writeFile(join(complete, "beril.yaml"), "project_id: done\nstatus: complete\n", "utf8");
    await writeFile(join(complete, "REPORT.md"), REPORT, "utf8");
    await writeFile(join(draft, "beril.yaml"), "project_id: draft\nstatus: analysis\n", "utf8");
    await writeFile(join(draft, "REPORT.md"), REPORT, "utf8");
    const records = await scanApprovedMemoryIndex(root);
    assert.equal(records.length, 2);
    assert.ok(records.every((r) => r.project === "done"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildIdeaTournamentPrompt uses memory records and co-scientist roles", () => {
  const prompt = buildIdeaTournamentPrompt("AMR ecology", [
    { project: "done", kind: "discovery", text: "Prior finding.", source: "projects/done/REPORT.md" },
  ]);
  assert.match(prompt, /data scout/i);
  assert.match(prompt, /methods skeptic/i);
  assert.match(prompt, /refuter/i);
  assert.match(prompt, /Prior finding/);
  assert.match(prompt, /AMR ecology/);
});
