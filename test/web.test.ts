import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertPublicHttpUrl,
  buildDocsUrl,
  extractTitleTag,
  isBlockedHost,
  isPrivateIpv4,
  lookupDocs,
  readWeb,
  toWebDoc,
} from "../lib/web.ts";

test("assertPublicHttpUrl accepts http(s) and rejects other schemes / malformed", () => {
  assert.ok(assertPublicHttpUrl("https://example.com/x"));
  assert.ok(assertPublicHttpUrl("http://example.org"));
  assert.throws(() => assertPublicHttpUrl("ftp://example.com"), /only http/i);
  assert.throws(() => assertPublicHttpUrl("file:///etc/passwd"), /only http/i);
  assert.throws(() => assertPublicHttpUrl("javascript:alert(1)"), /only http/i);
  assert.throws(() => assertPublicHttpUrl("not a url"), /not a valid URL/i);
});

test("assertPublicHttpUrl refuses private/loopback hosts", () => {
  assert.throws(() => assertPublicHttpUrl("http://127.0.0.1/x"), /private\/loopback/i);
  assert.throws(() => assertPublicHttpUrl("http://169.254.169.254/latest/meta-data"), /private\/loopback/i);
  assert.throws(() => assertPublicHttpUrl("http://localhost:8080"), /private\/loopback/i);
});

test("isPrivateIpv4 blocks RFC1918 + loopback + link-local, passes public", () => {
  for (const ip of [
    "10.0.0.5",
    "127.0.0.1",
    "192.168.1.1",
    "172.16.0.1",
    "172.31.255.255",
    "169.254.169.254",
    "0.0.0.0",
  ]) {
    assert.equal(isPrivateIpv4(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "93.184.216.34"]) {
    assert.equal(isPrivateIpv4(ip), false, ip);
  }
});

test("isBlockedHost blocks names + IPv6 loopback, passes public domains", () => {
  for (const h of ["localhost", "foo.local", "svc.internal", "::1", "::"]) {
    assert.equal(isBlockedHost(h), true, h);
  }
  for (const h of ["example.com", "fcc.gov", "8.8.8.8"]) {
    assert.equal(isBlockedHost(h), false, h);
  }
});

test("extractTitleTag pulls the <title> or returns ''", () => {
  assert.equal(extractTitleTag("<html><head><title>Hi There</title></head></html>"), "Hi There");
  assert.equal(extractTitleTag("<html><body>no title</body></html>"), "");
});

test("toWebDoc collapses blank runs, falls back to title, defaults strings", () => {
  const a = toWebDoc(
    { title: "T", byline: "By X", textContent: "a\n\n\n\nb", siteName: "S", excerpt: "e" },
    "fb",
    "https://x/y",
    "2026-06-13T00:00:00.000Z",
  );
  assert.equal(a.title, "T");
  assert.equal(a.markdown, "a\n\nb");
  assert.equal(a.siteName, "S");
  const b = toWebDoc(null, "Fallback", "https://x/z", "2026-06-13T00:00:00.000Z");
  assert.equal(b.title, "Fallback");
  assert.equal(b.byline, "");
  assert.equal(b.markdown, "");
});

test("buildDocsUrl encodes topic + tokens against the library id", () => {
  const url = buildDocsUrl("/scverse/scanpy", "quality control");
  assert.ok(url.includes("/scverse/scanpy?"));
  assert.ok(url.includes("type=txt"));
  assert.ok(url.includes("tokens=4000"));
  assert.ok(/topic=quality(\+|%20)control/.test(url));
});

test("readWeb extracts a readable article (fetch stubbed)", async () => {
  const para = "Differential expression analysis with DESeq2 normalizes counts and estimates dispersion. ".repeat(12);
  const html = `<html><head><title>DE Methods</title></head><body><article><h1>DE Methods</h1><p>${para}</p></article></body></html>`;
  const original = globalThis.fetch;
  let seen = "";
  globalThis.fetch = (async (input: string | URL) => {
    seen = String(input);
    return {
      ok: true,
      url: "https://example.com/de",
      headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null) },
      arrayBuffer: async () => new TextEncoder().encode(html).buffer,
    } as unknown as Response;
  }) as typeof globalThis.fetch;
  try {
    const doc = await readWeb("https://example.com/de");
    assert.ok(seen.startsWith("https://example.com/de"));
    assert.match(doc.title, /DE Methods/);
    assert.ok(doc.markdown.length > 0);
    assert.match(doc.retrievedAt, /^\d{4}-\d\d-\d\dT/);
    assert.equal(doc.finalUrl, "https://example.com/de");
  } finally {
    globalThis.fetch = original;
  }
});

test("readWeb rejects a non-2xx response", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({
      ok: false,
      status: 404,
      statusText: "Not Found",
      url: "https://example.com/missing",
    }) as unknown as Response) as typeof globalThis.fetch;
  try {
    await assert.rejects(() => readWeb("https://example.com/missing"), /fetch failed: 404/);
  } finally {
    globalThis.fetch = original;
  }
});

test("lookupDocs returns ok when Context7 resolves + returns snippets", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    if (url.includes("/search?")) {
      return { ok: true, json: async () => ({ results: [{ id: "/scverse/scanpy" }] }) } as unknown as Response;
    }
    return { ok: true, status: 200, text: async () => "scanpy.pp.normalize_total(adata)" } as unknown as Response;
  }) as typeof globalThis.fetch;
  try {
    const r = await lookupDocs("scanpy", "normalization");
    assert.equal(r.ok, true);
    assert.equal(r.libraryId, "/scverse/scanpy");
    assert.match(r.snippets, /normalize_total/);
  } finally {
    globalThis.fetch = original;
  }
});

test("lookupDocs degrades to a best-effort note on a 429 (never throws)", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    if (url.includes("/search?")) {
      return { ok: true, json: async () => ({ results: [{ id: "/scverse/scanpy" }] }) } as unknown as Response;
    }
    return { ok: false, status: 429, statusText: "Too Many Requests", text: async () => "" } as unknown as Response;
  }) as typeof globalThis.fetch;
  try {
    const r = await lookupDocs("scanpy", "");
    assert.equal(r.ok, false);
    assert.match(r.note ?? "", /rate limit|quota/i);
  } finally {
    globalThis.fetch = original;
  }
});
