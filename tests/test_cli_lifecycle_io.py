"""Tests for beril.yaml IO + machine-enforced set_status in `beril_cli.lifecycle`."""

from __future__ import annotations

from pathlib import Path

import pytest

from beril_cli.lifecycle import LifecycleError, load_project, save_project, set_status


def write_yaml(d: Path, status: str = "active") -> None:
    (d / "beril.yaml").write_text(
        f"project_id: demo\nstatus: {status}\nbranch: projects/demo\nengine:\n  name: pi\n"
        'authors:\n  - name: "A"\n    affiliation: "LBL"\n    orcid: "0000-0001-0000-0000"\n'
        "artifacts:\n  readme: true\n  research_plan: true\n  report: false\n  review: false\n"
    )


def test_round_trip(tmp_path):
    write_yaml(tmp_path)
    proj = load_project(tmp_path)
    assert proj["status"] == "active" and proj["project_id"] == "demo"
    proj["status"] = "analysis"
    save_project(tmp_path, proj)
    assert load_project(tmp_path)["status"] == "analysis"


def test_set_status_enforces_machine(tmp_path):
    write_yaml(tmp_path, status="active")
    set_status(tmp_path, "analysis")  # legal
    assert load_project(tmp_path)["status"] == "analysis"
    with pytest.raises(LifecycleError):
        set_status(tmp_path, "complete")  # illegal from analysis
    # The illegal transition must not have persisted.
    assert load_project(tmp_path)["status"] == "analysis"


def test_load_missing_raises(tmp_path):
    with pytest.raises(LifecycleError):
        load_project(tmp_path)


def test_save_preserves_canonical_key_order(tmp_path):
    # Provide keys out of order plus an unknown extra; canonical keys come first,
    # extras appended in insertion order.
    proj = {
        "submissions": [],
        "status": "active",
        "extra_note": "keep me",
        "project_id": "demo",
        "engine": {"name": "pi"},
    }
    save_project(tmp_path, proj)
    text = (tmp_path / "beril.yaml").read_text()
    # project_id before status before engine before submissions before extra_note
    order = [text.index(k) for k in ("project_id", "status", "engine", "submissions", "extra_note")]
    assert order == sorted(order)


def test_set_status_returns_new_status(tmp_path):
    write_yaml(tmp_path, status="active")
    assert set_status(tmp_path, "analysis") == "analysis"
