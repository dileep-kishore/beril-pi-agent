import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEsearchParams, buildEsummaryParams, normalizePubmedSummary, searchPubmed } from "../lib/lit.ts";

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
