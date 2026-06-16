"""Tests for `beril lifecycle session-state` (cross-session memory persistence)."""

from __future__ import annotations

import argparse
import json

from beril_cli import lifecycle_cmd
from beril_cli.lifecycle import load_project


def _proj(tmp_path, status="analysis", extra=""):
    d = tmp_path / "projects" / "demo"
    d.mkdir(parents=True)
    (d / "beril.yaml").write_text(
        f"project_id: demo\nstatus: {status}\nengine:\n  name: pi\n{extra}"
    )
    return d


def _ns(**kw) -> argparse.Namespace:
    base = {
        "action": "session-state",
        "project": "demo",
        "state": None,
        "orcid": None,
        "report_hash": None,
        "review": None,
        "review_hash": None,
        "kind": None,
        "state_json": None,
        "get_state": False,
    }
    base.update(kw)
    return argparse.Namespace(**base)


# ── set / round-trip ─────────────────────────────────────


def test_set_writes_and_round_trips(monkeypatch, capsys, tmp_path):
    d = _proj(tmp_path)
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    block = {"project": "demo", "phase": "analysis", "step": "review", "claims": {"total": 2}}
    rc = lifecycle_cmd.run_lifecycle(_ns(state_json=json.dumps(block)))
    out = json.loads(capsys.readouterr().out)
    assert rc == 0
    assert out["research_state"]["phase"] == "analysis"
    # Server stamps updated_at — the client never supplies it.
    assert "updated_at" in out["research_state"]
    stored = load_project(d)["research_state"]
    assert stored["project"] == "demo" and stored["step"] == "review"
    assert stored["claims"] == {"total": 2}
    assert "updated_at" in stored


def test_set_lands_after_canonical_keys(monkeypatch, capsys, tmp_path):
    # research_state is a non-canonical key → it must appear AFTER the _KEY_ORDER
    # keys present on the project, and after any pre-existing approval block.
    d = _proj(
        tmp_path,
        status="reviewed",
        extra=(
            "approval:\n"
            "  by: '0000-0001-2345-6789'\n"
            "  at: '2026-06-13T00:00:00Z'\n"
        ),
    )
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(_ns(state_json=json.dumps({"project": "demo", "phase": "reviewed"})))
    assert rc == 0
    proj = load_project(d)
    keys = list(proj.keys())
    # The canonical prefix keys come first, then approval, then research_state last.
    assert keys.index("project_id") < keys.index("status") < keys.index("engine")
    assert keys.index("approval") < keys.index("research_state")
    assert keys[-1] == "research_state"
    # The pre-existing approval block survives untouched.
    assert proj["approval"]["by"] == "0000-0001-2345-6789"


# ── get ──────────────────────────────────────────────────


def test_get_emits_stored_block(monkeypatch, capsys, tmp_path):
    d = _proj(tmp_path)
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    lifecycle_cmd.run_lifecycle(_ns(state_json=json.dumps({"project": "demo", "phase": "analysis"})))
    capsys.readouterr()  # drain the set output
    rc = lifecycle_cmd.run_lifecycle(_ns(get_state=True))
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and out["project"] == "demo" and out["phase"] == "analysis"
    assert load_project(d)  # untouched by a read


def test_get_empty_when_unset(monkeypatch, capsys, tmp_path):
    _proj(tmp_path)
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(_ns(get_state=True))
    assert rc == 0 and json.loads(capsys.readouterr().out) == {}


# ── error paths ──────────────────────────────────────────


def test_set_invalid_json_returns_2(monkeypatch, capsys, tmp_path):
    _proj(tmp_path)
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(_ns(state_json="{not json"))
    assert rc == 2
    assert "invalid" in capsys.readouterr().err.lower()


def test_set_non_object_returns_2(monkeypatch, capsys, tmp_path):
    _proj(tmp_path)
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(_ns(state_json="[1, 2, 3]"))
    assert rc == 2
    assert "must be a json object" in capsys.readouterr().err.lower()


def test_set_without_set_or_get_returns_2(monkeypatch, capsys, tmp_path):
    _proj(tmp_path)
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(_ns())
    assert rc == 2
    assert "--set" in capsys.readouterr().err


def test_no_beril_yaml_returns_2(monkeypatch, capsys, tmp_path):
    # Project dir exists but has no beril.yaml → LifecycleError → rc 2.
    (tmp_path / "projects" / "demo").mkdir(parents=True)
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(_ns(state_json=json.dumps({"project": "demo"})))
    assert rc == 2
    assert "beril.yaml" in capsys.readouterr().err
