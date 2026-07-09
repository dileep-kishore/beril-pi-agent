"""Tests for `beril commons` — land / dedup / query / from-report extraction."""

from __future__ import annotations

import argparse
import json

from beril_cli import commons, commons_cmd


def _ns(**kw) -> argparse.Namespace:
    base = {
        "verb": None,
        "project": None,
        "kind": None,
        "text": None,
        "tag": None,
        "from_report": False,
        "q": None,
        "k": 5,
        "filter_project": None,
    }
    base.update(kw)
    return argparse.Namespace(**base)


def _use_tmp_store(monkeypatch, tmp_path):
    monkeypatch.setenv("BERIL_COMMONS_DIR", str(tmp_path / "agora"))
    # No orcid stamped in tests.
    monkeypatch.setattr(commons_cmd.config, "load", lambda: {})


# ── land + dedup ─────────────────────────────────────────


def test_land_single_entry(monkeypatch, capsys, tmp_path):
    _use_tmp_store(monkeypatch, tmp_path)
    rc = commons_cmd.run_commons(_ns(verb="land", project="demo", kind="finding", text="A real finding"))
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and out == {"landed": 1, "skipped_duplicates": 0, "by_kind": {"finding": 1}}


def test_land_dedup_by_sha(monkeypatch, capsys, tmp_path):
    _use_tmp_store(monkeypatch, tmp_path)
    commons_cmd.run_commons(_ns(verb="land", project="demo", kind="finding", text="dup"))
    capsys.readouterr()
    rc = commons_cmd.run_commons(_ns(verb="land", project="demo", kind="finding", text="dup"))
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and out["landed"] == 0 and out["skipped_duplicates"] == 1


def test_private_record_never_lands(tmp_path):
    root = tmp_path / "agora"
    record = commons.make_record("finding", "x", project="demo")
    record["visibility"] = "private"
    assert commons.land(root, record) is False
    assert not (root / "index.jsonl").exists()


# ── query ────────────────────────────────────────────────


def test_query_empty_store_is_novel(monkeypatch, capsys, tmp_path):
    _use_tmp_store(monkeypatch, tmp_path)
    rc = commons_cmd.run_commons(_ns(verb="query", q="anything"))
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and out == {"verdict": "novel", "matches": []}


def test_query_overlap_on_repeat(monkeypatch, capsys, tmp_path):
    _use_tmp_store(monkeypatch, tmp_path)
    commons_cmd.run_commons(_ns(verb="land", project="demo", kind="finding", text="nitrogen limitation slows growth"))
    capsys.readouterr()
    rc = commons_cmd.run_commons(_ns(verb="query", q="nitrogen limitation slows growth"))
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and out["verdict"] == "overlap"
    assert out["matches"][0]["kind"] == "finding"


def test_query_novel_on_unrelated_text(monkeypatch, capsys, tmp_path):
    _use_tmp_store(monkeypatch, tmp_path)
    commons_cmd.run_commons(_ns(verb="land", project="demo", kind="finding", text="nitrogen limitation slows growth"))
    capsys.readouterr()
    commons_cmd.run_commons(_ns(verb="query", q="quantum chromodynamics lattice"))
    out = json.loads(capsys.readouterr().out)
    assert out["verdict"] == "novel"


# ── list ─────────────────────────────────────────────────


def test_list_filters_by_project_and_kind(monkeypatch, capsys, tmp_path):
    _use_tmp_store(monkeypatch, tmp_path)
    commons_cmd.run_commons(_ns(verb="land", project="p1", kind="finding", text="f1"))
    commons_cmd.run_commons(_ns(verb="land", project="p2", kind="gap", text="g1"))
    capsys.readouterr()
    rc = commons_cmd.run_commons(_ns(verb="list", filter_project="p2"))
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and len(out["records"]) == 1 and out["records"][0]["project"] == "p2"


# ── from-report extraction ───────────────────────────────


def _project(tmp_path, name="demo"):
    repo = tmp_path / "repo"
    (repo / "projects" / name).mkdir(parents=True)
    (repo / "PROJECT.md").write_text("x")
    return repo, repo / "projects" / name


def test_from_report_extracts_findings_gaps_lessons(monkeypatch, capsys, tmp_path):
    monkeypatch.setenv("BERIL_COMMONS_DIR", str(tmp_path / "agora"))
    monkeypatch.setattr(commons_cmd.config, "load", lambda: {})
    repo, pdir = _project(tmp_path)
    monkeypatch.setattr(commons_cmd, "find_repo_root", lambda: repo)
    (pdir / "REPORT.md").write_text(
        "# Report\n\n## Findings\n\n- Finding one\n- Finding two\n\n"
        "## Open questions\n\n- What about pH?\n"
    )
    (pdir / "REFUTATION_1.md").write_text("# Refute\n\n## Surviving\n\n- effect holds under reshuffle\n")
    (pdir / "REFUTATION_2.md").write_text("# Refute\n\n- SURVIVES: dose response monotonic\n")
    rc = commons_cmd.run_commons(_ns(verb="land", project="demo", from_report=True))
    out = json.loads(capsys.readouterr().out)
    assert rc == 0
    assert out["by_kind"].get("finding") == 2
    assert out["by_kind"].get("gap") == 1
    # newest refutation (REFUTATION_2) provides the lesson
    assert out["by_kind"].get("lesson") == 1


def test_from_report_treats_future_directions_as_gaps(monkeypatch, capsys, tmp_path):
    monkeypatch.setenv("BERIL_COMMONS_DIR", str(tmp_path / "agora"))
    monkeypatch.setattr(commons_cmd.config, "load", lambda: {})
    repo, pdir = _project(tmp_path)
    monkeypatch.setattr(commons_cmd, "find_repo_root", lambda: repo)
    (pdir / "REPORT.md").write_text(
        "# Report\n\n## Findings\n\n- Finding one\n\n"
        "## Future Directions\n\n- Test this signal in marine genomes.\n"
    )
    rc = commons_cmd.run_commons(_ns(verb="land", project="demo", from_report=True))
    out = json.loads(capsys.readouterr().out)
    assert rc == 0
    assert out["by_kind"].get("finding") == 1
    assert out["by_kind"].get("gap") == 1


def test_from_report_falls_back_to_supported_claims(monkeypatch, capsys, tmp_path):
    monkeypatch.setenv("BERIL_COMMONS_DIR", str(tmp_path / "agora"))
    monkeypatch.setattr(commons_cmd.config, "load", lambda: {})
    repo, pdir = _project(tmp_path)
    monkeypatch.setattr(commons_cmd, "find_repo_root", lambda: repo)
    (pdir / "REPORT.md").write_text("# Report\n\nNo findings section here.\n")
    (pdir / "claims.json").write_text(
        json.dumps({"rows": [
            {"claim_id": "c1", "claim": "Gene X upregulated", "status": "supported"},
            {"claim_id": "c2", "claim": "Gene Y unchanged", "status": "refuted"},
        ]})
    )
    rc = commons_cmd.run_commons(_ns(verb="land", project="demo", from_report=True))
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and out["by_kind"].get("finding") == 1
