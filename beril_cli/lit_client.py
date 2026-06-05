"""Literature HTTP client: PubMed (NCBI E-utilities) + Semantic Scholar.

Network functions are kept thin; the pure normalizers/param-builders carry the
testable logic and are unit-tested without touching the network.
"""

from __future__ import annotations

from typing import Any

import httpx

EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
SEMANTIC_SCHOLAR_BASE = "https://api.semanticscholar.org/graph/v1"
HTTP_TIMEOUT = 30.0


# ── pure helpers (unit-tested) ───────────────────────────


def normalize_pubmed_summary(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize one NCBI esummary record into a stable, minimal shape."""
    pubdate = str(raw.get("pubdate", "") or "")
    year = pubdate.split()[0] if pubdate else ""
    authors = [a["name"] for a in raw.get("authors", []) if isinstance(a, dict) and a.get("name")]
    return {
        "pmid": str(raw.get("uid", "") or ""),
        "title": raw.get("title", "") or "",
        "journal": raw.get("fulljournalname", "") or "",
        "year": year,
        "authors": authors,
    }


def build_esearch_params(query: str, retmax: int) -> dict[str, Any]:
    """Build query params for the E-utilities esearch endpoint."""
    return {"db": "pubmed", "term": query, "retmax": retmax, "retmode": "json"}


def build_esummary_params(pmids: list[str]) -> dict[str, Any]:
    """Build query params for the E-utilities esummary endpoint."""
    return {"db": "pubmed", "id": ",".join(pmids), "retmode": "json"}


# ── network functions (thin) ─────────────────────────────


def search_pubmed(query: str, retmax: int = 20) -> list[dict[str, Any]]:
    """Search PubMed and return normalized summary records (esearch → esummary)."""
    with httpx.Client(timeout=HTTP_TIMEOUT) as client:
        search = client.get(
            f"{EUTILS_BASE}/esearch.fcgi", params=build_esearch_params(query, retmax)
        )
        search.raise_for_status()
        pmids = search.json().get("esearchresult", {}).get("idlist", [])
        if not pmids:
            return []
        summary = client.get(
            f"{EUTILS_BASE}/esummary.fcgi", params=build_esummary_params(pmids)
        )
        summary.raise_for_status()
        result = summary.json().get("result", {})
    return [normalize_pubmed_summary(result[pmid]) for pmid in pmids if pmid in result]


def fetch_article(pmid: str) -> dict[str, Any]:
    """Fetch a single PubMed record by PMID and return its normalized summary."""
    with httpx.Client(timeout=HTTP_TIMEOUT) as client:
        summary = client.get(
            f"{EUTILS_BASE}/esummary.fcgi", params=build_esummary_params([pmid])
        )
        summary.raise_for_status()
        result = summary.json().get("result", {})
    if pmid not in result:
        raise ValueError(f"no PubMed record for PMID {pmid}")
    return normalize_pubmed_summary(result[pmid])
