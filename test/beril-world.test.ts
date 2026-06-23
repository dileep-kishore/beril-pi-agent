import assert from "node:assert/strict";
import { test } from "node:test";
import berilWorld from "../extensions/beril-world.ts";

// A minimal theme stub: the world-model card uses linesCard, which needs `fg`,
// `bold`, `getColorMode` (palette) — enough to render without a real Theme.
const theme: any = {
  fg: (_c: string, s: string) => s,
  bold: (s: string) => s,
  getColorMode: () => "truecolor",
};

/**
 * `exec` is the seam: berilExec calls pi.exec("beril", args, ...). The harness
 * routes by the lifecycle sub-action so a single fake can serve both a `--get`
 * (returns the stored snapshot) and a `--set` (captures what was written).
 */
function harness(opts?: { get?: unknown; capture?: (json: string) => void; trusted?: boolean }) {
  const tools: any = {};
  const commands: any = {};
  const messages: string[] = [];
  const calls: string[][] = [];
  const exec = async (_cmd: string, args: string[]) => {
    calls.push(args);
    // args: ["lifecycle","session-state",<project>,"--get"|"--set",<json?>]
    if (args.includes("--set")) {
      const json = args[args.length - 1];
      opts?.capture?.(json);
      return { code: 0, stdout: JSON.stringify({ research_state: JSON.parse(json) }), stderr: "" };
    }
    if (args.includes("--get")) {
      return { code: 0, stdout: JSON.stringify(opts?.get ?? {}), stderr: "" };
    }
    return { code: 0, stdout: "{}", stderr: "" };
  };
  const pi: any = {
    registerTool: (t: any) => (tools[t.name] = t),
    registerCommand: (n: string, o: any) => (commands[n] = o),
    sendUserMessage: (m: string) => messages.push(m),
    exec,
  };
  berilWorld(pi);
  const ctx = { cwd: "/tmp/x", mode: "json", isProjectTrusted: () => opts?.trusted ?? true, hasUI: false };
  return { tools, commands, messages, calls, ctx };
}

test("registers the world_model tool and /world-model command", () => {
  const h = harness();
  assert.ok(h.tools.world_model);
  assert.ok(h.commands["world-model"]);
});

test("read renders a card from the stored snapshot", async () => {
  const h = harness({
    get: {
      project: "aquila",
      question: "Does iron limitation drive the bloom?",
      openQuestions: ["which depth horizon dominates?"],
      assumptions: ["nitrate is non-limiting"],
      deadEnds: ["salinity gradient"],
    },
  });
  const res = await h.tools.world_model.execute("id", { project: "aquila", mode: "read" }, undefined, undefined, h.ctx);
  const d = res.details as any;
  assert.equal(d.project, "aquila");
  assert.equal(d.question, "Does iron limitation drive the bloom?");
  // The read path only --gets (no write).
  assert.ok(h.calls.every((c) => !c.includes("--set")));
  // renderResult produces a card component without throwing.
  const card = h.tools.world_model.renderResult(res, { isPartial: false }, theme, { isError: false });
  assert.ok(card && typeof card.render === "function");
  const lines = card.render(80).join("\n");
  assert.match(lines, /iron limitation/);
  assert.match(lines, /which depth horizon dominates/);
});

test("read renders an empty placeholder when nothing is recorded", async () => {
  const h = harness({ get: {} });
  const res = await h.tools.world_model.execute("id", { project: "aquila", mode: "read" }, undefined, undefined, h.ctx);
  const card = h.tools.world_model.renderResult(res, { isPartial: false }, theme, { isError: false });
  const lines = card.render(80).join("\n");
  assert.match(lines, /nothing recorded yet/i);
});

test("update merges agent sections into the stored snapshot and writes via session-state --set", async () => {
  let written = "";
  const h = harness({
    // The stored snapshot already carries the count/identifier core + an old question.
    get: {
      project: "aquila",
      phase: "analysis",
      step: "review",
      claims: { total: 3, supported: 1, refuted: 1 },
      question: "old question",
      assumptions: ["keep me"],
    },
    capture: (json) => {
      written = json;
    },
  });
  const res = await h.tools.world_model.execute(
    "id",
    {
      project: "aquila",
      mode: "update",
      question: "Does iron limitation drive the bloom?",
      openQuestions: ["which depth horizon dominates?"],
      deadEnds: ["salinity gradient was a dead end"],
    },
    undefined,
    undefined,
    h.ctx,
  );
  assert.equal(res.details.project, "aquila");
  const snap = JSON.parse(written);
  // Agent-supplied sections updated.
  assert.equal(snap.question, "Does iron limitation drive the bloom?");
  assert.deepEqual(snap.openQuestions, ["which depth horizon dominates?"]);
  assert.deepEqual(snap.deadEnds, ["salinity gradient was a dead end"]);
  // Core count/identifier fields preserved from the read.
  assert.equal(snap.phase, "analysis");
  assert.deepEqual(snap.claims, { total: 3, supported: 1, refuted: 1 });
  // A section the agent did NOT supply is kept from the stored snapshot.
  assert.deepEqual(snap.assumptions, ["keep me"]);
});

test("update clamps/bounds via buildSnapshot (>8 truncated, long question clamped)", async () => {
  let written = "";
  const h = harness({ get: { project: "p", phase: "active" }, capture: (j) => (written = j) });
  await h.tools.world_model.execute(
    "id",
    {
      project: "p",
      mode: "update",
      question: "q".repeat(400),
      openQuestions: Array.from({ length: 12 }, (_, i) => `oq${i}`),
    },
    undefined,
    undefined,
    h.ctx,
  );
  const snap = JSON.parse(written);
  assert.ok(snap.question.length <= 240);
  assert.equal(snap.openQuestions.length, 8);
});

test("no-ops on an untrusted project (fail-closed)", async () => {
  const h = harness({ trusted: false, get: { project: "p" } });
  const res = await h.tools.world_model.execute(
    "id",
    { project: "p", mode: "update", question: "should not persist" },
    undefined,
    undefined,
    h.ctx,
  );
  // No session-state call happened at all.
  assert.equal(h.calls.length, 0);
  // The tool returns a benign result (no card built against a write).
  assert.ok(res.content?.[0]?.text);
});

test("renderResult guards the error case (context.isError)", () => {
  const h = harness();
  const card = h.tools.world_model.renderResult(
    { content: [{ type: "text", text: "boom" }], details: {} },
    { isPartial: false },
    theme,
    { isError: true },
  );
  const lines = card.render(80).join("\n");
  assert.match(lines, /Error/);
  assert.match(lines, /boom/);
});
