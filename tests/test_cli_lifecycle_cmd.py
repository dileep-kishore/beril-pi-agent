"""Tests for `beril lifecycle` subcommand (status/set/approve/marker)."""

from __future__ import annotations

import argparse
import hashlib
import json

from beril_cli import lifecycle_cmd
from beril_cli.lifecycle import load_project


def _proj(tmp_path, status="analysis"):
    d = tmp_path / "projects" / "demo"
    d.mkdir(parents=True)
    (d / "beril.yaml").write_text(
        f"project_id: demo\nstatus: {status}\nengine:\n  name: pi\n"
    )
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


def test_set_bootstraps_exploration_for_new_project(monkeypatch, capsys, tmp_path):
    # A brand-new project dir (files written, but no beril.yaml yet): the first
    # `set ... proposed` must auto-create the state file at exploration, then transition.
    d = tmp_path / "projects" / "demo"
    d.mkdir(parents=True)
    (d / "RESEARCH_PLAN.md").write_text("# plan")
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    monkeypatch.setattr(lifecycle_cmd.config, "load", lambda: {})
    rc = lifecycle_cmd.run_lifecycle(_ns(action="set", state="proposed"))
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and out["status"] == "proposed"
    proj = load_project(d)
    assert proj["status"] == "proposed"
    assert proj["project_id"] == "demo"
    assert proj["engine"] == {"name": "pi"}


def test_set_bootstrap_includes_author_from_config(monkeypatch, capsys, tmp_path):
    d = tmp_path / "projects" / "demo"
    d.mkdir(parents=True)
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    monkeypatch.setattr(
        lifecycle_cmd.config,
        "load",
        lambda: {
            "user": {"name": "A", "affiliation": "LBL", "orcid": "0000-0001-0000-0000"}
        },
    )
    rc = lifecycle_cmd.run_lifecycle(_ns(action="set", state="proposed"))
    assert rc == 0
    proj = load_project(d)
    assert proj["authors"] == [
        {"name": "A", "affiliation": "LBL", "orcid": "0000-0001-0000-0000"}
    ]


def test_set_bootstrap_rejects_illegal_first_transition(monkeypatch, capsys, tmp_path):
    # A fresh project bootstraps to exploration; skipping straight to active is illegal.
    d = tmp_path / "projects" / "demo"
    d.mkdir(parents=True)
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    monkeypatch.setattr(lifecycle_cmd.config, "load", lambda: {})
    rc = lifecycle_cmd.run_lifecycle(_ns(action="set", state="active"))
    assert rc == 2
    assert "illegal" in capsys.readouterr().err.lower()


def test_set_on_missing_project_dir_returns_2(monkeypatch, capsys, tmp_path):
    # No directory at all (e.g. a typo'd project name) → clear error, no silent creation.
    (tmp_path / "projects").mkdir()
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(
        _ns(action="set", state="proposed", project="nope")
    )
    assert rc == 2
    assert not (tmp_path / "projects" / "nope").exists()


def test_set_demote_is_legal(monkeypatch, capsys, tmp_path):
    d = _proj(tmp_path, "reviewed")
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(_ns(action="set", state="analysis"))
    assert rc == 0
    assert load_project(d)["status"] == "analysis"


def test_set_active_to_analysis_requires_report_and_claims(monkeypatch, capsys, tmp_path):
    d = _proj(tmp_path, "active")
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(_ns(action="set", state="analysis"))
    assert rc == 2
    assert "REPORT.md" in capsys.readouterr().err
    assert load_project(d)["status"] == "active"


def test_set_active_to_analysis_accepts_valid_report_and_claims(monkeypatch, capsys, tmp_path):
    d = _proj(tmp_path, "active")
    (d / "REPORT.md").write_text("# Report\n\n## Key Findings\n\n### Finding 1\n")
    (d / "claims.json").write_text(
        json.dumps(
            {
                "project": "demo",
                "rows": [
                    {
                        "claim_id": "h1",
                        "claim": "Finding 1",
                        "status": "supported",
                        "confidence": "medium",
                        "supports": [{"locator": "notebooks/01.ipynb"}],
                        "refutes": [],
                    }
                ],
            }
        )
    )
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(_ns(action="set", state="analysis"))
    assert rc == 0
    assert load_project(d)["status"] == "analysis"


# ── approve ──────────────────────────────────────────────


def test_approve_writes_block_in_key_order(monkeypatch, capsys, tmp_path):
    d = _proj(tmp_path, "reviewed")
    report_hash = _write_reviewed_report(d)
    review_hash = _write_review(d, report_hash)
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(
        _ns(
            action="approve",
            orcid="0000-0001-2345-6789",
            report_hash=report_hash,
            review="projects/demo/REVIEW_1.md",
            review_hash=review_hash,
        )
    )
    assert rc == 0
    proj = load_project(d)
    approval = proj["approval"]
    assert list(approval.keys()) == ["by", "at", "report_hash", "review", "review_hash"]
    assert approval["by"] == "0000-0001-2345-6789"
    assert approval["report_hash"].startswith("sha256:")
    assert approval["review"] == "projects/demo/REVIEW_1.md"


def test_approve_rejects_stale_review_hash(monkeypatch, capsys, tmp_path):
    d = _proj(tmp_path, "reviewed")
    report_hash = _write_reviewed_report(d)
    _write_review(d, report_hash)
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(
        _ns(
            action="approve",
            orcid="0000-0001-2345-6789",
            report_hash=report_hash,
            review="projects/demo/REVIEW_1.md",
            review_hash="sha256:" + "0" * 64,
        )
    )
    assert rc == 2
    assert "review_hash" in capsys.readouterr().err


def _sha(path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def _write_reviewed_report(project_dir) -> str:
    report = project_dir / "REPORT.md"
    report.write_text("# Report\n\n## Key Findings\n\n- supported\n")
    return _sha(report)


def _write_review(project_dir, report_hash: str) -> str:
    review = project_dir / "REVIEW_1.md"
    review.write_text(f"# Review\n\nLooks ready.\n\n<!-- report_hash: {report_hash} -->\n")
    return _sha(review)


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


# ── current ──────────────────────────────────────────────


def _make(tmp_path, name, status, mtime):
    import os

    d = tmp_path / "projects" / name
    d.mkdir(parents=True)
    y = d / "beril.yaml"
    y.write_text(f"project_id: {name}\nstatus: {status}\n")
    os.utime(y, (mtime, mtime))
    return y


def test_current_picks_most_recent_non_complete(monkeypatch, capsys, tmp_path):
    _make(tmp_path, "old", "active", 1000)
    _make(tmp_path, "newest", "analysis", 3000)
    _make(tmp_path, "done", "complete", 5000)  # most recent but finished → skipped
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(_ns(action="current", project=None))
    assert rc == 0
    assert json.loads(capsys.readouterr().out) == {
        "project": "newest",
        "status": "analysis",
    }


def test_current_empty_when_all_complete(monkeypatch, capsys, tmp_path):
    _make(tmp_path, "a", "complete", 1000)
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(_ns(action="current", project=None))
    assert rc == 0 and json.loads(capsys.readouterr().out) == {}


def test_current_empty_when_no_projects(monkeypatch, capsys, tmp_path):
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(_ns(action="current", project=None))
    assert rc == 0 and json.loads(capsys.readouterr().out) == {}
