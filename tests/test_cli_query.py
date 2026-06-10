"""Tests for `beril query` subcommand."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pytest

from beril_cli import query_cmd


@pytest.fixture(autouse=True)
def _force_off_cluster(monkeypatch):
    """Default tests to off-cluster so the existing uv-run/--berdl-proxy assertions
    hold regardless of where the suite runs (CI vs. inside a BERDL pod)."""
    monkeypatch.setattr(query_cmd, "is_on_cluster", lambda: False)


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


def test_query_on_cluster_skips_proxy_and_uses_sys_python(monkeypatch, capsys, tmp_path):
    """On-cluster, the runner is invoked under sys.executable with no `--berdl-proxy`.

    `beril query`'s default keeps `proxy=True`, but on-cluster pproxy isn't running
    and there's no JupyterHub-spawn dance to do — Spark is reachable directly.
    """
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(query_cmd, "find_repo_root", lambda: tmp_path)
    monkeypatch.setattr(query_cmd, "is_on_cluster", lambda: True)
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
    argv = seen["argv"]
    assert argv[0] == sys.executable
    assert "uv" not in argv and "--berdl-proxy" not in argv
