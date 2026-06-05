import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import berilLit from "../extensions/beril-literature.ts";

function harness(execImpl: any) {
  const tools: any = {};
  const commands: any = {};
  const pi: any = {
    registerTool: (t: any) => (tools[t.name] = t),
    registerCommand: (n: string, o: any) => (commands[n] = o),
    sendUserMessage: () => {},
    exec: execImpl,
  };
  berilLit(pi);
  return { tools, commands };
}
const ctx: any = { hasUI: false, mode: "json" };

test("registers lit_search + lit_fetch tools + /literature-review", () => {
  const { tools, commands } = harness(async () => ({ stdout: "[]", stderr: "", code: 0, killed: false }));
  assert.ok(tools.lit_search && tools.lit_fetch && commands["literature-review"]);
});

test("lit_search returns records", async () => {
  const { tools } = harness(async () => ({
    stdout: JSON.stringify([{ pmid: "1", title: "A" }]),
    stderr: "",
    code: 0,
    killed: false,
  }));
  const r = await tools.lit_search.execute("id", { query: "x", max: 5 }, undefined, undefined, ctx);
  assert.equal((r.details as any).records[0].pmid, "1");
});

test("/literature-review fans out, dedupes, and writes references.md", async () => {
  const dir = await mkdtemp(join(tmpdir(), "beril-lit-"));
  try {
    const calls: string[][] = [];
    const { commands } = harness(async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      if (cmd === "pi") {
        // sub-agent expansion → JSONL with an assistant message containing a JSON array of queries
        const events = [
          { type: "session" },
          { type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: '["q1","q2"]' }] }] },
        ];
        return { stdout: events.map((e) => JSON.stringify(e)).join("\n"), stderr: "", code: 0, killed: false };
      }
      // beril lit search → records; q1 and q2 share pmid "1" to exercise dedupe
      const q = args[args.indexOf("--query") + 1];
      const recs =
        q === "q1"
          ? [
              { pmid: "1", title: "Shared" },
              { pmid: "2", title: "Only1" },
            ]
          : [
              { pmid: "1", title: "Shared" },
              { pmid: "3", title: "Only2" },
            ];
      return { stdout: JSON.stringify(recs), stderr: "", code: 0, killed: false };
    });
    const cctx: any = { hasUI: false, mode: "json", cwd: dir };
    await commands["literature-review"].handler("microbial AMR", cctx);

    const refs = await readFile(join(dir, "references.md"), "utf8");
    assert.match(refs, /References — microbial AMR/);
    assert.match(refs, /PMID:1/);
    assert.match(refs, /PMID:2/);
    assert.match(refs, /PMID:3/);
    // 3 unique after dedupe of the shared pmid:1
    assert.match(refs, /3 unique reference/);
    // expansion ran first, then a search per query
    assert.equal(calls[0][0], "pi");
    assert.ok(calls.filter((c) => c[0] === "beril" && c[1] === "lit").length === 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("/literature-review falls back to the bare topic when expansion fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "beril-lit-"));
  try {
    const queries: string[] = [];
    const { commands } = harness(async (cmd: string, args: string[]) => {
      if (cmd === "pi") return { stdout: "garbage not jsonl", stderr: "", code: 0, killed: false };
      queries.push(args[args.indexOf("--query") + 1]);
      return { stdout: JSON.stringify([{ pmid: "9", title: "T" }]), stderr: "", code: 0, killed: false };
    });
    const cctx: any = { hasUI: false, mode: "json", cwd: dir };
    await commands["literature-review"].handler("bare topic", cctx);
    assert.deepEqual(queries, ["bare topic"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
