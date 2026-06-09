import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildEsearchParams,
  buildEsummaryParams,
  litConfig,
  normalizePubmedSummary,
  searchPubmed,
} from "../lib/lit.ts";

// Disable request spacing + retries by default so the network-stubbed tests run
// instantly; individual tests opt back into retries where that's the behaviour
// under test.
litConfig.minIntervalMs = 0;
litConfig.baseBackoffMs = 0;
litConfig.maxRetries = 0;

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response;
}

function withStubbedFetch<T>(impls: Array<(url: string) => unknown>, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  let call = 0;
  globalThis.fetch = (async (input: string | URL) => {
    const impl = impls[call++];
    return jsonResponse(impl(String(input)));
  }) as typeof globalThis.fetch;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

test("normalizePubmedSummary maps a raw esummary record", () => {
  const out = normalizePubmedSummary({
    uid: "1",
    title: "A",
    fulljournalname: "J",
    pubdate: "2023 Jan",
    authors: [{ name: "X" }],
  });
  assert.deepEqual(out, { pmid: "1", title: "A", journal: "J", year: "2023", authors: ["X"] });
});

test("normalizePubmedSummary defaults every string to '' and authors to []", () => {
  assert.deepEqual(normalizePubmedSummary({}), {
    pmid: "",
    title: "",
    journal: "",
    year: "",
    authors: [],
  });
});

test("buildEsearchParams builds the esearch query params", () => {
  assert.deepEqual(buildEsearchParams("x", 5), {
    db: "pubmed",
    term: "x",
    retmax: 5,
    retmode: "json",
  });
});

test("buildEsummaryParams joins pmids with commas", () => {
  assert.deepEqual(buildEsummaryParams(["1", "2", "3"]), {
    db: "pubmed",
    id: "1,2,3",
    retmode: "json",
  });
});

test("searchPubmed yields normalized records in idlist order, skipping missing ids", async () => {
  const records = await withStubbedFetch(
    [
      // esearch → idlist
      () => ({ esearchresult: { idlist: ["2", "1", "missing"] } }),
      // esummary → result map (note: "uids" meta key + different order)
      () => ({
        result: {
          uids: ["1", "2"],
          "1": { uid: "1", title: "First", fulljournalname: "J1", pubdate: "2020 Mar", authors: [{ name: "A" }] },
          "2": { uid: "2", title: "Second", fulljournalname: "J2", pubdate: "2021", authors: [] },
        },
      }),
    ],
    () => searchPubmed("x", 20),
  );
  // idlist order: 2, 1, (missing skipped)
  assert.equal(records.length, 2);
  assert.equal(records[0].pmid, "2");
  assert.equal(records[0].year, "2021");
  assert.equal(records[1].pmid, "1");
  assert.equal(records[1].year, "2020");
});

test("searchPubmed returns [] for an empty idlist (no esummary call)", async () => {
  const records = await withStubbedFetch([() => ({ esearchresult: { idlist: [] } })], () =>
    searchPubmed("nothing", 20),
  );
  assert.deepEqual(records, []);
});

test("searchPubmed throws on a non-2xx response after retries are exhausted", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      headers: { get: () => null },
      json: async () => ({}),
    }) as unknown as Response) as typeof globalThis.fetch;
  try {
    await assert.rejects(() => searchPubmed("x", 20), /429/);
  } finally {
    globalThis.fetch = original;
  }
});

test("getJson retries a 429 then succeeds", async () => {
  const prevRetries = litConfig.maxRetries;
  litConfig.maxRetries = 2;
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) {
      return {
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: { get: () => null },
        json: async () => ({}),
      } as unknown as Response;
    }
    if (calls === 2) {
      return { ok: true, json: async () => ({ esearchresult: { idlist: ["1"] } }) } as unknown as Response;
    }
    return {
      ok: true,
      json: async () => ({ result: { "1": { uid: "1", title: "T", pubdate: "2020" } } }),
    } as unknown as Response;
  }) as typeof globalThis.fetch;
  try {
    const records = await searchPubmed("x", 5);
    assert.equal(records.length, 1);
    assert.equal(calls, 3, "one retried 429, then esearch + esummary");
  } finally {
    globalThis.fetch = original;
    litConfig.maxRetries = prevRetries;
  }
});

test("requests attach tool + api_key when configured (rate-limit lift)", async () => {
  const prevKey = litConfig.apiKey;
  litConfig.apiKey = "secret";
  const original = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    seen.push(String(input));
    return { ok: true, json: async () => ({ esearchresult: { idlist: [] } }) } as unknown as Response;
  }) as typeof globalThis.fetch;
  try {
    await searchPubmed("x", 5);
    assert.ok(seen[0].includes("api_key=secret"), "api_key attached");
    assert.ok(seen[0].includes("tool=beril"), "tool attached");
  } finally {
    globalThis.fetch = original;
    litConfig.apiKey = prevKey;
  }
});
