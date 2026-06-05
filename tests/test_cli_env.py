"""Tests for `beril env` subcommand."""

from __future__ import annotations

import argparse
import json

from beril_cli import env_cmd


def test_env_emits_json(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(env_cmd, "find_repo_root", lambda: tmp_path)
    fake = {"location": "off-cluster", "ready": True, "checks": {}, "next_steps": []}

    def fake_run(argv, **kw):
        class R:
            returncode = 0
            stdout = json.dumps(fake)
            stderr = ""

        return R()

    monkeypatch.setattr(env_cmd.subprocess, "run", fake_run)
    rc = env_cmd.run_env(argparse.Namespace(json=True))
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and out["ready"] is True and out["location"] == "off-cluster"


def test_env_exits_zero_when_not_ready(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(env_cmd, "find_repo_root", lambda: tmp_path)
    fake = {"location": "off-cluster", "ready": False, "checks": {}, "next_steps": ["start pproxy"]}

    def fake_run(argv, **kw):
        class R:
            returncode = 0
            stdout = json.dumps(fake)
            stderr = ""

        return R()

    monkeypatch.setattr(env_cmd.subprocess, "run", fake_run)
    rc = env_cmd.run_env(argparse.Namespace(json=True))
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and out["ready"] is False
