"""Tests for the reshaped `beril doctor` check schema."""

from __future__ import annotations

import json

from beril_cli import doctor


def test_every_check_has_the_schema(monkeypatch, tmp_path):
    # Point at an empty tmp "repo" so no detect script / real .env is consulted.
    monkeypatch.setattr(doctor, "_find_repo_root", lambda: tmp_path)
    checks = doctor.collect_checks()
    assert checks
    for c in checks:
        assert set(c.keys()) == {"name", "ok", "detail", "fix", "optional"}
        assert isinstance(c["ok"], bool) and isinstance(c["optional"], bool)
        assert isinstance(c["fix"], str)


def test_overall_ok_ignores_optional_failures(monkeypatch, capsys, tmp_path):
    monkeypatch.setattr(doctor, "_find_repo_root", lambda: tmp_path)
    # Force KBASE token present so the only failures are optional ones.
    monkeypatch.setenv("KBASE_AUTH_TOKEN", "tok")
    rc = doctor.run_doctor(as_json=True)
    out = json.loads(capsys.readouterr().out)
    non_optional_ok = all(c["ok"] for c in out["checks"] if not c["optional"])
    assert out["ok"] == non_optional_ok
    assert rc == (0 if out["ok"] else 1)


def test_failing_non_optional_flips_overall(monkeypatch, capsys, tmp_path):
    monkeypatch.setattr(doctor, "_find_repo_root", lambda: None)
    monkeypatch.delenv("KBASE_AUTH_TOKEN", raising=False)
    rc = doctor.run_doctor(as_json=True)
    out = json.loads(capsys.readouterr().out)
    # Repo root and token are non-optional and failing here.
    assert out["ok"] is False and rc == 1
    token = next(c for c in out["checks"] if c["name"] == "KBASE_AUTH_TOKEN")
    assert token["ok"] is False and token["fix"]


def test_human_render_still_prints(monkeypatch, capsys, tmp_path):
    monkeypatch.setattr(doctor, "_find_repo_root", lambda: tmp_path)
    monkeypatch.setenv("KBASE_AUTH_TOKEN", "tok")
    doctor.run_doctor(as_json=False)
    out = capsys.readouterr().out
    assert "BERIL Environment Check" in out
