import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import berilLit, { LIT_FETCH_CONCURRENCY, LIT_VERIFY_CONCURRENCY } from "../extensions/beril-literature.ts";
import { litConfig } from "../lib/lit.ts";

// Disable the shared NCBI rate gate's spacing so fetches can actually overlap
// in-test; the fan-out's bound is what we assert, not the wire pacing.
litConfig.minIntervalMs = 0;

function harness() {
  const tools: any = {};
  const commands: any = {};
  const sent: string[] = [];
  const pi: any = {
    registerTool: (t: any) => (tools[t.name] = t),
    registerCommand: (n: string, o: any) => (commands[n] = o),
    sendUserMessage: (m: string) => sent.push(m),
  };
  berilLit(pi);
  return { tools, commands, sent };
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** esummary `result` map for the given records (PMID + title). */
function summaryMap(records: Array<{ pmid: string; title: string }>) {
  const result: Record<string, unknown> = { uids: records.map((r) => r.pmid) };
  for (const r of records) {
    result[r.pmid] = { uid: r.pmid, title: r.title, fulljournalname: "J", pubdate: "2023", authors: [] };
  }
  return { result };
}

/** A completer that returns one stance object per assessed PMID (all "supports"). */
const stanceCompleter = {
  complete: async (_m: unknown, ctxArg: any) => {
    const prompt: string = ctxArg.messages?.[0]?.content ?? "";
    const pmids = [...prompt.matchAll(/PMID (\d+):/g)].map((m) => m[1]);
    const arr = pmids.map((pmid) => ({
      pmid,
      stance: "supports",
      confidence: "high",
      exact_quote: "q",
      qualifiers: [],
    }));
    return { content: [{ type: "text", text: JSON.stringify(arr) }] };
  },
};

test("LIT_FETCH/VERIFY_CONCURRENCY are exported positive integers", () => {
  for (const cap of [LIT_FETCH_CONCURRENCY, LIT_VERIFY_CONCURRENCY]) {
    assert.equal(typeof cap, "number");
    assert.ok(Number.isInteger(cap) && cap > 0, `cap ${cap} should be a positive integer`);
  }
});

test("lit_stance fans abstract fetches out bounded + in input order", async () => {
  const { tools } = harness();
  // 12 PMIDs (> LIT_FETCH_CONCURRENCY) so the bound is exercised.
  const pmids = Array.from({ length: 12 }, (_, i) => String(i + 1));
  let inFlight = 0;
  let maxInFlight = 0;
  const original = globalThis.fetch;
  // Inline stub — the abstract path calls res.text(), so jsonResponse won't do.
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    if (url.includes("efetch.fcgi")) {
      // Track concurrent abstract fetches with a small async delay window.
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(5);
      inFlight--;
      const id = new URL(url).searchParams.get("id") ?? "?";
      return { ok: true, text: async () => `abstract for ${id}` } as unknown as Response;
    }
    if (url.includes("esearch.fcgi")) return { ok: true, json: async () => ({ esearchresult: { idlist: pmids } }) };
    // esummary
    return { ok: true, json: async () => summaryMap(pmids.map((p) => ({ pmid: p, title: `T${p}` }))) };
  }) as typeof globalThis.fetch;
  try {
    const ctx: any = {
      hasUI: false,
      mode: "json",
      model: { id: "m" },
      modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k" }) },
      __completer: stanceCompleter,
    };
    const r: any = await tools.lit_stance.execute("id", { hypothesis: "h", max: 12 }, undefined, undefined, ctx);
    const stances = r.details.stances;
    // One stance per record, in the input PMID order.
    assert.equal(stances.length, 12);
    assert.deepEqual(
      stances.map((s: any) => s.record.pmid),
      pmids,
    );
    // Use <= (never ==): the pool may run fewer than the cap at any instant.
    assert.ok(
      maxInFlight <= LIT_FETCH_CONCURRENCY,
      `max in-flight ${maxInFlight} should be <= ${LIT_FETCH_CONCURRENCY}`,
    );
    assert.ok(maxInFlight > 1, "expected at least some real overlap");
  } finally {
    globalThis.fetch = original;
  }
});

test("lit_stance: one failing abstract fetch does not sink the batch", async () => {
  const { tools } = harness();
  const pmids = ["1", "2", "3"];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    if (url.includes("efetch.fcgi")) {
      const id = new URL(url).searchParams.get("id") ?? "?";
      // PMID 2's abstract fetch throws — its abstract must end up "".
      if (id === "2") throw new Error("efetch boom");
      return { ok: true, text: async () => `abstract for ${id}` } as unknown as Response;
    }
    if (url.includes("esearch.fcgi")) return { ok: true, json: async () => ({ esearchresult: { idlist: pmids } }) };
    return { ok: true, json: async () => summaryMap(pmids.map((p) => ({ pmid: p, title: `T${p}` }))) };
  }) as typeof globalThis.fetch;
  // Completer NEIs the paper that has no abstract and supports the rest, so we can
  // see the failed fetch surface as an empty abstract → NEI. Capture the prompt
  // (asserting it OUTSIDE — a throw here would be swallowed by assessStances).
  let seenPrompt = "";
  const completer = {
    complete: async (_m: unknown, ctxArg: any) => {
      seenPrompt = ctxArg.messages?.[0]?.content ?? "";
      const arr = pmids.map((pmid) => ({
        pmid,
        stance: pmid === "2" ? "NEI" : "supports",
        confidence: pmid === "2" ? "low" : "high",
        exact_quote: "",
        qualifiers: [],
      }));
      return { content: [{ type: "text", text: JSON.stringify(arr) }] };
    },
  };
  try {
    const ctx: any = {
      hasUI: false,
      mode: "json",
      model: { id: "m" },
      modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k" }) },
      __completer: completer,
    };
    const r: any = await tools.lit_stance.execute("id", { hypothesis: "h", max: 3 }, undefined, undefined, ctx);
    const stances = r.details.stances;
    // The failed efetch surfaced as an empty abstract → "(no abstract)" in the corpus.
    assert.match(seenPrompt, /PMID 2:[\s\S]*?Abstract: \(no abstract\)/);
    // Every paper gets a StanceResult; the failed one is NEI, the rest keep stance.
    assert.equal(stances.length, 3);
    assert.equal(stances[1].record.pmid, "2");
    assert.equal(stances[1].stance, "NEI");
    assert.equal(stances[0].stance, "supports");
    assert.equal(stances[2].stance, "supports");
  } finally {
    globalThis.fetch = original;
  }
});

test("/literature-review verify-on-write is bounded + drops unresolved PMIDs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "beril-fanout-"));
  try {
    const { commands } = harness();
    // 10 PMIDs (> LIT_VERIFY_CONCURRENCY); the even ones resolve with no title at
    // esummary → resolveCitation ok:false → dropped + counted.
    const pmids = Array.from({ length: 10 }, (_, i) => String(i + 1));
    let inFlight = 0;
    let maxInFlight = 0;
    const original = globalThis.fetch;
    // All-JSON here (search + verify both go through esearch/esummary), so an
    // inline JSON stub is enough; track concurrency on the verify esummary calls.
    globalThis.fetch = (async (input: string | URL) => {
      const u = new URL(String(input));
      if (u.pathname.endsWith("esearch.fcgi")) {
        return { ok: true, json: async () => ({ esearchresult: { idlist: pmids } }) } as unknown as Response;
      }
      // esummary: the search summary returns all titled; the verify step re-fetches
      // one PMID at a time — give even PMIDs an empty title so they fail the check.
      const ids = (u.searchParams.get("id") ?? "").split(",");
      const single = ids.length === 1;
      if (single) {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await delay(5);
        inFlight--;
      }
      const recs = ids.map((p) => ({ pmid: p, title: single && Number(p) % 2 === 0 ? "" : `T${p}` }));
      return { ok: true, json: async () => summaryMap(recs) } as unknown as Response;
    }) as typeof globalThis.fetch;
    try {
      const cctx: any = { hasUI: false, mode: "json", cwd: dir, model: undefined };
      await commands["literature-review"].handler("a topic", cctx);
    } finally {
      globalThis.fetch = original;
    }
    const refs = await readFile(join(dir, "references.md"), "utf8");
    // Odd PMIDs survive; even PMIDs (no title) are dropped.
    for (const p of pmids) {
      if (Number(p) % 2 === 1) assert.match(refs, new RegExp(`PMID:${p}\\b`));
      else assert.doesNotMatch(refs, new RegExp(`PMID:${p}\\b`));
    }
    assert.match(refs, /5 unique reference/);
    assert.ok(
      maxInFlight <= LIT_VERIFY_CONCURRENCY,
      `max in-flight ${maxInFlight} should be <= ${LIT_VERIFY_CONCURRENCY}`,
    );
    assert.ok(maxInFlight > 1, "expected at least some real overlap");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
