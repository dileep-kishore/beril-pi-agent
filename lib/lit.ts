/**
 * Literature HTTP client: PubMed (NCBI E-utilities), ported from
 * `beril_cli/lit_client.py`. The pure normalizer/param-builders carry the
 * testable logic; the network functions are kept thin and use Node's global
 * `fetch`. Field mapping is byte-for-byte the same as the Python original.
 */

const EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const HTTP_TIMEOUT_MS = 30_000;

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
  return `${EUTILS_BASE}/${endpoint}?${search.toString()}`;
}

async function getJson(url: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const res = await fetch(url, { signal: signal ?? AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  // Parity with the Python original's raise_for_status(): surface NCBI 429/5xx
  // as a clear error rather than silently degrading to zero/garbled results.
  if (!res.ok) throw new Error(`NCBI request failed: ${res.status} ${res.statusText}`);
  return (await res.json()) as Record<string, unknown>;
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
