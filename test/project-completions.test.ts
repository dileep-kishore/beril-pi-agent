import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { projectCompletions } from "../lib/project-completions.ts";

async function withCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const old = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(old);
  }
}

test("projectCompletions lists project directories from process cwd", async () => {
  const dir = await mkdtemp(join(tmpdir(), "beril-project-completions-"));
  try {
    await mkdir(join(dir, "projects", "alpha"), { recursive: true });
    await mkdir(join(dir, "projects", "beta"), { recursive: true });
    await withCwd(dir, async () => {
      const items = projectCompletions("a") ?? [];
      assert.deepEqual(
        items.map((i) => i.value),
        ["alpha"],
      );
      assert.equal(items[0].label, "alpha");
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("projectCompletions returns null when there is no projects directory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "beril-project-completions-empty-"));
  try {
    await withCwd(dir, async () => {
      assert.equal(projectCompletions(""), null);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
