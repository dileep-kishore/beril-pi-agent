"""Tests for `beril hash` subcommand."""

from __future__ import annotations

import argparse
import json

from beril_cli import hash_cmd


def test_hash_passthrough(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(hash_cmd, "find_repo_root", lambda: tmp_path)
    hashes = {"notebooks/01.ipynb": "sha256:" + "a" * 64}

    def fake_run(argv, **kw):
        class R:
            returncode = 0
            stdout = json.dumps(hashes)
            stderr = ""

        return R()

    monkeypatch.setattr(hash_cmd.subprocess, "run", fake_run)
    rc = hash_cmd.run_hash(argparse.Namespace(project="demo"))
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and out["notebooks/01.ipynb"].startswith("sha256:")


def test_hash_resolves_project_dir(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(hash_cmd, "find_repo_root", lambda: tmp_path)
    seen = {}

    def fake_run(argv, **kw):
        seen["argv"] = list(argv)

        class R:
            returncode = 0
            stdout = "{}"
            stderr = ""

        return R()

    monkeypatch.setattr(hash_cmd.subprocess, "run", fake_run)
    hash_cmd.run_hash(argparse.Namespace(project="demo"))
    argv = seen["argv"]
    assert "compute-hashes" in argv
    # project dir is resolved under <repo_root>/projects/<project>
    assert str(tmp_path / "projects" / "demo") in argv


def test_hash_maps_child_exit_code(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(hash_cmd, "find_repo_root", lambda: tmp_path)

    def fake_run(argv, **kw):
        class R:
            returncode = 2
            stdout = ""
            stderr = "bad notebook"

        return R()

    monkeypatch.setattr(hash_cmd.subprocess, "run", fake_run)
    rc = hash_cmd.run_hash(argparse.Namespace(project="demo"))
    assert rc == 2
    assert "bad notebook" in capsys.readouterr().err


def test_hash_no_repo_returns_2(monkeypatch, capsys):
    monkeypatch.setattr(hash_cmd, "find_repo_root", lambda: None)
    rc = hash_cmd.run_hash(argparse.Namespace(project="demo"))
    assert rc == 2
    assert "BERIL repo not found" in capsys.readouterr().err
