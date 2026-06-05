"""Tests for `beril start --agent pi`."""

from __future__ import annotations

import beril_cli.start as start


def test_pi_launch_execs_pi(monkeypatch, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(start, "find_repo_root", lambda: tmp_path)
    monkeypatch.setattr(start.shutil, "which", lambda a: f"/usr/bin/{a}")
    monkeypatch.setattr(start, "_checkout_release", lambda root, v: 0)
    monkeypatch.setattr(start, "_sync_auth_token", lambda p: None)
    monkeypatch.setattr(start, "print_jupyterhub_path_hint", lambda r: None)
    monkeypatch.chdir(tmp_path)
    captured = {}

    def fake_execvp(binary, argv):
        captured["binary"] = binary
        captured["argv"] = argv
        raise SystemExit(0)

    monkeypatch.setattr(start.os, "execvp", fake_execvp)
    try:
        start.run_start(agent="pi", extra_args=[])
    except SystemExit:
        pass
    assert captured["argv"][0] == "pi"
    assert "/berdl_start" not in captured["argv"]  # onboarding handled by the extension
    assert "--model" not in captured["argv"]  # no claude opus default
