"""Tests for `beril discover` subcommand."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from beril_cli import discover_cmd


def test_discover_emits_snapshot(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(discover_cmd, "find_repo_root", lambda: tmp_path)
    snap = {"databases": [{"name": "db1"}]}

    def fake_run(argv, **kw):
        out = argv[argv.index("--output") + 1]
        Path(out).write_text(json.dumps(snap))

        class R:
            returncode = 0
            stdout = "Discovered 1 database"
            stderr = ""

        return R()

    monkeypatch.setattr(discover_cmd.subprocess, "run", fake_run)
    rc = discover_cmd.run_discover(argparse.Namespace(max_databases=None))
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and out["databases"][0]["name"] == "db1"


def test_discover_passes_max_databases(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(discover_cmd, "find_repo_root", lambda: tmp_path)
    seen = {}

    def fake_run(argv, **kw):
        seen["argv"] = list(argv)
        out = argv[argv.index("--output") + 1]
        Path(out).write_text(json.dumps({"databases": []}))

        class R:
            returncode = 0
            stdout = ""
            stderr = ""

        return R()

    monkeypatch.setattr(discover_cmd.subprocess, "run", fake_run)
    discover_cmd.run_discover(argparse.Namespace(max_databases=3))
    argv = seen["argv"]
    assert "--max-databases" in argv
    assert argv[argv.index("--max-databases") + 1] == "3"
    assert "--berdl-proxy" not in argv  # discover has no proxy flag


def test_discover_omits_max_databases_when_none(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(discover_cmd, "find_repo_root", lambda: tmp_path)
    seen = {}

    def fake_run(argv, **kw):
        seen["argv"] = list(argv)
        out = argv[argv.index("--output") + 1]
        Path(out).write_text(json.dumps({"databases": []}))

        class R:
            returncode = 0
            stdout = ""
            stderr = ""

        return R()

    monkeypatch.setattr(discover_cmd.subprocess, "run", fake_run)
    discover_cmd.run_discover(argparse.Namespace(max_databases=None))
    assert "--max-databases" not in seen["argv"]


def test_discover_maps_child_exit_code(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(discover_cmd, "find_repo_root", lambda: tmp_path)

    def fake_run(argv, **kw):
        class R:
            returncode = 2
            stdout = ""
            stderr = "discovery failed"

        return R()

    monkeypatch.setattr(discover_cmd.subprocess, "run", fake_run)
    rc = discover_cmd.run_discover(argparse.Namespace(max_databases=None))
    assert rc == 2
    assert "discovery failed" in capsys.readouterr().err


def test_discover_no_repo_returns_2(monkeypatch, capsys):
    monkeypatch.setattr(discover_cmd, "find_repo_root", lambda: None)
    rc = discover_cmd.run_discover(argparse.Namespace(max_databases=None))
    assert rc == 2
    assert "BERIL repo not found" in capsys.readouterr().err
