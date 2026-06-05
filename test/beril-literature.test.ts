import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import berilLit, { expandQueries } from "../extensions/beril-literature.ts";

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
const ctx: any = { hasUI: false, mode: "json" };

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response;
}

/** Run `fn` with `globalThis.fetch` stubbed by a url→body router (concurrency-safe). */
function withRoutedFetch<T>(route: (url: string) => unknown, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL) => jsonResponse(route(String(input)))) as typeof globalThis.fetch;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

/** Run `fn` with `globalThis.fetch` stubbed by a sequence of url→body impls. */
function withStubbedFetch<T>(impls: Array<(url: string) => unknown>, fn: () => Promise<T>): Promise<T> {
  let call = 0;
  return withRoutedFetch((url) => impls[call++](url), fn);
}

/** esummary `result` map for a single record with the given pmid + title. */
function summaryMap(records: Array<{ pmid: string; title: string }>) {
  const result: Record<string, unknown> = { uids: records.map((r) => r.pmid) };
  for (const r of records) {
    result[r.pmid] = { uid: r.pmid, title: r.title, fulljournalname: "J", pubdate: "2023", authors: [] };
  }
  return { result };
}

test("registers lit_search + lit_fetch tools + /literature-review", () => {
  const { tools, commands } = harness();
  assert.ok(tools.lit_search && tools.lit_fetch && commands["literature-review"]);
});

test("lit_search returns normalized records (fetch stubbed)", async () => {
  const { tools } = harness();
  const r: any = await withStubbedFetch(
    [() => ({ esearchresult: { idlist: ["1"] } }), () => summaryMap([{ pmid: "1", title: "A" }])],
    () => tools.lit_search.execute("id", { query: "x", max: 5 }, undefined, undefined, ctx),
  );
  assert.equal(r.details.records[0].pmid, "1");
  assert.equal(r.details.records[0].title, "A");
});

test("lit_fetch returns a single record (fetch stubbed)", async () => {
  const { tools } = harness();
  const r: any = await withStubbedFetch([() => summaryMap([{ pmid: "7", title: "Title7" }])], () =>
    tools.lit_fetch.execute("id", { pmid: "7" }, undefined, undefined, ctx),
  );
  assert.equal(r.details.pmid, "7");
  assert.match(r.content[0].text, /Title7/);
});

test("expandQueries returns [topic] when ctx has no model and no fallback auth", async () => {
  // No model on ctx, and the injected getModel returns undefined → bare topic.
  const out = await expandQueries({ model: undefined } as any, "bare topic", {
    getModel: () => undefined,
    complete: async () => {
      throw new Error("complete must not be called without a model");
    },
  });
  assert.deepEqual(out, ["bare topic"]);
});

test("expandQueries parses a JSON array from the completion", async () => {
  const out = await expandQueries(
    { model: { id: "m" }, modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k" }) } } as any,
    "topic",
    { complete: async () => ({ content: [{ type: "text", text: '["q1","q2"]' }] }) as any },
  );
  assert.deepEqual(out, ["q1", "q2"]);
});

test("expandQueries falls back to [topic] when completion is non-JSON", async () => {
  const out = await expandQueries(
    { model: { id: "m" }, modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k" }) } } as any,
    "topic",
    { complete: async () => ({ content: [{ type: "text", text: "not json" }] }) as any },
  );
  assert.deepEqual(out, ["topic"]);
});

test("/literature-review fans out across queries, dedupes, and writes references.md", async () => {
  const dir = await mkdtemp(join(tmpdir(), "beril-lit-"));
  try {
    const { commands } = harness();
    // Inject a completer that expands to two queries; stub fetch for both searches.
    // q1 and q2 share pmid "1" to exercise dedupe. Route by URL (the two queries'
    // fetches interleave under Promise.all, so a call-order stub is unsafe).
    const prompts: string[] = [];
    const records: Record<string, Array<{ pmid: string; title: string }>> = {
      q1: [
        { pmid: "1", title: "Shared" },
        { pmid: "2", title: "Only1" },
      ],
      q2: [
        { pmid: "1", title: "Shared" },
        { pmid: "3", title: "Only2" },
      ],
    };
    await withRoutedFetch(
      (url) => {
        const u = new URL(url);
        if (u.pathname.endsWith("esearch.fcgi")) {
          const q = u.searchParams.get("term") ?? "";
          return { esearchresult: { idlist: records[q].map((r) => r.pmid) } };
        }
        // esummary: pmid "2" uniquely identifies q1; "3" uniquely identifies q2.
        const ids = (u.searchParams.get("id") ?? "").split(",");
        return summaryMap(ids.includes("2") ? records.q1 : records.q2);
      },
      async () => {
        const cctx: any = {
          hasUI: false,
          mode: "json",
          cwd: dir,
          model: { id: "m" },
          modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k" }) },
          __completer: {
            complete: async (_m: unknown, ctxArg: any) => {
              prompts.push(ctxArg.messages?.[0]?.content ?? "");
              return { content: [{ type: "text", text: '["q1","q2"]' }] };
            },
          },
        };
        await commands["literature-review"].handler("microbial AMR", cctx);
      },
    );

    // Expansion ran exactly once, off the bare topic.
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /microbial AMR/);

    const refs = await readFile(join(dir, "references.md"), "utf8");
    assert.match(refs, /References — microbial AMR/);
    assert.match(refs, /PMID:1/);
    assert.match(refs, /PMID:2/);
    assert.match(refs, /PMID:3/);
    // 3 unique after dedupe of the shared pmid:1
    assert.match(refs, /3 unique reference/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("/literature-review falls back to the bare topic when expansion has no model", async () => {
  const dir = await mkdtemp(join(tmpdir(), "beril-lit-"));
  try {
    const { commands } = harness();
    const esearchTerms: string[] = [];
    await withStubbedFetch(
      [
        (url) => {
          esearchTerms.push(new URL(url).searchParams.get("term") ?? "");
          return { esearchresult: { idlist: ["9"] } };
        },
        () => summaryMap([{ pmid: "9", title: "T" }]),
      ],
      async () => {
        // No model and no completer override → expandQueries returns [topic].
        const cctx: any = { hasUI: false, mode: "json", cwd: dir, model: undefined };
        await commands["literature-review"].handler("bare topic", cctx);
      },
    );
    // Only the bare topic was searched.
    assert.deepEqual(esearchTerms, ["bare topic"]);
    const refs = await readFile(join(dir, "references.md"), "utf8");
    assert.match(refs, /References — bare topic/);
    assert.match(refs, /1 unique reference/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
