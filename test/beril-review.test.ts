import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import berilReview from "../extensions/beril-review.ts";

/** Capture registerCommand and stub pi.exec with a per-call args router. */
function harness(execImpl: (cmd: string, args: string[]) => any) {
  const commands: any = {};
  const sent: string[] = [];
  const emitted: [string, any][] = [];
  const pi: any = {
    registerCommand: (n: string, o: any) => (commands[n] = o),
    sendUserMessage: (m: string) => sent.push(m),
    exec: async (cmd: string, args: string[]) => execImpl(cmd, args),
    events: { emit: (channel: string, data: any) => emitted.push([channel, data]) },
  };
  berilReview(pi);
  return { commands, sent, emitted };
}

/** A fake review subagent: records the request, returns canned markdown. */
function fakeSubagent(text: string) {
  const reqs: any[] = [];
  const fn = async (_ctx: unknown, req: unknown) => {
    reqs.push(req);
    return text;
  };
  return { fn, reqs };
}

/** Build a temp project dir under <root>/projects/<id> with optional files. */
async function makeProject(id: string, files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "beril-rev-"));
  const dir = join(root, "projects", id);
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content, "utf8");
  }
  return { root, dir };
}

function cmdCtx(root: string, subagent: (ctx: unknown, req: unknown) => Promise<string>) {
  const notes: string[] = [];
  const ctx: any = {
    hasUI: true,
    mode: "tui",
    cwd: root,
    isIdle: () => true,
    model: { id: "m" },
    modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k" }) },
    signal: undefined,
    ui: { notify: (m: string) => notes.push(m), setStatus: () => {} },
    __reviewSubagent: subagent,
  };
  return { ctx, notes };
}

test("registers the review command family", () => {
  const { commands } = harness(async () => ({ stdout: "{}", stderr: "", code: 0, killed: false }));
  assert.ok(commands["berdl-review"], "command berdl-review");
  assert.ok(commands["berdl-refute"], "command berdl-refute");
});

test("project review writes REVIEW_1.md with a single footer and marks reviewed", async () => {
  const { root, dir } = await makeProject("demo", { "REPORT.md": "report body\n" });
  try {
    const calls: string[][] = [];
    const { commands } = harness(async (_c, args) => {
      calls.push(args);
      if (args[0] === "lifecycle" && args[1] === "status") {
        return { stdout: JSON.stringify({ status: "analysis" }), stderr: "", code: 0, killed: false };
      }
      return { stdout: JSON.stringify({ status: "reviewed" }), stderr: "", code: 0, killed: false };
    });
    const { fn, reqs } = fakeSubagent("---\nreviewer: x\n---\n\n# Review\nLGTM\n");
    const { ctx } = cmdCtx(root, fn);
    await commands["berdl-review"].handler("demo", ctx);

    const review = await readFile(join(dir, "REVIEW_1.md"), "utf8");
    assert.match(review, /# Review/);
    // Exactly one footer, as the final non-empty line.
    assert.equal((review.match(/report_hash/g) || []).length, 1);
    assert.match(review, /<!-- report_hash: sha256:[0-9a-f]{64} -->\n$/);

    // The reviewer was asked about the project review (got the project rubric).
    assert.equal(reqs.length, 1);
    assert.match(reqs[0].task, /demo|review/i);

    // Lifecycle advanced to reviewed.
    assert.ok(
      calls.find((a) => a[0] === "lifecycle" && a[1] === "set" && a[2] === "demo" && a[3] === "reviewed"),
      "lifecycle set demo reviewed",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("re-reviewing an already-reviewed project writes a review without an illegal transition", async () => {
  const { root, dir } = await makeProject("demo", { "REPORT.md": "report body\n" });
  try {
    const calls: string[][] = [];
    const { commands } = harness(async (_c, args) => {
      calls.push(args);
      if (args[0] === "lifecycle" && args[1] === "status") {
        return { stdout: JSON.stringify({ status: "reviewed" }), stderr: "", code: 0, killed: false };
      }
      // `lifecycle set reviewed` from `reviewed` is illegal (exit 2) — fail loudly if attempted.
      return { stdout: "", stderr: "illegal transition", code: 2, killed: false };
    });
    const { fn } = fakeSubagent("---\nreviewer: x\n---\n\n# Re-review\nstill good\n");
    const { ctx, notes } = cmdCtx(root, fn);
    await commands["berdl-review"].handler("demo", ctx);

    const review = await readFile(join(dir, "REVIEW_1.md"), "utf8");
    assert.match(review, /Re-review/);
    assert.ok(!calls.find((a) => a[0] === "lifecycle" && a[1] === "set"), "no set reviewed from reviewed");
    assert.match(notes.join(" "), /Review written/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("plan review writes PLAN_REVIEW_1.md with NO footer and NO lifecycle call", async () => {
  const { root, dir } = await makeProject("demo", { "RESEARCH_PLAN.md": "plan body\n" });
  try {
    const calls: string[][] = [];
    const { commands } = harness(async (_c, args) => {
      calls.push(args);
      return { stdout: JSON.stringify({ status: "active" }), stderr: "", code: 0, killed: false };
    });
    const { fn } = fakeSubagent("---\nreviewer: x\n---\n\n**Overall**: fine\n");
    const { ctx } = cmdCtx(root, fn);
    await commands["berdl-review"].handler("demo --plan", ctx);

    const plan = await readFile(join(dir, "PLAN_REVIEW_1.md"), "utf8");
    assert.match(plan, /Overall/);
    assert.equal(plan.includes("report_hash"), false, "plan review has no footer");
    assert.ok(!calls.find((a) => a[0] === "lifecycle" && a[1] === "set"), "plan review must not transition lifecycle");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("project review with missing REPORT.md notifies and writes nothing", async () => {
  const { root, dir } = await makeProject("demo", {});
  try {
    let subagentCalled = false;
    const { commands } = harness(async (_c, args) => {
      if (args[0] === "lifecycle" && args[1] === "status") {
        return { stdout: JSON.stringify({ status: "analysis" }), stderr: "", code: 0, killed: false };
      }
      return { stdout: "{}", stderr: "", code: 0, killed: false };
    });
    const { ctx, notes } = cmdCtx(root, async () => {
      subagentCalled = true;
      return "x";
    });
    await commands["berdl-review"].handler("demo", ctx);

    assert.equal(subagentCalled, false, "must not run the reviewer without REPORT.md");
    assert.match(notes.join(" "), /synthesize/i);
    const entries = await readdir(dir);
    assert.ok(!entries.some((e) => e.startsWith("REVIEW")), "no review file written");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
