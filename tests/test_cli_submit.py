"""Tests for `beril submit` subcommand (2 = partial = failure)."""

from __future__ import annotations

import argparse
import json

from beril_cli import submit_cmd


def _ns(project: str = "demo") -> argparse.Namespace:
    return argparse.Namespace(project=project)


def test_submit_success_returns_0(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(submit_cmd, "find_repo_root", lambda: tmp_path)
    manifest = {"archive_key": "s3a://x/demo", "file_count": 12, "byte_total": 999, "duration_seconds": 3.2}

    def fake_run(argv, **kw):
        class R:
            returncode = 0
            stdout = json.dumps(manifest)
            stderr = ""

        return R()

    monkeypatch.setattr(submit_cmd.subprocess, "run", fake_run)
    rc = submit_cmd.run_submit(_ns())
    out = json.loads(capsys.readouterr().out)
    assert rc == 0
    assert out["archive_key"] == "s3a://x/demo" and out["file_count"] == 12
    assert out.get("partial") is not True


def test_submit_partial_returns_2_with_flag(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(submit_cmd, "find_repo_root", lambda: tmp_path)
    manifest = {
        "archive_key": "s3a://x/demo",
        "file_count": 8,
        "byte_total": 500,
        "duration_seconds": 2.0,
        "error": "partial upload: 7 of 12 local files present at archive_key",
    }

    def fake_run(argv, **kw):
        class R:
            returncode = 2
            stdout = json.dumps(manifest)
            stderr = ""

        return R()

    monkeypatch.setattr(submit_cmd.subprocess, "run", fake_run)
    rc = submit_cmd.run_submit(_ns())
    out = json.loads(capsys.readouterr().out)
    assert rc == 2  # partial = failure
    assert out["partial"] is True
    assert out["archive_key"] == "s3a://x/demo"
    assert "partial upload" in out["error"]


def test_submit_hard_failure_returns_1(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(submit_cmd, "find_repo_root", lambda: tmp_path)

    def fake_run(argv, **kw):
        class R:
            returncode = 1
            stdout = ""
            stderr = "upload aborted: project not approved"

        return R()

    monkeypatch.setattr(submit_cmd.subprocess, "run", fake_run)
    rc = submit_cmd.run_submit(_ns())
    captured = capsys.readouterr()
    assert rc == 1
    assert captured.out.strip() == ""  # no JSON on hard failure
    assert "not approved" in captured.err


def test_submit_passes_project(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(submit_cmd, "find_repo_root", lambda: tmp_path)
    seen = {}

    def fake_run(argv, **kw):
        seen["argv"] = list(argv)

        class R:
            returncode = 0
            stdout = json.dumps({"archive_key": "k"})
            stderr = ""

        return R()

    monkeypatch.setattr(submit_cmd.subprocess, "run", fake_run)
    submit_cmd.run_submit(_ns(project="demo"))
    assert "demo" in seen["argv"]


def test_submit_no_repo_returns_2(monkeypatch, capsys):
    monkeypatch.setattr(submit_cmd, "find_repo_root", lambda: None)
    rc = submit_cmd.run_submit(_ns())
    assert rc == 2
    assert "BERIL repo not found" in capsys.readouterr().err
