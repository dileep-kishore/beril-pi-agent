/**
 * Literature HTTP client: Europe PMC (EBI RESTful web service). A free, keyless,
 * no-registration sibling to the PubMed client in `lib/lit.ts` — it adds
 * open-access full text + DOIs and non-PubMed sources (preprints) without an API
 * key. It shares the SAME minimum-interval gate (`acquireSlot`/`sleep` from
 * lit.ts) so a fan-out across both sources stays one paced stream rather than two.
 * The pure normalizer/param-builder carry the testable logic; the network
 * functions are thin and use Node's global `fetch`.
 */

import { type LitRecord, acquireSlot, litConfig, sleep } from "./lit.ts";

const EPMC_BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest";
const HTTP_TIMEOUT_MS = 30_000;

interface RawEpmcResult {
  id?: string;
  source?: string;
  pmid?: string;
  doi?: string;
  title?: string;
  authorString?: string;
  pubYear?: string;
  journalInfo?: { journal?: { title?: string } };
  abstractText?: string;
  isOpenAccess?: string;
}

interface RawEpmcSearch {
  resultList?: { result?: RawEpmcResult[] };
}

// ── pure helpers (unit-tested) ───────────────────────────

/** Normalize one Europe PMC core result into the shared LitRecord shape. */
export function normalizeEpmcResult(raw: RawEpmcResult): LitRecord {
  // Europe PMC returns `authorString` as one string ("Smith J, Doe A.") rather
  // than the array NCBI gives; split, trim, and drop a trailing period.
  const authors = (raw.authorString ?? "")
    .split(/,\s*/)
    .map((s) => s.trim().replace(/\.$/, ""))
    .filter(Boolean);
  return {
    // Books/preprints have no PMID — leave it "" (not the Europe PMC id).
    pmid: raw.pmid ? String(raw.pmid) : "",
    doi: raw.doi ? String(raw.doi) : undefined,
    title: raw.title ?? "",
    journal: raw.journalInfo?.journal?.title ?? "",
    year: raw.pubYear ? String(raw.pubYear) : "",
    authors,
  };
}

/** Build query params for the Europe PMC search endpoint (core records carry abstract/DOI/OA). */
export function buildEpmcSearchParams(query: string, pageSize: number) {
  return { query, format: "json", resultType: "core", pageSize };
}

// ── network functions (thin) ─────────────────────────────

function epmcUrl(endpoint: string, params: Record<string, string | number>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) search.set(key, String(value));
  // Europe PMC is keyless — no tool/email/api_key etiquette params (the sole toUrl divergence from lit.ts).
  return `${EPMC_BASE}/${endpoint}?${search.toString()}`;
}

async function epmcGetJson(url: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  for (let attempt = 0; ; attempt++) {
    await acquireSlot();
    const res = await fetch(url, { signal: signal ?? AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    if (res.ok) return (await res.json()) as Record<string, unknown>;
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < litConfig.maxRetries) {
      const retryAfter = Number(res.headers?.get?.("retry-after"));
      const delay =
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : litConfig.baseBackoffMs * 2 ** attempt;
      await sleep(delay);
      continue;
    }
    throw new Error(`Europe PMC request failed: ${res.status} ${res.statusText}`);
  }
}

async function epmcGetText(url: string, signal?: AbortSignal): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    await acquireSlot();
    const res = await fetch(url, { signal: signal ?? AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    if (res.ok) return await res.text();
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < litConfig.maxRetries) {
      const retryAfter = Number(res.headers?.get?.("retry-after"));
      const delay =
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : litConfig.baseBackoffMs * 2 ** attempt;
      await sleep(delay);
      continue;
    }
    throw new Error(`Europe PMC request failed: ${res.status} ${res.statusText}`);
  }
}

/** Search Europe PMC and return normalized records (single GET — core records arrive inline). */
export async function searchEuropePmc(query: string, max = 20, signal?: AbortSignal): Promise<LitRecord[]> {
  const data = (await epmcGetJson(epmcUrl("search", buildEpmcSearchParams(query, max)), signal)) as RawEpmcSearch;
  const results = data.resultList?.result ?? [];
  return results.map(normalizeEpmcResult);
}

/**
 * Fetch open-access full text (raw XML) for a Europe PMC record. `source` is the
 * corpus tag ("MED" for PubMed-indexed, "PMC", "PPR" for preprints); `id` is the
 * Europe PMC id. Only open-access items have full text — callers should
 * `.catch(() => "")`.
 */
export async function fetchEuropePmcFullText(source: string, id: string, signal?: AbortSignal): Promise<string> {
  return (await epmcGetText(`${EPMC_BASE}/${source}/${id}/fullTextXML`, signal)).trim();
}
