"""Tests for `beril review` subcommand."""

from __future__ import annotations

import argparse
import json

from beril_cli import review_cmd


def _ns(**kw) -> argparse.Namespace:
    base = {"project": "demo", "type": "project", "reviewer": "claude", "model": None}
    base.update(kw)
    return argparse.Namespace(**base)


def test_review_emits_file_and_hash(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    proj = tmp_path / "projects" / "demo"
    proj.mkdir(parents=True)
    monkeypatch.setattr(review_cmd, "find_repo_root", lambda: tmp_path)
    report_hash = "sha256:" + "b" * 64

    def fake_run(argv, **kw):
        review_path = proj / "REVIEW_1.md"
        review_path.write_text(f"---\nreview body\n---\n\n<!-- report_hash: {report_hash} -->\n")

        class R:
            returncode = 0
            stdout = f"Review written to: {review_path}\n"
            stderr = ""

        return R()

    monkeypatch.setattr(review_cmd.subprocess, "run", fake_run)
    rc = review_cmd.run_review(_ns())
    out = json.loads(capsys.readouterr().out)
    assert rc == 0
    assert out["review_file"].endswith("REVIEW_1.md")
    assert out["report_hash"] == report_hash


def test_review_passes_flags(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    proj = tmp_path / "projects" / "demo"
    proj.mkdir(parents=True)
    monkeypatch.setattr(review_cmd, "find_repo_root", lambda: tmp_path)
    seen = {}

    def fake_run(argv, **kw):
        seen["argv"] = list(argv)
        review_path = proj / "REVIEW_1.md"
        review_path.write_text("body\n")

        class R:
            returncode = 0
            stdout = f"Review written to: {review_path}\n"
            stderr = ""

        return R()

    monkeypatch.setattr(review_cmd.subprocess, "run", fake_run)
    review_cmd.run_review(_ns(type="plan", reviewer="codex", model="gpt-5.4"))
    argv = seen["argv"]
    assert argv[argv.index("--type") + 1] == "plan"
    assert argv[argv.index("--reviewer") + 1] == "codex"
    assert argv[argv.index("--model") + 1] == "gpt-5.4"
    assert "demo" in argv  # project id positional


def test_review_no_model_omits_flag(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    proj = tmp_path / "projects" / "demo"
    proj.mkdir(parents=True)
    monkeypatch.setattr(review_cmd, "find_repo_root", lambda: tmp_path)
    seen = {}

    def fake_run(argv, **kw):
        seen["argv"] = list(argv)
        (proj / "REVIEW_1.md").write_text("body\n")

        class R:
            returncode = 0
            stdout = f"Review written to: {proj / 'REVIEW_1.md'}\n"
            stderr = ""

        return R()

    monkeypatch.setattr(review_cmd.subprocess, "run", fake_run)
    review_cmd.run_review(_ns(model=None))
    assert "--model" not in seen["argv"]


def test_review_maps_child_exit_code(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(review_cmd, "find_repo_root", lambda: tmp_path)

    def fake_run(argv, **kw):
        class R:
            returncode = 1
            stdout = ""
            stderr = "reviewer failed"

        return R()

    monkeypatch.setattr(review_cmd.subprocess, "run", fake_run)
    rc = review_cmd.run_review(_ns())
    assert rc == 1
    assert "reviewer failed" in capsys.readouterr().err


def test_review_no_repo_returns_2(monkeypatch, capsys):
    monkeypatch.setattr(review_cmd, "find_repo_root", lambda: None)
    rc = review_cmd.run_review(_ns())
    assert rc == 2
    assert "BERIL repo not found" in capsys.readouterr().err
