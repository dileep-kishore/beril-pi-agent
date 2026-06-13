/**
 * Web access for the co-scientist, free and key-free by default. Two clients:
 *  - `readWeb`: fetch a public http(s) URL and extract its readable article text
 *    LOCALLY (global `fetch` → linkedom DOM → @mozilla/readability). No service,
 *    no key, no cost. An http(s)-only + private-IP SSRF guard, a size cap, and a
 *    timeout keep it safe to point at an arbitrary URL.
 *  - `lookupDocs`: current library/framework docs via Context7's no-key tier
 *    (an optional CONTEXT7_API_KEY lifts limits). Best-effort: on a rate limit it
 *    returns an honest "unavailable" result rather than throwing, so a turn never
 *    fails because docs were rate-limited.
 *
 * The pure helpers (`assertPublicHttpUrl`, `isBlockedHost`, `isPrivateIpv4`,
 * `toWebDoc`, `extractTitleTag`, `buildDocsUrl`) carry the testable logic; the
 * network functions are thin. Strip-safe: plain functions/interfaces only.
 */

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

const HTTP_TIMEOUT_MS = 20_000;

/** Runtime knobs (mutable so tests can disable caps). */
export const webConfig = {
  maxBytes: 2_000_000,
  userAgent: process.env.BERIL_WEB_UA?.trim() || "beril-pi-agent/0.1 (+research co-scientist)",
  timeoutMs: HTTP_TIMEOUT_MS,
};

/** A fetched, readable web page — the `details` payload of `web_read`. */
export interface WebDoc {
  title: string;
  byline: string;
  markdown: string;
  finalUrl: string;
  retrievedAt: string;
  siteName: string;
  excerpt: string;
}

// ── pure helpers (unit-tested) ───────────────────────────

/** Whether an IPv4 literal is private/loopback/link-local (incl. cloud metadata 169.254). */
export function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const octets = m.slice(1, 5).map(Number);
  if (octets.some((n) => n > 255)) return false;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

/** Whether a hostname must never be fetched (loopback/private/link-local/internal). */
export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h.includes(":")) {
    // IPv6: loopback/unspecified, link-local (fe80:), unique-local (fc/fd).
    if (h === "::1" || h === "::") return true;
    if (h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  }
  return isPrivateIpv4(h);
}

/** Parse + validate a URL: http(s) only, never a private/loopback host. Throws otherwise. */
export function assertPublicHttpUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`not a valid URL: ${raw}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`only http(s) URLs are allowed (got ${u.protocol})`);
  }
  if (isBlockedHost(u.hostname.toLowerCase())) {
    throw new Error(`refusing to fetch a private/loopback address: ${u.hostname}`);
  }
  return u;
}

interface ReadabilityArticle {
  title?: string | null;
  byline?: string | null;
  textContent?: string | null;
  siteName?: string | null;
  excerpt?: string | null;
}

/** Readability article (or null) + a <title> fallback → a WebDoc-ready core. Pure. */
export function toWebDoc(
  article: ReadabilityArticle | null,
  fallbackTitle: string,
  finalUrl: string,
  retrievedAt: string,
): WebDoc {
  const markdown = (article?.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
  return {
    title: article?.title?.trim() || fallbackTitle.trim() || finalUrl,
    byline: article?.byline?.trim() || "",
    markdown,
    finalUrl,
    retrievedAt,
    siteName: article?.siteName?.trim() || "",
    excerpt: article?.excerpt?.trim() || "",
  };
}

/** Extract the raw `<title>` text from HTML for the fallback when Readability returns null. Pure. */
export function extractTitleTag(html: string): string {
  const m = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  return m ? m[1].trim() : "";
}

// ── network functions (thin) ─────────────────────────────

async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`response too large: ${declared} bytes`);
  const body = (res as unknown as { body?: AsyncIterable<Uint8Array> | null }).body;
  if (body && typeof (body as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function") {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of body) {
      total += chunk.byteLength;
      if (total > maxBytes) throw new Error(`response too large (> ${maxBytes} bytes)`);
      chunks.push(chunk);
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.byteLength;
    }
    return out;
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) throw new Error(`response too large (> ${maxBytes} bytes)`);
  return buf;
}

/** Fetch a public http(s) URL and extract its readable article text. */
export async function readWeb(rawUrl: string, signal?: AbortSignal): Promise<WebDoc> {
  const requested = assertPublicHttpUrl(rawUrl);
  const res = await fetch(requested, {
    signal: signal ?? AbortSignal.timeout(webConfig.timeoutMs),
    headers: { "user-agent": webConfig.userAgent, accept: "text/html,application/xhtml+xml,text/plain" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
  const finalUrl = res.url || requested.href;
  // Re-validate the post-redirect host (defends against an open redirect → internal).
  assertPublicHttpUrl(finalUrl);
  const ct = res.headers?.get?.("content-type") ?? "";
  if (ct && !/text\/html|application\/xhtml|text\/plain/i.test(ct)) {
    throw new Error(`unsupported content-type: ${ct}`);
  }
  const html = new TextDecoder().decode(await readCapped(res, webConfig.maxBytes));
  const { document } = parseHTML(html); // linkedom — no script execution
  const article = new Readability(document as unknown as Document).parse() as ReadabilityArticle | null;
  return toWebDoc(article, extractTitleTag(html), finalUrl, new Date().toISOString());
}

// ── Context7 docs client (no key required) ───────────────

const CONTEXT7_API_KEY = process.env.CONTEXT7_API_KEY?.trim() || undefined;

export const docsConfig = {
  apiKey: CONTEXT7_API_KEY,
  base: process.env.CONTEXT7_BASE?.trim() || "https://context7.com/api/v1",
  timeoutMs: 20_000,
};

/** A library-docs lookup result — the `details` payload of `docs_lookup`. */
export interface DocsResult {
  ok: boolean;
  library: string;
  libraryId?: string;
  snippets: string;
  note?: string;
  retrievedAt: string;
  sourceUrl: string;
}

function context7Headers(): Record<string, string> {
  return docsConfig.apiKey ? { authorization: `Bearer ${docsConfig.apiKey}` } : {};
}

/** Build the Context7 docs URL for a resolved library id (`/org/project`). Pure. */
export function buildDocsUrl(libraryId: string, topic: string): string {
  const id = libraryId.startsWith("/") ? libraryId : `/${libraryId}`;
  const params = new URLSearchParams({ type: "txt", tokens: "4000" });
  if (topic) params.set("topic", topic);
  return `${docsConfig.base}${id}?${params.toString()}`;
}

async function resolveLibraryId(name: string, signal?: AbortSignal): Promise<string | undefined> {
  try {
    const url = `${docsConfig.base}/search?query=${encodeURIComponent(name)}`;
    const res = await fetch(url, {
      signal: signal ?? AbortSignal.timeout(docsConfig.timeoutMs),
      headers: context7Headers(),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { results?: Array<{ id?: string }> };
    return data.results?.[0]?.id;
  } catch {
    return undefined;
  }
}

/** Look up current docs for a library via Context7. Best-effort: never throws. */
export async function lookupDocs(library: string, topic: string, signal?: AbortSignal): Promise<DocsResult> {
  const retrievedAt = new Date().toISOString();
  const resolved = await resolveLibraryId(library, signal);
  const id = resolved ?? (library.startsWith("/") ? library : undefined);
  const sourceUrl = id
    ? `https://context7.com${id.startsWith("/") ? id : `/${id}`}`
    : `https://context7.com/?q=${encodeURIComponent(library)}`;
  if (!id) {
    return {
      ok: false,
      library,
      snippets: "",
      note: `No Context7 library matched "${library}" — try the exact package name.`,
      retrievedAt,
      sourceUrl,
    };
  }
  try {
    const res = await fetch(buildDocsUrl(id, topic), {
      signal: signal ?? AbortSignal.timeout(docsConfig.timeoutMs),
      headers: context7Headers(),
    });
    if (res.status === 429) {
      return {
        ok: false,
        library,
        libraryId: id,
        snippets: "",
        note: "Context7 rate limit/quota reached — best-effort docs unavailable; set CONTEXT7_API_KEY to lift limits.",
        retrievedAt,
        sourceUrl,
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        library,
        libraryId: id,
        snippets: "",
        note: `Context7 returned ${res.status}.`,
        retrievedAt,
        sourceUrl,
      };
    }
    const snippets = (await res.text()).trim();
    if (!snippets) {
      return {
        ok: false,
        library,
        libraryId: id,
        snippets: "",
        note: "Context7 returned no snippets.",
        retrievedAt,
        sourceUrl,
      };
    }
    return { ok: true, library, libraryId: id, snippets, retrievedAt, sourceUrl };
  } catch (e) {
    return {
      ok: false,
      library,
      libraryId: id,
      snippets: "",
      note: `Context7 lookup failed: ${e instanceof Error ? e.message : String(e)}`,
      retrievedAt,
      sourceUrl,
    };
  }
}
