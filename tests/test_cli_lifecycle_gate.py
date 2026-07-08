"""Tests for `beril lifecycle gate` and `coherence` (+ reviewed → complete gate)."""

from __future__ import annotations

import argparse
import json

from beril_cli import lifecycle_cmd
from beril_cli.lifecycle import load_project


def _proj(tmp_path, status="reviewed", **files):
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
        "state_json": None,
        "get_state": False,
        "record": None,
        "override": None,
        "verdict": None,
        "note": None,
        "by": None,
        "reason": None,
        "list": False,
        "override_coherence": False,
    }
    base.update(kw)
    return argparse.Namespace(**base)


# ── gate record / override / list ────────────────────────


def test_gate_record_appends_entry_and_trace(monkeypatch, capsys, tmp_path):
    d = _proj(tmp_path, "active")
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(
        _ns(action="gate", record="data-validity", verdict="pass", note="clean")
    )
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and out["gate"]["gate"] == "data-validity" and out["gate"]["verdict"] == "pass"
    gates = load_project(d)["gates"]
    assert gates[-1]["note"] == "clean" and "at" in gates[-1]
    events = [json.loads(line)["event"] for line in (d / "TRACE.jsonl").read_text().splitlines()]
    assert events[-1] == "lifecycle.gate"


def test_gate_record_requires_verdict(monkeypatch, capsys, tmp_path):
    _proj(tmp_path, "active")
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(_ns(action="gate", record="data-validity"))
    assert rc == 2 and "verdict" in capsys.readouterr().err.lower()


def test_gate_override_requires_by(monkeypatch, capsys, tmp_path):
    _proj(tmp_path, "active")
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(_ns(action="gate", override="coherence", reason="ok"))
    assert rc == 2 and "--by" in capsys.readouterr().err


def test_gate_override_records_human_act(monkeypatch, capsys, tmp_path):
    d = _proj(tmp_path, "active")
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(
        _ns(action="gate", override="coherence", reason="records fine", by="0000-0001-2345-6789")
    )
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and out["gate"]["override"] is True and out["gate"]["by"] == "0000-0001-2345-6789"
    assert load_project(d)["gates"][-1]["reason"] == "records fine"


def test_gate_list_returns_last_wins_ordering(monkeypatch, capsys, tmp_path):
    _proj(tmp_path, "active")
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    lifecycle_cmd.run_lifecycle(_ns(action="gate", record="g", verdict="fail", note="first"))
    lifecycle_cmd.run_lifecycle(_ns(action="gate", record="g", verdict="pass", note="second"))
    capsys.readouterr()
    rc = lifecycle_cmd.run_lifecycle(_ns(action="gate", list=True))
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and len(out["gates"]) == 2
    assert out["gates"][-1]["verdict"] == "pass"  # readers take the last entry per id


# ── coherence report ─────────────────────────────────────


def test_coherence_all_ok(monkeypatch, capsys, tmp_path):
    d = _proj(tmp_path, "reviewed")
    (d / "REPORT.md").write_text("# r")
    (d / "claims.json").write_text("{}")
    (d / "TRACE.jsonl").write_text('{"event": "x"}\n')
    (d / "provenance.json").write_text("{}")
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(_ns(action="coherence"))
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and out["ok"] is True and out["record_behind"] == 0
    ids = {c["id"] for c in out["checks"]}
    assert ids == {"report-present", "claims-current", "record-current", "trace-present"}


def test_coherence_flags_missing_report_and_record_behind(monkeypatch, capsys, tmp_path):
    d = _proj(tmp_path, "reviewed")
    (d / "notebooks").mkdir()
    (d / "notebooks" / "01.ipynb").write_text("{}")
    (d / "figures").mkdir()
    (d / "figures" / "f1.png").write_text("x")
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(_ns(action="coherence"))
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and out["ok"] is False
    by_id = {c["id"]: c for c in out["checks"]}
    assert by_id["report-present"]["ok"] is False
    assert by_id["record-current"]["ok"] is False and out["record_behind"] == 2
    assert by_id["trace-present"]["ok"] is False


# ── reviewed → complete enforcement ──────────────────────


def test_complete_blocked_by_coherence(monkeypatch, capsys, tmp_path):
    d = _proj(tmp_path, "reviewed")
    (d / "REPORT.md").write_text("# r")
    (d / "notebooks").mkdir()
    (d / "notebooks" / "01.ipynb").write_text("{}")  # newer than absent provenance/trace
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(_ns(action="set", state="complete"))
    assert rc == 2
    err = capsys.readouterr().err
    assert "coherence" in err and ("record-current" in err or "trace-present" in err)
    assert load_project(d)["status"] == "reviewed"  # unchanged


def test_complete_override_records_gate_and_proceeds(monkeypatch, capsys, tmp_path):
    d = _proj(tmp_path, "reviewed")
    (d / "REPORT.md").write_text("# r")
    (d / "notebooks").mkdir()
    (d / "notebooks" / "01.ipynb").write_text("{}")
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(
        _ns(action="set", state="complete", override_coherence=True, reason="record is fine", by="0000-0001-2345-6789")
    )
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and out["status"] == "complete"
    proj = load_project(d)
    assert proj["status"] == "complete"
    override = next(g for g in proj["gates"] if g.get("gate") == "coherence")
    assert override["override"] is True and override["by"] == "0000-0001-2345-6789"


def test_complete_override_requires_reason_and_by(monkeypatch, capsys, tmp_path):
    d = _proj(tmp_path, "reviewed")
    (d / "REPORT.md").write_text("# r")
    (d / "notebooks").mkdir()
    (d / "notebooks" / "01.ipynb").write_text("{}")
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(_ns(action="set", state="complete", override_coherence=True))
    assert rc == 2 and "reason" in capsys.readouterr().err.lower()
    assert load_project(d)["status"] == "reviewed"


def test_complete_allowed_when_coherent(monkeypatch, capsys, tmp_path):
    d = _proj(tmp_path, "reviewed")
    (d / "REPORT.md").write_text("# r")
    (d / "claims.json").write_text("{}")
    (d / "provenance.json").write_text("{}")
    (d / "TRACE.jsonl").write_text('{"event": "x"}\n')
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(_ns(action="set", state="complete"))
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and out["status"] == "complete"
