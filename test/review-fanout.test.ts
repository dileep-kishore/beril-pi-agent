import assert from "node:assert/strict";
import { test } from "node:test";
import { DESTRUCTIVE_TOOLS } from "../lib/destructive.ts";
import {
  type PanelResult,
  REVIEW_TOOLS,
  mergePanelReviews,
  runReviewPanel,
  stripFrontmatter,
} from "../lib/review-agent.ts";
import { REVIEW_PANEL } from "../lib/review-rubric.ts";

// Model-role resolution reads BERIL_* env vars; scrub them so these tests are
// deterministic even when run from inside a CBORG beril session.
for (const k of Object.keys(process.env)) {
  if (k === "BERIL_MODEL_PROVIDER" || /^BERIL_(MAIN|FAST|REVIEW|VISION)_MODEL$/.test(k)) {
    Reflect.deleteProperty(process.env, k);
  }
}

// The load-bearing safety invariant: every fan-out reviewer is built with this
// allowlist, so a panelist can never reach a destructive tool / bash / edit / write.
test("REVIEW_TOOLS is read-only — never a destructive tool, bash, edit, or write", () => {
  // string[] (not a literal compare) so the runtime guard survives even if the
  // allowlist type widens — and TS doesn't reject it as a no-overlap comparison.
  const forbidden: readonly string[] = ["bash", "edit", "write"];
  for (const t of REVIEW_TOOLS) {
    assert.equal(DESTRUCTIVE_TOOLS.has(t), false, t);
    assert.equal(forbidden.includes(t), false, t);
  }
});

test("runReviewPanel fans out over the whole panel via the injected factory", async () => {
  const seen: string[] = [];
  const factory = async (cfg: { rubric: string }) => {
    seen.push(cfg.rubric);
    return {
      prompt: async () => {},
      getLastAssistantText: () => `## section for ${cfg.rubric.slice(0, 8)}`,
      abort: async () => {},
      dispose: () => {},
    };
  };
  const ctx = {
    model: { id: "m" },
    modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k" }) },
    signal: undefined,
  } as any;
  const results = await runReviewPanel(ctx, { projectDir: "/p", project: "proj" }, factory as any);
  assert.equal(results.length, REVIEW_PANEL.length);
  assert.equal(seen.length, REVIEW_PANEL.length, "each specialist dispatched once");
  assert.ok(results.every((r) => Boolean(r.text?.length)));
});

test("runReviewPanel caps concurrency at 5 when BERIL_MODEL_PROVIDER=cborg", async () => {
  process.env.BERIL_MODEL_PROVIDER = "cborg";
  try {
    // Six specialists whose prompts block until released; with the CBORG cap the
    // sixth must not start while five are in flight.
    const panel = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, title: `S${i}`, rubric: `r${i}` }));
    let started = 0;
    let release!: () => void;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    const factory = async () => ({
      prompt: async () => {
        started++;
        await gate;
      },
      getLastAssistantText: () => "ok",
      abort: async () => {},
      dispose: () => {},
    });
    const ctx = {
      model: { id: "m" },
      modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k" }) },
      signal: undefined,
    } as any;
    const run = runReviewPanel(ctx, { projectDir: "/p", project: "proj", panel }, factory as any);
    // Let the pool spin up; only 5 workers may have dispatched.
    await new Promise((res) => setTimeout(res, 20));
    assert.equal(started, 5, "sixth panelist must wait for a free slot");
    release();
    const results = await run;
    assert.equal(results.length, 6);
    assert.ok(results.every((r) => r.text === "ok"));
  } finally {
    Reflect.deleteProperty(process.env, "BERIL_MODEL_PROVIDER");
  }
});

test("mergePanelReviews has one frontmatter + one panel title, strips panelist frontmatter", () => {
  const results: PanelResult[] = [
    { spec: { id: "a", title: "Biology & Methodology", rubric: "" }, text: "## Biology & Methodology\n\nbody A" },
    {
      spec: { id: "ref", title: "Refutation", rubric: "" },
      text: "---\nreviewer: X\n---\n\n# Refutation Pass\n\nbody R",
    },
  ];
  const merged = mergePanelReviews("proj", results, "2026-06-13");
  assert.equal((merged.match(/^# Panel Review/gm) || []).length, 1);
  assert.ok(merged.startsWith("---\nreviewer: BERIL Multi-Specialist Panel"));
  assert.ok(merged.includes("## Biology & Methodology"));
  assert.ok(merged.includes("# Refutation Pass"));
  assert.ok(!merged.includes("reviewer: X"), "panelist frontmatter stripped");
  assert.ok(!merged.includes("report_hash"), "footer is the caller's job");
});

test("a failed panelist becomes an explicit did-not-complete stub", () => {
  const results: PanelResult[] = [
    { spec: { id: "a", title: "Statistics & Findings", rubric: "" }, text: null, error: "boom" },
    { spec: { id: "b", title: "Reproducibility", rubric: "" }, text: "## Reproducibility\n\nok" },
  ];
  const merged = mergePanelReviews("proj", results, "2026-06-13");
  assert.match(merged, /did not complete: boom/);
  assert.ok(merged.includes("## Reproducibility"));
});

test("stripFrontmatter removes only a leading block", () => {
  assert.equal(stripFrontmatter("---\na: 1\n---\nbody"), "body");
  assert.equal(stripFrontmatter("## no fm\n\nbody"), "## no fm\n\nbody");
});
