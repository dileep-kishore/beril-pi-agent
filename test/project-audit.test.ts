import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  appendProjectTrace,
  buildProvenanceSnapshot,
  readProjectTrace,
  redactForTrace,
  writeProvenanceSnapshot,
} from "../lib/project-audit.ts";

test("redactForTrace removes obvious secrets and truncates long strings", () => {
  const redacted = redactForTrace({
    token: "abc",
    nested: { KBASE_AUTH_TOKEN: "def", query: "x".repeat(500) },
  }) as any;
  assert.equal(redacted.token, "[redacted]");
  assert.equal(redacted.nested.KBASE_AUTH_TOKEN, "[redacted]");
  assert.equal(redacted.nested.query.length < 260, true);
});

test("appendProjectTrace writes JSONL rows under the project", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "beril-audit-"));
  await mkdir(join(cwd, "projects", "demo"), { recursive: true });
  await appendProjectTrace(cwd, "demo", {
    event: "tool_execution_start",
    tool: "berdl_query",
    input: { token: "secret", query: "SELECT 1" },
  });
  const rows = await readProjectTrace(cwd, "demo");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].project, "demo");
  assert.equal(rows[0].event, "tool_execution_start");
  assert.equal((rows[0] as any).input.token, "[redacted]");
  assert.equal((rows[0] as any).input.query, "SELECT 1");
});

test("writeProvenanceSnapshot records package, Pi, and model context", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "beril-provenance-"));
  await mkdir(join(cwd, "projects", "demo"), { recursive: true });
  await writeFileLikeJson(join(cwd, "package.json"), {
    name: "beril-pi-agent",
    version: "0.1.0",
    devDependencies: { "@earendil-works/pi-coding-agent": "0.79.1" },
  });
  const snap = await buildProvenanceSnapshot(cwd, "demo", { model: { id: "gpt-test" }, mode: "json" });
  await writeProvenanceSnapshot(cwd, "demo", snap);
  const saved = JSON.parse(await readFile(join(cwd, "projects", "demo", "provenance.json"), "utf8"));
  assert.equal(saved.project, "demo");
  assert.equal(saved.runtime.beril_package_version, "0.1.0");
  assert.equal(saved.runtime.pi_coding_agent_version, "0.79.1");
  assert.equal(saved.runtime.model_id, "gpt-test");
});

async function writeFileLikeJson(path: string, value: unknown) {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path, JSON.stringify(value, null, 2));
}
