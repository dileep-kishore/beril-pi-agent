/**
 * Literature HTTP client: PubMed (NCBI E-utilities), ported from
 * `beril_cli/lit_client.py`. The pure normalizer/param-builders carry the
 * testable logic; the network functions are kept thin and use Node's global
 * `fetch`. Field mapping is byte-for-byte the same as the Python original.
 */

const EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const HTTP_TIMEOUT_MS = 30_000;

/**
 * Runtime knobs for the NCBI client. NCBI allows ~3 req/s anonymously and ~10
 * req/s with an API key; the co-scientist fans out many searches at once (and
 * each search is two requests: esearch → esummary), so every call is serialized
 * through a shared minimum-interval gate and 429/5xx are retried with backoff.
 * Set `NCBI_API_KEY` (and optionally `NCBI_EMAIL`) to lift the rate ceiling.
 * Mutable so tests can disable spacing/retries; the network functions read it live.
 */
const NCBI_API_KEY = process.env.NCBI_API_KEY?.trim() || undefined;
export const litConfig = {
  apiKey: NCBI_API_KEY,
  tool: process.env.NCBI_TOOL?.trim() || "beril",
  email: process.env.NCBI_EMAIL?.trim() || undefined,
  /** Minimum spacing between requests: ~9/s with a key, ~3/s without. */
  minIntervalMs: NCBI_API_KEY ? 110 : 350,
  /** Retries for 429/5xx before giving up. */
  maxRetries: 4,
  /** Base for exponential backoff (doubled each attempt) when no Retry-After header. */
  baseBackoffMs: 800,
};

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

// The next time a request may fire, shared across all concurrent callers. The
// read-modify-write below is atomic (no await between), so each caller reserves a
// distinct, increasing slot — turning a parallel burst into a paced stream.
let nextSlot = 0;
async function acquireSlot(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + litConfig.minIntervalMs;
  await sleep(wait);
}

/** A normalized, minimal citation record (matches the Python esummary normalizer). */
export interface LitRecord {
  pmid?: string;
  title?: string;
  journal?: string;
  year?: string;
  authors?: string[];
}

interface RawAuthor {
  name?: string;
}
interface RawSummary {
  uid?: string | number;
  title?: string;
  fulljournalname?: string;
  pubdate?: string;
  authors?: RawAuthor[];
}

// ── pure helpers (unit-tested) ───────────────────────────

/** Normalize one NCBI esummary record into a stable, minimal shape. */
export function normalizePubmedSummary(raw: RawSummary): LitRecord {
  const pubdate = String(raw.pubdate ?? "");
  const year = pubdate ? pubdate.split(/\s+/)[0] : "";
  const authors = Array.isArray(raw.authors)
    ? raw.authors.filter((a): a is RawAuthor & { name: string } => Boolean(a?.name)).map((a) => a.name)
    : [];
  return {
    pmid: String(raw.uid ?? ""),
    title: raw.title ?? "",
    journal: raw.fulljournalname ?? "",
    year,
    authors,
  };
}

/** Build query params for the E-utilities esearch endpoint. */
export function buildEsearchParams(query: string, retmax: number) {
  return { db: "pubmed", term: query, retmax, retmode: "json" };
}

/** Build query params for the E-utilities esummary endpoint. */
export function buildEsummaryParams(pmids: string[]) {
  return { db: "pubmed", id: pmids.join(","), retmode: "json" };
}

// ── network functions (thin) ─────────────────────────────

function toUrl(endpoint: string, params: Record<string, string | number>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) search.set(key, String(value));
  // NCBI etiquette + the rate-limit lift: identify the tool and attach the key.
  if (litConfig.tool) search.set("tool", litConfig.tool);
  if (litConfig.email) search.set("email", litConfig.email);
  if (litConfig.apiKey) search.set("api_key", litConfig.apiKey);
  return `${EUTILS_BASE}/${endpoint}?${search.toString()}`;
}

async function getJson(url: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  for (let attempt = 0; ; attempt++) {
    await acquireSlot();
    const res = await fetch(url, { signal: signal ?? AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    if (res.ok) return (await res.json()) as Record<string, unknown>;
    // 429 (rate limited) and 5xx (transient) are retried with backoff; everything
    // else — and a final exhausted retry — surfaces as a clear error, matching the
    // Python original's raise_for_status() rather than silently degrading.
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < litConfig.maxRetries) {
      const retryAfter = Number(res.headers?.get?.("retry-after"));
      const delay =
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : litConfig.baseBackoffMs * 2 ** attempt;
      await sleep(delay);
      continue;
    }
    throw new Error(`NCBI request failed: ${res.status} ${res.statusText}`);
  }
}

/** Search PubMed and return normalized summary records (esearch → esummary). */
export async function searchPubmed(query: string, max = 20, signal?: AbortSignal): Promise<LitRecord[]> {
  const search = await getJson(toUrl("esearch.fcgi", buildEsearchParams(query, max)), signal);
  const pmids = ((search.esearchresult as { idlist?: string[] } | undefined)?.idlist ?? []) as string[];
  if (pmids.length === 0) return [];
  const summary = await getJson(toUrl("esummary.fcgi", buildEsummaryParams(pmids)), signal);
  const result = (summary.result ?? {}) as Record<string, RawSummary>;
  return pmids.filter((pmid) => pmid in result).map((pmid) => normalizePubmedSummary(result[pmid]));
}

/** Fetch a single PubMed record by PMID and return its normalized summary. */
export async function fetchArticle(pmid: string, signal?: AbortSignal): Promise<LitRecord> {
  const summary = await getJson(toUrl("esummary.fcgi", buildEsummaryParams([pmid])), signal);
  const result = (summary.result ?? {}) as Record<string, RawSummary>;
  if (!(pmid in result)) throw new Error(`no PubMed record for PMID ${pmid}`);
  return normalizePubmedSummary(result[pmid]);
}

/** Build query params for the E-utilities efetch endpoint (abstract text). */
export function buildEfetchParams(pmid: string) {
  return { db: "pubmed", id: pmid, rettype: "abstract", retmode: "text" };
}

async function getText(url: string, signal?: AbortSignal): Promise<string> {
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
    throw new Error(`NCBI request failed: ${res.status} ${res.statusText}`);
  }
}

/** Fetch the abstract text for a PMID (empty string if none). */
export async function fetchAbstract(pmid: string, signal?: AbortSignal): Promise<string> {
  return (await getText(toUrl("efetch.fcgi", buildEfetchParams(pmid)), signal)).trim();
}
