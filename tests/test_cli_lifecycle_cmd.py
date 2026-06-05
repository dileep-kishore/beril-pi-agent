"""Tests for `beril lifecycle` subcommand (status/set/approve/marker)."""

from __future__ import annotations

import argparse
import json

from beril_cli import lifecycle_cmd
from beril_cli.lifecycle import load_project


def _proj(tmp_path, status="analysis"):
    d = tmp_path / "projects" / "demo"
    d.mkdir(parents=True)
    (d / "beril.yaml").write_text(f"project_id: demo\nstatus: {status}\nengine:\n  name: pi\n")
    return d


def _ns(**kw) -> argparse.Namespace:
    base = {
        "action": None,
        "project": "demo",
        "state": None,
        "orcid": None,
        "report_hash": None,
        "review": None,
        "review_hash": None,
        "kind": None,
    }
    base.update(kw)
    return argparse.Namespace(**base)


# ── status ───────────────────────────────────────────────


def test_status_emits_yaml_as_json(monkeypatch, capsys, tmp_path):
    _proj(tmp_path, "active")
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(_ns(action="status"))
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and out["status"] == "active" and out["project_id"] == "demo"


# ── set ──────────────────────────────────────────────────


def test_set_emits_new_status(monkeypatch, capsys, tmp_path):
    d = _proj(tmp_path, "analysis")
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(_ns(action="set", state="reviewed"))
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and out["status"] == "reviewed"
    assert load_project(d)["status"] == "reviewed"


def test_illegal_set_returns_2(monkeypatch, capsys, tmp_path):
    d = _proj(tmp_path, "analysis")
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(_ns(action="set", state="complete"))
    assert rc == 2  # LifecycleError → usage error
    assert "illegal" in capsys.readouterr().err.lower()
    # State must be unchanged.
    assert load_project(d)["status"] == "analysis"


def test_set_demote_is_legal(monkeypatch, capsys, tmp_path):
    d = _proj(tmp_path, "reviewed")
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(_ns(action="set", state="analysis"))
    assert rc == 0
    assert load_project(d)["status"] == "analysis"


# ── approve ──────────────────────────────────────────────


def test_approve_writes_block_in_key_order(monkeypatch, capsys, tmp_path):
    d = _proj(tmp_path, "reviewed")
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(
        _ns(
            action="approve",
            orcid="0000-0001-2345-6789",
            report_hash="sha256:" + "a" * 64,
            review="projects/demo/REVIEW_1.md",
            review_hash="sha256:" + "b" * 64,
        )
    )
    assert rc == 0
    proj = load_project(d)
    approval = proj["approval"]
    assert list(approval.keys()) == ["by", "at", "report_hash", "review", "review_hash"]
    assert approval["by"] == "0000-0001-2345-6789"
    assert approval["report_hash"].startswith("sha256:")
    assert approval["review"] == "projects/demo/REVIEW_1.md"


# ── marker ───────────────────────────────────────────────


def test_marker_submitted_writes_file(monkeypatch, capsys, tmp_path):
    d = _proj(tmp_path, "reviewed")
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(_ns(action="marker", kind="submitted"))
    assert rc == 0
    assert (d / "SUBMITTED.md").exists()


def test_marker_failed_writes_file(monkeypatch, capsys, tmp_path):
    d = _proj(tmp_path, "reviewed")
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(_ns(action="marker", kind="failed"))
    assert rc == 0
    assert (d / "SUBMISSION_FAILED.md").exists()


# ── error paths ──────────────────────────────────────────


def test_no_repo_returns_2(monkeypatch, capsys):
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: None)
    rc = lifecycle_cmd.run_lifecycle(_ns(action="status"))
    assert rc == 2
    assert "BERIL repo not found" in capsys.readouterr().err


def test_missing_project_returns_2(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(_ns(action="status", project="nope"))
    assert rc == 2
    assert "beril.yaml" in capsys.readouterr().err


def test_set_without_state_returns_2(monkeypatch, capsys, tmp_path):
    _proj(tmp_path, "analysis")
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(_ns(action="set", state=None))
    assert rc == 2
