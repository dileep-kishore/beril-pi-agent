"""Tests for the pure helpers in `beril_cli.lit_client` (no network)."""

from __future__ import annotations

from beril_cli.lit_client import (
    EUTILS_BASE,
    build_esearch_params,
    build_esummary_params,
    normalize_pubmed_summary,
)


def test_normalize_pubmed():
    raw = {
        "uid": "123",
        "title": "X",
        "fulljournalname": "J",
        "pubdate": "2024",
        "authors": [{"name": "Doe J"}],
    }
    rec = normalize_pubmed_summary(raw)
    assert rec == {
        "pmid": "123",
        "title": "X",
        "journal": "J",
        "year": "2024",
        "authors": ["Doe J"],
    }


def test_normalize_pubmed_handles_missing_fields():
    raw = {"uid": "7"}
    rec = normalize_pubmed_summary(raw)
    assert rec == {"pmid": "7", "title": "", "journal": "", "year": "", "authors": []}


def test_normalize_pubmed_year_from_pubdate_prefix():
    # E-utilities pubdate is often "2024 Mar 15"; we keep only the leading year.
    raw = {"uid": "9", "pubdate": "2024 Mar 15"}
    assert normalize_pubmed_summary(raw)["year"] == "2024"


def test_normalize_pubmed_skips_author_entries_without_name():
    raw = {"uid": "1", "authors": [{"name": "Doe J"}, {"foo": "bar"}, {"name": "Roe A"}]}
    assert normalize_pubmed_summary(raw)["authors"] == ["Doe J", "Roe A"]


def test_build_esearch_params():
    params = build_esearch_params("metals AND bacteria", retmax=5)
    assert params["db"] == "pubmed"
    assert params["term"] == "metals AND bacteria"
    assert params["retmax"] == 5
    assert params["retmode"] == "json"


def test_build_esummary_params():
    params = build_esummary_params(["123", "456"])
    assert params["db"] == "pubmed"
    assert params["id"] == "123,456"
    assert params["retmode"] == "json"


def test_eutils_base_is_ncbi():
    assert EUTILS_BASE.startswith("https://eutils.ncbi.nlm.nih.gov/entrez/eutils")
