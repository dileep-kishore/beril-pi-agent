"""Tests for `beril export` subcommand (destructive MinIO write)."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from beril_cli import export_cmd


def _ns(**kw) -> argparse.Namespace:
    base = {"query": "SELECT 1", "path": "s3a://x/y", "format": "parquet", "mode": "overwrite", "proxy": True}
    base.update(kw)
    return argparse.Namespace(**base)


def test_export_emits_manifest(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(export_cmd, "find_repo_root", lambda: tmp_path)
    manifest = {"path": "s3a://x/y", "format": "parquet", "mode": "overwrite", "count": 10}

    def fake_run(argv, **kw):
        out = argv[argv.index("--manifest") + 1]
        Path(out).write_text(json.dumps(manifest))

        class R:
            returncode = 0
            stdout = "[hub] noise"
            stderr = ""

        return R()

    monkeypatch.setattr(export_cmd.subprocess, "run", fake_run)
    rc = export_cmd.run_export(_ns())
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and out["mode"] == "overwrite" and out["count"] == 10


def test_export_passes_flags(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(export_cmd, "find_repo_root", lambda: tmp_path)
    seen = {}

    def fake_run(argv, **kw):
        seen["argv"] = list(argv)
        out = argv[argv.index("--manifest") + 1]
        Path(out).write_text(json.dumps({}))

        class R:
            returncode = 0
            stdout = ""
            stderr = ""

        return R()

    monkeypatch.setattr(export_cmd.subprocess, "run", fake_run)
    export_cmd.run_export(_ns(format="csv", mode="append"))
    argv = seen["argv"]
    assert argv[argv.index("--path") + 1] == "s3a://x/y"
    assert argv[argv.index("--format") + 1] == "csv"
    assert argv[argv.index("--mode") + 1] == "append"
    assert "--berdl-proxy" in argv


def test_export_no_proxy_omits_flag(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(export_cmd, "find_repo_root", lambda: tmp_path)
    seen = {}

    def fake_run(argv, **kw):
        seen["argv"] = list(argv)
        out = argv[argv.index("--manifest") + 1]
        Path(out).write_text(json.dumps({}))

        class R:
            returncode = 0
            stdout = ""
            stderr = ""

        return R()

    monkeypatch.setattr(export_cmd.subprocess, "run", fake_run)
    export_cmd.run_export(_ns(proxy=False))
    assert "--berdl-proxy" not in seen["argv"]


def test_export_maps_child_exit_code(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(export_cmd, "find_repo_root", lambda: tmp_path)

    def fake_run(argv, **kw):
        class R:
            returncode = 1
            stdout = ""
            stderr = "export failed"

        return R()

    monkeypatch.setattr(export_cmd.subprocess, "run", fake_run)
    rc = export_cmd.run_export(_ns())
    assert rc == 1
    assert "export failed" in capsys.readouterr().err


def test_export_no_repo_returns_2(monkeypatch, capsys):
    monkeypatch.setattr(export_cmd, "find_repo_root", lambda: None)
    rc = export_cmd.run_export(_ns())
    assert rc == 2
    assert "BERIL repo not found" in capsys.readouterr().err
