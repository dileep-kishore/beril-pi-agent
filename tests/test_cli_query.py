"""Tests for `beril query` subcommand."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from beril_cli import query_cmd


def test_query_emits_payload_json(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    (tmp_path / "scripts").mkdir()
    monkeypatch.setattr(query_cmd, "find_repo_root", lambda: tmp_path)
    payload = {"returned_rows": 2, "rows": [{"a": 1}, {"a": 2}], "limit_applied": 100}

    def fake_run(argv, **kw):
        # run_sql writes JSON to the --output path
        out = argv[argv.index("--output") + 1]
        Path(out).write_text(json.dumps(payload))

        class R:
            returncode = 0
            stdout = "Wrote 2 rows"
            stderr = "[hub] noise"

        return R()

    monkeypatch.setattr(query_cmd.subprocess, "run", fake_run)
    rc = query_cmd.run_query(argparse.Namespace(query="SELECT 1", limit=100, proxy=True))
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and out["returned_rows"] == 2 and out["rows"][0]["a"] == 1


def test_query_passes_berdl_proxy(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(query_cmd, "find_repo_root", lambda: tmp_path)
    seen = {}

    def fake_run(argv, **kw):
        seen["argv"] = list(argv)
        out = argv[argv.index("--output") + 1]
        Path(out).write_text(json.dumps({"returned_rows": 0, "rows": [], "limit_applied": 5}))

        class R:
            returncode = 0
            stdout = ""
            stderr = ""

        return R()

    monkeypatch.setattr(query_cmd.subprocess, "run", fake_run)
    query_cmd.run_query(argparse.Namespace(query="SELECT 1", limit=5, proxy=True))
    assert "--berdl-proxy" in seen["argv"]
    assert "--limit" in seen["argv"] and seen["argv"][seen["argv"].index("--limit") + 1] == "5"


def test_query_no_proxy_omits_flag(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(query_cmd, "find_repo_root", lambda: tmp_path)
    seen = {}

    def fake_run(argv, **kw):
        seen["argv"] = list(argv)
        out = argv[argv.index("--output") + 1]
        Path(out).write_text(json.dumps({"returned_rows": 0, "rows": [], "limit_applied": None}))

        class R:
            returncode = 0
            stdout = ""
            stderr = ""

        return R()

    monkeypatch.setattr(query_cmd.subprocess, "run", fake_run)
    query_cmd.run_query(argparse.Namespace(query="SELECT 1", limit=100, proxy=False))
    assert "--berdl-proxy" not in seen["argv"]


def test_query_maps_child_exit_code(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(query_cmd, "find_repo_root", lambda: tmp_path)

    def fake_run(argv, **kw):
        class R:
            returncode = 2
            stdout = ""
            stderr = "usage error"

        return R()

    monkeypatch.setattr(query_cmd.subprocess, "run", fake_run)
    rc = query_cmd.run_query(argparse.Namespace(query="bad", limit=100, proxy=True))
    assert rc == 2
    assert "usage error" in capsys.readouterr().err


def test_query_no_repo_returns_2(monkeypatch, capsys):
    monkeypatch.setattr(query_cmd, "find_repo_root", lambda: None)
    rc = query_cmd.run_query(argparse.Namespace(query="SELECT 1", limit=100, proxy=True))
    assert rc == 2
    assert "BERIL repo not found" in capsys.readouterr().err
