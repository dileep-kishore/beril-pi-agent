import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildEpmcSearchParams,
  fetchEuropePmcFullText,
  normalizeEpmcResult,
  searchEuropePmc,
} from "../lib/europepmc.ts";
import { litConfig } from "../lib/lit.ts";

// Europe PMC shares lit.ts's rate gate; disable spacing/retries so the
// network-stubbed tests run instantly (individual tests opt back into retries).
litConfig.minIntervalMs = 0;
litConfig.baseBackoffMs = 0;
litConfig.maxRetries = 0;

test("normalizeEpmcResult maps a full core record", () => {
  const out = normalizeEpmcResult({
    id: "1",
    source: "MED",
    pmid: "1",
    doi: "10.1/x",
    title: "A",
    authorString: "Smith J, Doe A.",
    pubYear: "2023",
    journalInfo: { journal: { title: "J" } },
    abstractText: "...",
    isOpenAccess: "Y",
  });
  assert.deepEqual(out, {
    pmid: "1",
    doi: "10.1/x",
    title: "A",
    journal: "J",
    year: "2023",
    authors: ["Smith J", "Doe A"],
  });
});

test("normalizeEpmcResult defaults strings to '' / authors to [] / doi to undefined", () => {
  assert.deepEqual(normalizeEpmcResult({}), {
    pmid: "",
    doi: undefined,
    title: "",
    journal: "",
    year: "",
    authors: [],
  });
});

test("normalizeEpmcResult leaves pmid '' for a preprint with no pmid", () => {
  const out = normalizeEpmcResult({ source: "PPR", id: "PPR123", title: "Preprint", doi: "10.1/pp" });
  assert.equal(out.pmid, "");
  assert.equal(out.doi, "10.1/pp");
});

test("buildEpmcSearchParams requests core records", () => {
  assert.deepEqual(buildEpmcSearchParams("x", 5), {
    query: "x",
    format: "json",
    resultType: "core",
    pageSize: 5,
  });
});

test("searchEuropePmc yields normalized records from resultList.result[]", async () => {
  const original = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    seen.push(String(input));
    return {
      ok: true,
      json: async () => ({
        resultList: {
          result: [
            { pmid: "1", title: "First", pubYear: "2020", journalInfo: { journal: { title: "J1" } } },
            { doi: "10.2/y", title: "Second", pubYear: "2021", source: "PPR" },
          ],
        },
      }),
    } as unknown as Response;
  }) as typeof globalThis.fetch;
  try {
    const records = await searchEuropePmc("x", 20);
    assert.equal(records.length, 2);
    assert.equal(records[0].pmid, "1");
    assert.equal(records[1].doi, "10.2/y");
    assert.equal(seen.length, 1, "single GET (core records arrive inline)");
    assert.ok(seen[0].includes("/search?"));
    assert.ok(seen[0].includes("resultType=core"));
  } finally {
    globalThis.fetch = original;
  }
});

test("searchEuropePmc returns [] for an empty resultList", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({
      ok: true,
      json: async () => ({ resultList: { result: [] } }),
    }) as unknown as Response) as typeof globalThis.fetch;
  try {
    assert.deepEqual(await searchEuropePmc("nothing", 20), []);
  } finally {
    globalThis.fetch = original;
  }
});

test("searchEuropePmc throws on a non-2xx response after retries are exhausted", async () => {
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
    await assert.rejects(() => searchEuropePmc("x", 20), /Europe PMC request failed/);
  } finally {
    globalThis.fetch = original;
  }
});

test("fetchEuropePmcFullText returns trimmed XML and hits the fullTextXML endpoint", async () => {
  const original = globalThis.fetch;
  let seen = "";
  globalThis.fetch = (async (input: string | URL) => {
    seen = String(input);
    return { ok: true, text: async () => "  <article/>  \n" } as unknown as Response;
  }) as typeof globalThis.fetch;
  try {
    const xml = await fetchEuropePmcFullText("MED", "123");
    assert.equal(xml, "<article/>");
    assert.ok(seen.endsWith("/MED/123/fullTextXML"));
  } finally {
    globalThis.fetch = original;
  }
});
