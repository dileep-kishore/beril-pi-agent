import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import berilGov from "../extensions/beril-governance.ts";

const READY = { ready: true, location: "off-cluster", checks: {}, next_steps: [] };

function harness(execImpl: any) {
  const tools: any = {};
  const commands: any = {};
  const handlers: any = {};
  const emitted: [string, any][] = [];
  const pi: any = {
    registerTool: (t: any) => (tools[t.name] = t),
    registerCommand: (n: string, o: any) => (commands[n] = o),
    registerMessageRenderer: () => {},
    on: (event: string, h: any) => (handlers[event] = h),
    sendUserMessage: () => {},
    sendMessage: () => {},
    exec: execImpl,
    events: { emit: (channel: string, data: any) => emitted.push([channel, data]), on: () => () => {} },
  };
  berilGov(pi);
  return { tools, commands, handlers, emitted };
}
const ctx: any = { hasUI: false, mode: "json" };

// Tool-execute ctx with a setStatus spy (5th arg to execute). Captures (key,text).
function statusCtx() {
  const statuses: [string, string | undefined][] = [];
  const c: any = {
    hasUI: true,
    mode: "tui",
    ui: { setStatus: (k: string, t: string | undefined) => statuses.push([k, t]) },
  };
  return { ctx: c, statuses };
}

test("registers the governance tools", () => {
  const { tools } = harness(async () => ({ stdout: "{}", stderr: "", code: 0, killed: false }));
  for (const name of [
    "notebook_hash",
    "claim_state",
    "review_preflight",
    "lifecycle_transition",
    "beril_user",
    "lakehouse_submit",
  ]) {
    assert.ok(tools[name], `tool ${name}`);
  }
});

test("beril_user returns identity (complete)", async () => {
  const { tools } = harness(async () => ({
    stdout: JSON.stringify({ name: "A", affiliation: "LBL", orcid: "0000-0001" }),
    stderr: "",
    code: 0,
    killed: false,
  }));
  const r = await tools.beril_user.execute("id", {}, undefined, undefined, ctx);
  assert.equal((r.details as any).orcid, "0000-0001");
  assert.equal((r.details as any).complete, true);
});

test("beril_user preserves identity even when incomplete (exit 1)", async () => {
  const { tools } = harness(async () => ({
    stdout: JSON.stringify({ name: "A", affiliation: "LBL", orcid: "" }),
    stderr: "Missing field(s): orcid",
    code: 1,
    killed: false,
  }));
  const r = await tools.beril_user.execute("id", {}, undefined, undefined, ctx);
  assert.equal((r.details as any).orcid, "");
  assert.equal((r.details as any).complete, false);
});

test("lifecycle_transition shells 'beril lifecycle set' and returns status", async () => {
  const calls: string[][] = [];
  const { tools } = harness(async (_c: string, args: string[]) => {
    calls.push(args);
    return { stdout: JSON.stringify({ status: "reviewed" }), stderr: "", code: 0, killed: false };
  });
  const r = await tools.lifecycle_transition.execute(
    "id",
    { project: "demo", state: "reviewed" },
    undefined,
    undefined,
    ctx,
  );
  assert.deepEqual(calls[0], ["lifecycle", "set", "demo", "reviewed"]);
  assert.equal((r.details as any).status, "reviewed");
});

test("lakehouse_submit throws on partial (exit 2)", async () => {
  const { tools } = harness(async (_c: string, args: string[]) => {
    if (args[0] === "env") return { stdout: JSON.stringify(READY), stderr: "", code: 0, killed: false };
    return { stdout: JSON.stringify({ partial: true }), stderr: "partial archive", code: 2, killed: false };
  });
  await assert.rejects(() => tools.lakehouse_submit.execute("id", { project: "demo" }, undefined, undefined, ctx));
});

test("registers /synthesize /submit commands", () => {
  const { commands } = harness(async () => ({ stdout: "{}", stderr: "", code: 0, killed: false }));
  for (const name of ["synthesize", "submit"]) assert.ok(commands[name], `command ${name}`);
});

test("claim_state persists project-local claims.json when requested", async () => {
  const root = await mkdtemp(join(tmpdir(), "beril-claim-state-"));
  try {
    const dir = join(root, "projects", "demo");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "RESEARCH_PLAN.md"), "- **H1:** Soil genes increase.\n", "utf8");
    await writeFile(
      join(dir, "REPORT.md"),
      "### Finding 1: Soil genes increase\n\nStatus: supported\nConfidence: medium\nSupports: notebooks/01.ipynb — test\nRefutes: none found — searched controls\n",
      "utf8",
    );
    const { tools, emitted } = harness(async () => ({ stdout: "{}", stderr: "", code: 0, killed: false }));
    const res = await tools.claim_state.execute("id", { project: "demo", persist: true }, undefined, undefined, {
      hasUI: false,
      mode: "json",
      cwd: root,
    });
    assert.equal((res.details as any).persisted, true);
    const saved = JSON.parse(await readFile(join(dir, "claims.json"), "utf8"));
    assert.equal(saved.rows[0].status, "supported");
    assert.ok(emitted.find((e) => e[0] === "beril:claims"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("review_preflight summarizes claims, hashes, refutes, review, and readiness", async () => {
  const root = await mkdtemp(join(tmpdir(), "beril-review-preflight-"));
  try {
    const dir = join(root, "projects", "demo");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "RESEARCH_PLAN.md"), "- **H1:** Soil genes increase.\n", "utf8");
    await writeFile(
      join(dir, "REPORT.md"),
      "### Finding 1: Soil genes increase\n\nStatus: supported\nConfidence: medium\nSupports: notebooks/01.ipynb — test\nRefutes: none found — searched controls\n",
      "utf8",
    );
    await writeFile(join(dir, "REFUTATION_1.md"), "No surviving disconfirming checks.\n", "utf8");
    await writeFile(join(dir, "REVIEW_1.md"), "Review\n<!-- report_hash: sha256:abc -->\n", "utf8");
    const { tools } = harness(async (_c: string, args: string[]) => {
      if (args[0] === "hash") {
        return { stdout: JSON.stringify({ "01.ipynb": "sha256:abc" }), stderr: "", code: 0, killed: false };
      }
      if (args[0] === "lifecycle" && args[1] === "status") {
        return { stdout: JSON.stringify({ status: "reviewed" }), stderr: "", code: 0, killed: false };
      }
      return { stdout: "{}", stderr: "", code: 0, killed: false };
    });
    const res = await tools.review_preflight.execute("id", { project: "demo" }, undefined, undefined, {
      hasUI: false,
      mode: "json",
      cwd: root,
    });
    assert.equal((res.details as any).project, "demo");
    assert.equal((res.details as any).claims.supported, 1);
    assert.equal((res.details as any).notebookHashes, 1);
    assert.equal((res.details as any).redTeam, true);
    assert.equal((res.details as any).review, true);
    assert.equal((res.details as any).reviewReady, true);
    assert.equal((res.details as any).submitReady, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("review_preflight warns when synthesis claims miss the synthesis bar", async () => {
  const root = await mkdtemp(join(tmpdir(), "beril-review-preflight-synthesis-"));
  try {
    const dir = join(root, "projects", "demo");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "RESEARCH_PLAN.md"), "- **H1:** Soil genes increase.\n", "utf8");
    await writeFile(
      join(dir, "REPORT.md"),
      [
        "# Report",
        "",
        "## Key Findings",
        "",
        "### Finding 1: Soil genes increase",
        "",
        "Status: supported",
        "Confidence: high",
        "Supports: notebooks/01.ipynb — result",
        "Supports: query:soil-genes — independent query",
        "Supports: paper PMID:123 — mechanism",
        "Refutes:",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(join(dir, "REFUTATION_1.md"), "No surviving disconfirming checks.\n", "utf8");
    await writeFile(join(dir, "REVIEW_1.md"), "Review\n", "utf8");
    const { tools } = harness(async (_c: string, args: string[]) => {
      if (args[0] === "hash") {
        return { stdout: JSON.stringify({ "01.ipynb": "sha256:abc" }), stderr: "", code: 0, killed: false };
      }
      if (args[0] === "lifecycle" && args[1] === "status") {
        return { stdout: JSON.stringify({ status: "reviewed" }), stderr: "", code: 0, killed: false };
      }
      return { stdout: "{}", stderr: "", code: 0, killed: false };
    });
    const res = await tools.review_preflight.execute("id", { project: "demo" }, undefined, undefined, {
      hasUI: false,
      mode: "json",
      cwd: root,
    });
    assert.ok((res.details as any).warnings.some((w: string) => /synthesis/i.test(w)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("review_preflight blocks empty refutes without a search note", async () => {
  const root = await mkdtemp(join(tmpdir(), "beril-review-preflight-refutes-"));
  try {
    const dir = join(root, "projects", "demo");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "RESEARCH_PLAN.md"), "- **H1:** Soil genes increase.\n", "utf8");
    await writeFile(
      join(dir, "REPORT.md"),
      "### Finding 1: Soil genes increase\n\nStatus: supported\nConfidence: medium\nSupports: notebooks/01.ipynb — test\nRefutes:\n",
      "utf8",
    );
    await writeFile(join(dir, "REFUTATION_1.md"), "No surviving disconfirming checks.\n", "utf8");
    const { tools } = harness(async (_c: string, args: string[]) => {
      if (args[0] === "hash") {
        return { stdout: JSON.stringify({ "01.ipynb": "sha256:abc" }), stderr: "", code: 0, killed: false };
      }
      if (args[0] === "lifecycle" && args[1] === "status") {
        return { stdout: JSON.stringify({ status: "analysis" }), stderr: "", code: 0, killed: false };
      }
      return { stdout: "{}", stderr: "", code: 0, killed: false };
    });
    const res = await tools.review_preflight.execute("id", { project: "demo" }, undefined, undefined, {
      hasUI: false,
      mode: "json",
      cwd: root,
    });
    assert.ok((res.details as any).blockers.some((b: string) => /refuting evidence search note/i.test(b)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("/synthesize prompt requires claim_state and refutation checks before lifecycle transition", async () => {
  const sent: string[] = [];
  const { commands } = harness(async () => ({ stdout: "{}", stderr: "", code: 0, killed: false }));
  const { ctx: cctx } = cmdCtx();
  const pi = { sendUserMessage: (m: string) => sent.push(m) };
  // Re-register with a sendUserMessage spy while preserving the normal harness shape.
  const commands2: any = {};
  berilGov({
    ...pi,
    registerTool: () => {},
    registerCommand: (n: string, o: any) => (commands2[n] = o),
    registerMessageRenderer: () => {},
    on: () => {},
    exec: async () => ({ stdout: "{}", stderr: "", code: 0, killed: false }),
    events: { emit: () => {}, on: () => () => {} },
  } as any);
  assert.ok(commands.synthesize);
  await commands2.synthesize.handler("demo", cctx);
  assert.match(sent[0], /claim_state/);
  assert.match(sent[0], /berdl-refute/);
  assert.match(sent[0], /lifecycle_transition/);
});

function cmdCtx() {
  const notes: string[] = [];
  const statuses: [string, string | undefined][] = [];
  const c: any = {
    hasUI: true,
    mode: "tui",
    ui: {
      notify: (m: string) => notes.push(m),
      confirm: async () => true,
      setStatus: (k: string, t: string | undefined) => statuses.push([k, t]),
    },
  };
  return { ctx: c, notes, statuses };
}

test("/submit aborts before upload when ORCID missing", async () => {
  const calls: string[][] = [];
  const { commands } = harness(async (_c: string, args: string[]) => {
    calls.push(args);
    if (args[0] === "user") {
      return {
        stdout: JSON.stringify({ name: "A", affiliation: "LBL", orcid: "" }),
        stderr: "",
        code: 1,
        killed: false,
      };
    }
    return { stdout: "{}", stderr: "", code: 0, killed: false };
  });
  const { ctx: cctx, notes } = cmdCtx();
  await commands.submit.handler("demo", cctx);
  assert.ok(!calls.find((a) => a[0] === "submit"), "must not reach upload");
  assert.match(notes.join(" "), /ORCID/i);
});

test("/submit uploads and marks submitted when ORCID present", async () => {
  const root = await mkdtemp(join(tmpdir(), "beril-submit-ready-"));
  const calls: string[][] = [];
  try {
    const dir = join(root, "projects", "demo");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "RESEARCH_PLAN.md"), "- **H1:** Soil genes increase.\n", "utf8");
    await writeFile(
      join(dir, "REPORT.md"),
      "### Finding 1: Soil genes increase\n\nStatus: supported\nConfidence: medium\nSupports: notebooks/01.ipynb — test\nRefutes: none found — searched controls\n",
      "utf8",
    );
    await writeFile(join(dir, "REFUTATION_1.md"), "No surviving disconfirming checks.\n", "utf8");
    await writeFile(join(dir, "REVIEW_1.md"), "Review\n", "utf8");
    const { commands } = harness(async (_c: string, args: string[]) => {
      calls.push(args);
      if (args[0] === "user") {
        return {
          stdout: JSON.stringify({ name: "A", affiliation: "LBL", orcid: "0000-0001" }),
          stderr: "",
          code: 0,
          killed: false,
        };
      }
      if (args[0] === "hash") {
        return { stdout: JSON.stringify({ "01.ipynb": "sha256:abc" }), stderr: "", code: 0, killed: false };
      }
      if (args[0] === "lifecycle" && args[1] === "status") {
        return { stdout: JSON.stringify({ status: "reviewed" }), stderr: "", code: 0, killed: false };
      }
      return { stdout: JSON.stringify({ archive_key: "k", file_count: 3 }), stderr: "", code: 0, killed: false };
    });
    const { ctx: cctx } = cmdCtx();
    cctx.cwd = root;
    await commands.submit.handler("demo", cctx);
    // Exact arg shape — `beril submit <project>` is positional (contract with the Python CLI).
    assert.deepEqual(
      calls.find((a) => a[0] === "submit"),
      ["submit", "demo"],
    );
    assert.ok(
      calls.find((a) => a[0] === "lifecycle" && a[1] === "marker" && a.includes("submitted")),
      "marked submitted",
    );
    assert.ok(
      calls.find((a) => a[0] === "crate" && a[1] === "demo"),
      "wrote crate before upload",
    );
    assert.ok(
      calls.find((a) => a[0] === "commons" && a[1] === "land" && a.includes("--from-report")),
      "landed commons knowledge",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("/submit stops before upload when crate generation fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "beril-submit-crate-fails-"));
  const calls: string[][] = [];
  try {
    const dir = join(root, "projects", "demo");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "RESEARCH_PLAN.md"), "- **H1:** Soil genes increase.\n", "utf8");
    await writeFile(
      join(dir, "REPORT.md"),
      "### Finding 1: Soil genes increase\n\nStatus: supported\nConfidence: medium\nSupports: notebooks/01.ipynb — test\nRefutes: none found — searched controls\n",
      "utf8",
    );
    await writeFile(join(dir, "REFUTATION_1.md"), "No surviving disconfirming checks.\n", "utf8");
    await writeFile(join(dir, "REVIEW_1.md"), "Review\n", "utf8");
    const { commands } = harness(async (_c: string, args: string[]) => {
      calls.push(args);
      if (args[0] === "user") {
        return {
          stdout: JSON.stringify({ name: "A", affiliation: "LBL", orcid: "0000-0001" }),
          stderr: "",
          code: 0,
          killed: false,
        };
      }
      if (args[0] === "hash") {
        return { stdout: JSON.stringify({ "01.ipynb": "sha256:abc" }), stderr: "", code: 0, killed: false };
      }
      if (args[0] === "lifecycle" && args[1] === "status") {
        return { stdout: JSON.stringify({ status: "reviewed" }), stderr: "", code: 0, killed: false };
      }
      if (args[0] === "crate") {
        return { stdout: "", stderr: "crate failed", code: 2, killed: false };
      }
      return { stdout: JSON.stringify({ archive_key: "k", file_count: 3 }), stderr: "", code: 0, killed: false };
    });
    const { ctx: cctx } = cmdCtx();
    cctx.cwd = root;
    await assert.rejects(() => commands.submit.handler("demo", cctx), /crate failed/);
    assert.ok(!calls.find((a) => a[0] === "submit"), "must not upload when crate generation fails");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("/submit stops before upload when commons landing fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "beril-submit-commons-fails-"));
  const calls: string[][] = [];
  try {
    const dir = join(root, "projects", "demo");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "RESEARCH_PLAN.md"), "- **H1:** Soil genes increase.\n", "utf8");
    await writeFile(
      join(dir, "REPORT.md"),
      "### Finding 1: Soil genes increase\n\nStatus: supported\nConfidence: medium\nSupports: notebooks/01.ipynb — test\nRefutes: none found — searched controls\n",
      "utf8",
    );
    await writeFile(join(dir, "REFUTATION_1.md"), "No surviving disconfirming checks.\n", "utf8");
    await writeFile(join(dir, "REVIEW_1.md"), "Review\n", "utf8");
    const { commands } = harness(async (_c: string, args: string[]) => {
      calls.push(args);
      if (args[0] === "user") {
        return {
          stdout: JSON.stringify({ name: "A", affiliation: "LBL", orcid: "0000-0001" }),
          stderr: "",
          code: 0,
          killed: false,
        };
      }
      if (args[0] === "hash") {
        return { stdout: JSON.stringify({ "01.ipynb": "sha256:abc" }), stderr: "", code: 0, killed: false };
      }
      if (args[0] === "lifecycle" && args[1] === "status") {
        return { stdout: JSON.stringify({ status: "reviewed" }), stderr: "", code: 0, killed: false };
      }
      if (args[0] === "commons") {
        return { stdout: "", stderr: "commons failed", code: 2, killed: false };
      }
      return { stdout: JSON.stringify({ archive_key: "k", file_count: 3 }), stderr: "", code: 0, killed: false };
    });
    const { ctx: cctx } = cmdCtx();
    cctx.cwd = root;
    await assert.rejects(() => commands.submit.handler("demo", cctx), /commons failed/);
    assert.ok(!calls.find((a) => a[0] === "submit"), "must not upload when commons landing fails");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("/submit blocks when review_preflight is not submit ready", async () => {
  const root = await mkdtemp(join(tmpdir(), "beril-submit-blocked-"));
  const calls: string[][] = [];
  try {
    const dir = join(root, "projects", "demo");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "RESEARCH_PLAN.md"), "- **H1:** Soil genes increase.\n", "utf8");
    const { commands } = harness(async (_c: string, args: string[]) => {
      calls.push(args);
      if (args[0] === "user") {
        return {
          stdout: JSON.stringify({ name: "A", affiliation: "LBL", orcid: "0000-0001" }),
          stderr: "",
          code: 0,
          killed: false,
        };
      }
      if (args[0] === "hash") return { stdout: JSON.stringify({}), stderr: "", code: 0, killed: false };
      if (args[0] === "lifecycle" && args[1] === "status") {
        return { stdout: JSON.stringify({ status: "analysis" }), stderr: "", code: 0, killed: false };
      }
      return { stdout: JSON.stringify({ archive_key: "k", file_count: 3 }), stderr: "", code: 0, killed: false };
    });
    let confirmed = false;
    const { ctx: cctx, notes } = cmdCtx();
    cctx.cwd = root;
    cctx.ui.confirm = async () => {
      confirmed = true;
      return true;
    };
    await commands.submit.handler("demo", cctx);
    assert.equal(confirmed, false, "must not ask for destructive approval before preflight passes");
    assert.ok(!calls.find((a) => a[0] === "submit"), "must not upload when preflight blocks");
    assert.match(notes.join(" "), /preflight/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("/submit blocks when review_preflight has blockers even if a review exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "beril-submit-unsupported-"));
  const calls: string[][] = [];
  try {
    const dir = join(root, "projects", "demo");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "RESEARCH_PLAN.md"), "- **H1:** Soil genes increase.\n", "utf8");
    await writeFile(
      join(dir, "REPORT.md"),
      "### Finding 1: Soil genes increase\n\nStatus: unsupported\nConfidence: low\nSupports:\nRefutes:\n",
      "utf8",
    );
    await writeFile(join(dir, "REFUTATION_1.md"), "Needs more checks.\n", "utf8");
    await writeFile(join(dir, "REVIEW_1.md"), "Review\n", "utf8");
    const { commands } = harness(async (_c: string, args: string[]) => {
      calls.push(args);
      if (args[0] === "user") {
        return {
          stdout: JSON.stringify({ name: "A", affiliation: "LBL", orcid: "0000-0001" }),
          stderr: "",
          code: 0,
          killed: false,
        };
      }
      if (args[0] === "hash") {
        return { stdout: JSON.stringify({ "01.ipynb": "sha256:abc" }), stderr: "", code: 0, killed: false };
      }
      if (args[0] === "lifecycle" && args[1] === "status") {
        return { stdout: JSON.stringify({ status: "reviewed" }), stderr: "", code: 0, killed: false };
      }
      return { stdout: JSON.stringify({ archive_key: "k", file_count: 3 }), stderr: "", code: 0, killed: false };
    });
    const { ctx: cctx, notes } = cmdCtx();
    cctx.cwd = root;
    await commands.submit.handler("demo", cctx);
    assert.ok(!calls.find((a) => a[0] === "submit"), "must not upload with unsupported claims");
    assert.match(notes.join(" "), /unsupported/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("/submit blocks headless command mode before upload", async () => {
  const calls: string[][] = [];
  const { commands } = harness(async (_c: string, args: string[]) => {
    calls.push(args);
    if (args[0] === "user") {
      return {
        stdout: JSON.stringify({ name: "A", affiliation: "LBL", orcid: "0000-0001" }),
        stderr: "",
        code: 0,
        killed: false,
      };
    }
    return { stdout: JSON.stringify({ archive_key: "k", file_count: 3 }), stderr: "", code: 0, killed: false };
  });
  await assert.rejects(
    () => commands.submit.handler("demo", { hasUI: false, mode: "json", ui: {}, cwd: process.cwd() }),
    /non-interactive/i,
  );
  assert.ok(!calls.find((a) => a[0] === "submit"), "must not upload in headless command mode");
});

test("lifecycle_transition sets the active-project footer key under hasUI", async () => {
  const { tools } = harness(async () => ({
    stdout: JSON.stringify({ status: "reviewed" }),
    stderr: "",
    code: 0,
    killed: false,
  }));
  const { ctx: sctx, statuses } = statusCtx();
  await tools.lifecycle_transition.execute("id", { project: "demo", state: "reviewed" }, undefined, undefined, sctx);
  const entry = statuses.find((s) => s[0] === "beril-2-project");
  assert.ok(entry, "set beril-2-project");
  assert.match(String(entry?.[1]), /demo/);
});

test("lifecycle_transition does not touch the footer when headless", async () => {
  let setStatusCalled = false;
  const { tools } = harness(async () => ({
    stdout: JSON.stringify({ status: "reviewed" }),
    stderr: "",
    code: 0,
    killed: false,
  }));
  const headless: any = { hasUI: false, mode: "json", ui: { setStatus: () => (setStatusCalled = true) } };
  await tools.lifecycle_transition.execute(
    "id",
    { project: "demo", state: "reviewed" },
    undefined,
    undefined,
    headless,
  );
  assert.equal(setStatusCalled, false, "setStatus must not be called when hasUI is false");
});

test("session_shutdown clears the active-project footer key", async () => {
  const { handlers } = harness(async () => ({ stdout: "{}", stderr: "", code: 0, killed: false }));
  const { ctx: sctx, statuses } = statusCtx();
  await handlers.session_shutdown({ type: "session_shutdown", reason: "quit" }, sctx);
  assert.deepEqual(
    statuses.find((s) => s[0] === "beril-2-project"),
    ["beril-2-project", undefined],
  );
});

test("session_start clears the active-project footer key for /new sessions", async () => {
  const { handlers } = harness(async () => ({ stdout: "{}", stderr: "", code: 0, killed: false }));
  const { ctx: sctx, statuses } = statusCtx();
  await handlers.session_start({ type: "session_start", reason: "new" }, sctx);
  assert.deepEqual(
    statuses.find((s) => s[0] === "beril-2-project"),
    ["beril-2-project", undefined],
  );
});

test("lifecycle_transition emits the RETURNED state on beril:lifecycle", async () => {
  // The state machine returns "analysis" even though the requested target was "reviewed".
  const { tools, emitted } = harness(async () => ({
    stdout: JSON.stringify({ status: "analysis" }),
    stderr: "",
    code: 0,
    killed: false,
  }));
  await tools.lifecycle_transition.execute("id", { project: "demo", state: "reviewed" }, undefined, undefined, ctx);
  const ev = emitted.find((e) => e[0] === "beril:lifecycle");
  assert.ok(ev, "emitted beril:lifecycle");
  assert.deepEqual(ev?.[1], { project: "demo", state: "analysis" });
});

test("lifecycle_transition emits nothing when the transition throws", async () => {
  const { tools, emitted } = harness(async () => ({
    stdout: "",
    stderr: "illegal transition",
    code: 1,
    killed: false,
  }));
  await assert.rejects(() =>
    tools.lifecycle_transition.execute("id", { project: "demo", state: "complete" }, undefined, undefined, ctx),
  );
  assert.equal(
    emitted.find((e) => e[0] === "beril:lifecycle"),
    undefined,
    "no lifecycle event on failure",
  );
});

test("/submit success emits beril:submitted, not beril:lifecycle", async () => {
  const root = await mkdtemp(join(tmpdir(), "beril-submit-event-"));
  try {
    const dir = join(root, "projects", "demo");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "RESEARCH_PLAN.md"), "- **H1:** Soil genes increase.\n", "utf8");
    await writeFile(
      join(dir, "REPORT.md"),
      "### Finding 1: Soil genes increase\n\nStatus: supported\nConfidence: medium\nSupports: notebooks/01.ipynb — test\nRefutes: none found — searched controls\n",
      "utf8",
    );
    await writeFile(join(dir, "REFUTATION_1.md"), "No surviving disconfirming checks.\n", "utf8");
    await writeFile(join(dir, "REVIEW_1.md"), "Review\n", "utf8");
    const { commands, emitted } = harness(async (_c: string, args: string[]) => {
      if (args[0] === "user") {
        return {
          stdout: JSON.stringify({ name: "A", affiliation: "LBL", orcid: "0000-0001" }),
          stderr: "",
          code: 0,
          killed: false,
        };
      }
      if (args[0] === "hash") {
        return { stdout: JSON.stringify({ "01.ipynb": "sha256:abc" }), stderr: "", code: 0, killed: false };
      }
      if (args[0] === "lifecycle" && args[1] === "status") {
        return { stdout: JSON.stringify({ status: "reviewed" }), stderr: "", code: 0, killed: false };
      }
      return { stdout: JSON.stringify({ archive_key: "k", file_count: 3 }), stderr: "", code: 0, killed: false };
    });
    const { ctx: cctx } = cmdCtx();
    cctx.cwd = root;
    await commands.submit.handler("demo", cctx);
    assert.deepEqual(
      emitted.find((e) => e[0] === "beril:submitted"),
      ["beril:submitted", { project: "demo" }],
    );
    assert.equal(
      emitted.find((e) => e[0] === "beril:lifecycle"),
      undefined,
      "submit must not claim a lifecycle transition",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
