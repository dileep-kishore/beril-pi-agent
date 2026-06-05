"""Tests for `beril lit search|fetch` subcommand."""

from __future__ import annotations

import argparse
import json

import httpx
import pytest

from beril_cli import lit_cmd


def _ns(**kw) -> argparse.Namespace:
    base = {"action": None, "query": None, "max": 20, "pmid": None}
    base.update(kw)
    return argparse.Namespace(**base)


# ── search ───────────────────────────────────────────────


def test_search_emits_json_array(monkeypatch, capsys):
    records = [
        {"pmid": "1", "title": "A", "journal": "J", "year": "2024", "authors": ["Doe J"]},
        {"pmid": "2", "title": "B", "journal": "K", "year": "2023", "authors": []},
    ]
    monkeypatch.setattr(lit_cmd, "search_pubmed", lambda q, retmax: records)
    rc = lit_cmd.run_lit(_ns(action="search", query="metals", max=20))
    out = json.loads(capsys.readouterr().out)
    assert rc == 0
    assert isinstance(out, list) and len(out) == 2 and out[0]["pmid"] == "1"


def test_search_passes_max(monkeypatch, capsys):
    seen = {}

    def fake_search(q, retmax):
        seen["q"] = q
        seen["retmax"] = retmax
        return []

    monkeypatch.setattr(lit_cmd, "search_pubmed", fake_search)
    lit_cmd.run_lit(_ns(action="search", query="x", max=5))
    assert seen == {"q": "x", "retmax": 5}


def test_search_missing_query_returns_2(monkeypatch, capsys):
    rc = lit_cmd.run_lit(_ns(action="search", query=None))
    assert rc == 2
    assert "query" in capsys.readouterr().err.lower()


def test_search_network_error_returns_1(monkeypatch, capsys):
    def boom(q, retmax):
        raise httpx.HTTPError("network down")

    monkeypatch.setattr(lit_cmd, "search_pubmed", boom)
    rc = lit_cmd.run_lit(_ns(action="search", query="x"))
    assert rc == 1
    assert "network down" in capsys.readouterr().err


# ── fetch ────────────────────────────────────────────────


def test_fetch_emits_json_object(monkeypatch, capsys):
    record = {"pmid": "123", "title": "X", "journal": "J", "year": "2024", "authors": ["Doe J"]}
    monkeypatch.setattr(lit_cmd, "fetch_article", lambda pmid: record)
    rc = lit_cmd.run_lit(_ns(action="fetch", pmid="123"))
    out = json.loads(capsys.readouterr().out)
    assert rc == 0
    assert isinstance(out, dict) and out["pmid"] == "123"


def test_fetch_missing_pmid_returns_2(monkeypatch, capsys):
    rc = lit_cmd.run_lit(_ns(action="fetch", pmid=None))
    assert rc == 2
    assert "pmid" in capsys.readouterr().err.lower()


def test_fetch_not_found_returns_1(monkeypatch, capsys):
    def boom(pmid):
        raise ValueError("no PubMed record for PMID 999")

    monkeypatch.setattr(lit_cmd, "fetch_article", boom)
    rc = lit_cmd.run_lit(_ns(action="fetch", pmid="999"))
    assert rc == 1
    assert "no PubMed record" in capsys.readouterr().err


def test_fetch_network_error_returns_1(monkeypatch, capsys):
    def boom(pmid):
        raise httpx.HTTPError("timeout")

    monkeypatch.setattr(lit_cmd, "fetch_article", boom)
    rc = lit_cmd.run_lit(_ns(action="fetch", pmid="1"))
    assert rc == 1
