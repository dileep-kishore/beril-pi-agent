import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import berilLit, {
  assessStances,
  expandQueries,
  parseLiteratureReviewArgs,
  resolveCitation,
  resolveDoi,
} from "../extensions/beril-literature.ts";

// Model-role resolution reads BERIL_* env vars; scrub them so these tests are
// deterministic even when run from inside a CBORG beril session.
for (const k of Object.keys(process.env)) {
  if (k === "BERIL_MODEL_PROVIDER" || /^BERIL_(MAIN|FAST|REVIEW|VISION)_MODEL$/.test(k)) {
    Reflect.deleteProperty(process.env, k);
  }
}

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

test("registers lit_search + lit_fetch + lit_abstract tools + /literature-review", () => {
  const { tools, commands } = harness();
  assert.ok(tools.lit_search && tools.lit_fetch && tools.lit_abstract && commands["literature-review"]);
});

test("parseLiteratureReviewArgs supports explicit project scoping", () => {
  assert.deepEqual(parseLiteratureReviewArgs("--project demo microbial AMR"), {
    project: "demo",
    topic: "microbial AMR",
  });
  assert.deepEqual(parseLiteratureReviewArgs("microbial AMR"), { project: undefined, topic: "microbial AMR" });
});

test("lit_abstract returns abstract text + record (fetch stubbed)", async () => {
  const { tools } = harness();
  // esummary (JSON metadata) and efetch (plain-text abstract) are routed by URL,
  // since lit_abstract fires both in parallel.
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    if (url.includes("efetch.fcgi")) return { ok: true, text: async () => "The abstract body." } as unknown as Response;
    return { ok: true, json: async () => summaryMap([{ pmid: "9", title: "Title9" }]) } as unknown as Response;
  }) as typeof globalThis.fetch;
  try {
    const r: any = await tools.lit_abstract.execute("id", { pmid: "9" }, undefined, undefined, ctx);
    assert.equal(r.details.record.pmid, "9");
    assert.match(r.details.abstract, /The abstract body\./);
    assert.match(r.content[0].text, /The abstract body\./);
  } finally {
    globalThis.fetch = original;
  }
});

test("lit_search merges PubMed + Europe PMC (routed by URL, deduped)", async () => {
  const { tools } = harness();
  // lit_search now fans out to PubMed (esearch -> esummary) and Europe PMC (/search)
  // concurrently, so route by URL rather than by call sequence.
  const r: any = await withRoutedFetch(
    (url) => {
      if (url.includes("esearch.fcgi")) return { esearchresult: { idlist: ["1"] } };
      if (url.includes("esummary.fcgi")) return summaryMap([{ pmid: "1", title: "A" }]);
      // Europe PMC: a DOI-only open-access record with a distinct title (survives dedupe).
      return { resultList: { result: [{ doi: "10.9/z", title: "OA Preprint", pubYear: "2024", source: "PPR" }] } };
    },
    () => tools.lit_search.execute("id", { query: "x", max: 5 }, undefined, undefined, ctx),
  );
  const records = r.details.records;
  assert.ok(records.some((x: any) => x.pmid === "1" && x.title === "A"));
  assert.ok(records.some((x: any) => x.doi === "10.9/z"));
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

test("expandQueries routes through the fast role model in a CBORG session", async () => {
  process.env.BERIL_MODEL_PROVIDER = "cborg";
  process.env.BERIL_FAST_MODEL = "cborg/lbl/cborg-mini";
  try {
    const mini = { provider: "cborg", id: "lbl/cborg-mini" };
    const used: unknown[] = [];
    const out = await expandQueries(
      {
        model: { id: "lbl/cborg-coder" },
        modelRegistry: {
          find: (p: string, id: string) => (p === "cborg" && id === "lbl/cborg-mini" ? mini : undefined),
          getAll: () => [mini],
          getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k" }),
        },
      } as any,
      "topic",
      {
        complete: async (model: unknown) => {
          used.push(model);
          return { content: [{ type: "text", text: '["q1"]' }] } as any;
        },
      },
    );
    assert.deepEqual(out, ["q1"]);
    assert.equal(used[0], mini, "expansion must use lbl/cborg-mini, not the session model");
  } finally {
    Reflect.deleteProperty(process.env, "BERIL_MODEL_PROVIDER");
    Reflect.deleteProperty(process.env, "BERIL_FAST_MODEL");
  }
});

test("expandQueries returns [topic] when the fast role model resolves but has no auth", async () => {
  // The common misconfiguration: CBORG provisioned (model resolves via the
  // registry) but CBORG_API_KEY unset (auth {ok:false}) — the unauthenticated
  // complete() throws and expansion must degrade to the bare topic.
  process.env.BERIL_MODEL_PROVIDER = "cborg";
  process.env.BERIL_FAST_MODEL = "cborg/lbl/cborg-mini";
  try {
    const mini = { provider: "cborg", id: "lbl/cborg-mini" };
    const out = await expandQueries(
      {
        model: { id: "lbl/cborg-coder" },
        modelRegistry: {
          find: (p: string, id: string) => (p === "cborg" && id === "lbl/cborg-mini" ? mini : undefined),
          getAll: () => [mini],
          getApiKeyAndHeaders: async () => ({ ok: false, error: "no key" }),
        },
      } as any,
      "topic",
      {
        complete: async (_model: unknown, _ctx: unknown, opts: any) => {
          if (!opts?.apiKey) throw new Error("401: no auth");
          return { content: [{ type: "text", text: '["q1"]' }] } as any;
        },
      },
    );
    assert.deepEqual(out, ["topic"]);
  } finally {
    Reflect.deleteProperty(process.env, "BERIL_MODEL_PROVIDER");
    Reflect.deleteProperty(process.env, "BERIL_FAST_MODEL");
  }
});

test("expandQueries falls back to the session model when the fast role ref cannot resolve", async () => {
  process.env.BERIL_FAST_MODEL = "cborg/lbl/cborg-mini";
  try {
    const session = { id: "session-model" };
    const used: unknown[] = [];
    // Registry has no cborg provider (profile never provisioned) → helper
    // falls back to ctx.model, exactly the pre-role behavior.
    const out = await expandQueries(
      {
        model: session,
        modelRegistry: {
          find: () => undefined,
          getAll: () => [],
          getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k" }),
        },
      } as any,
      "topic",
      {
        complete: async (model: unknown) => {
          used.push(model);
          return { content: [{ type: "text", text: '["q1"]' }] } as any;
        },
      },
    );
    assert.deepEqual(out, ["q1"]);
    assert.equal(used[0], session);
  } finally {
    Reflect.deleteProperty(process.env, "BERIL_FAST_MODEL");
  }
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
    // Route by URL: the verify-on-write step re-fetches each PMID via esummary
    // after the search, so a call-order stub is unsafe here.
    await withRoutedFetch(
      (url) => {
        const u = new URL(url);
        if (u.pathname.endsWith("esearch.fcgi")) {
          esearchTerms.push(u.searchParams.get("term") ?? "");
          return { esearchresult: { idlist: ["9"] } };
        }
        return summaryMap([{ pmid: "9", title: "T" }]);
      },
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

test("/literature-review --project writes project-scoped references.md", async () => {
  const dir = await mkdtemp(join(tmpdir(), "beril-lit-project-"));
  try {
    await mkdir(join(dir, "projects", "demo"), { recursive: true });
    const { commands, sent } = harness();
    await withRoutedFetch(
      (url) => {
        const u = new URL(url);
        if (u.pathname.endsWith("esearch.fcgi")) return { esearchresult: { idlist: ["42"] } };
        return summaryMap([{ pmid: "42", title: "Scoped reference" }]);
      },
      async () => {
        const cctx: any = { hasUI: false, mode: "json", cwd: dir, model: undefined };
        await commands["literature-review"].handler("--project demo microbial AMR", cctx);
      },
    );
    const refs = await readFile(join(dir, "projects", "demo", "references.md"), "utf8");
    assert.match(refs, /Scoped reference/);
    assert.match(sent[0], /projects\/demo\/references\.md/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveCitation returns ok:false when the fetcher throws", async () => {
  const check = await resolveCitation("99", undefined, async () => {
    throw new Error("no PubMed record");
  });
  assert.equal(check.ok, false);
  assert.equal(check.pmid, "99");
  assert.match(check.reason ?? "", /did not resolve/);
});

test("resolveCitation returns ok:false when the record has no title", async () => {
  const check = await resolveCitation("88", undefined, async () => ({ pmid: "88", title: "" }));
  assert.equal(check.ok, false);
  assert.match(check.reason ?? "", /no title/);
});

test("resolveCitation returns ok:true when the record resolves with a title", async () => {
  const check = await resolveCitation("7", undefined, async () => ({ pmid: "7", title: "Title7" }));
  assert.equal(check.ok, true);
  assert.equal(check.title, "Title7");
});

test("resolveDoi returns ok:true when the DOI resolves at Europe PMC", async () => {
  const check = await resolveDoi("10.1/x", undefined, async () => [{ pmid: "1", doi: "10.1/x", title: "A" }]);
  assert.equal(check.ok, true);
  assert.equal(check.title, "A");
  assert.equal(check.pmid, "1");
});

test("resolveDoi returns ok:false when the DOI does not resolve", async () => {
  const check = await resolveDoi("10.bad/x", undefined, async () => []);
  assert.equal(check.ok, false);
  assert.match(check.reason ?? "", /did not resolve/);
});

test("resolveDoi returns ok:false when the resolved record has no title", async () => {
  const check = await resolveDoi("10.1/y", undefined, async () => [{ pmid: "", doi: "10.1/y", title: "" }]);
  assert.equal(check.ok, false);
});

test("assessStances returns all-NEI when no model and no fallback auth", async () => {
  const assessed = [
    { record: { pmid: "1", title: "A" }, abstract: "a" },
    { record: { pmid: "2", title: "B" }, abstract: "b" },
  ];
  // No model on ctx, and the injected getModel returns undefined → all-NEI.
  const out = await assessStances({ model: undefined } as any, "hypothesis", assessed, {
    getModel: () => undefined,
    complete: async () => {
      throw new Error("complete must not be called without a model");
    },
  });
  assert.equal(out.length, 2);
  for (const s of out) {
    assert.equal(s.stance, "NEI");
    assert.equal(s.confidence, "low");
    assert.equal(s.exact_quote, "");
    assert.deepEqual(s.qualifiers, []);
  }
  assert.equal(out[0].record.pmid, "1");
  assert.equal(out[1].record.pmid, "2");
});

test("assessStances maps a JSON array back onto records, defaulting unmatched to NEI", async () => {
  const assessed = [
    { record: { pmid: "1", title: "A" }, abstract: "a" },
    { record: { pmid: "2", title: "B" }, abstract: "b" },
  ];
  const out = await assessStances(
    { model: { id: "m" }, modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k" }) } } as any,
    "hypothesis",
    assessed,
    {
      complete: async () =>
        ({
          content: [
            {
              type: "text",
              text: '[{"pmid":"1","stance":"supports","confidence":"high","exact_quote":"q","qualifiers":["x"]}]',
            },
          ],
        }) as any,
    },
  );
  assert.equal(out[0].stance, "supports");
  assert.equal(out[0].confidence, "high");
  assert.equal(out[0].exact_quote, "q");
  assert.deepEqual(out[0].qualifiers, ["x"]);
  // pmid "2" had no match in the array → defaults to NEI.
  assert.equal(out[1].stance, "NEI");
});
