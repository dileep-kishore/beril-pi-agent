"""Tests for `beril_cli.paths.find_repo_root`."""

from __future__ import annotations

from beril_cli.paths import find_repo_root


def test_finds_root_with_project_md(tmp_path, monkeypatch):
    (tmp_path / "PROJECT.md").write_text("x")
    sub = tmp_path / "a" / "b"
    sub.mkdir(parents=True)
    monkeypatch.chdir(sub)
    assert find_repo_root() == tmp_path


def test_returns_none_without_marker(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    assert find_repo_root() is None
