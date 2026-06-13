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
        start.run_start(extra_args=[])
    except SystemExit:
        pass
    assert captured["argv"][0] == "pi"
    assert "/berdl_start" not in captured["argv"]  # onboarding handled by the extension
    assert "--model" not in captured["argv"]  # no claude opus default


def _stub_launch(monkeypatch, tmp_path):
    """Common monkeypatching so run_start reaches the update step then exits at execvp."""
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(start, "find_repo_root", lambda: tmp_path)
    monkeypatch.setattr(start.shutil, "which", lambda a: f"/usr/bin/{a}")
    monkeypatch.setattr(start, "_sync_auth_token", lambda p: None)
    monkeypatch.setattr(start, "print_jupyterhub_path_hint", lambda r: None)
    monkeypatch.chdir(tmp_path)

    def fake_execvp(binary, argv):
        raise SystemExit(0)

    monkeypatch.setattr(start.os, "execvp", fake_execvp)


def test_update_channel_branch_pulls_latest(monkeypatch, tmp_path):
    """BERIL_UPDATE_CHANNEL=<branch> fast-forwards that branch instead of pinning a release."""
    _stub_launch(monkeypatch, tmp_path)
    monkeypatch.setenv("BERIL_UPDATE_CHANNEL", "main")
    called: dict = {}
    monkeypatch.setattr(start, "_pull_latest", lambda root, branch: called.setdefault("pull", branch) or 0)
    monkeypatch.setattr(start, "_checkout_release", lambda root, v: called.setdefault("release", v) or 0)
    try:
        start.run_start(extra_args=[])
    except SystemExit:
        pass
    assert called.get("pull") == "main"
    assert "release" not in called


def test_default_channel_pins_release(monkeypatch, tmp_path):
    """With no BERIL_UPDATE_CHANNEL set, the launcher uses the release pin."""
    _stub_launch(monkeypatch, tmp_path)
    monkeypatch.delenv("BERIL_UPDATE_CHANNEL", raising=False)
    called: dict = {}
    monkeypatch.setattr(start, "_pull_latest", lambda root, branch: called.setdefault("pull", branch) or 0)
    monkeypatch.setattr(start, "_checkout_release", lambda root, v: called.setdefault("release", True) or 0)
    try:
        start.run_start(extra_args=[])
    except SystemExit:
        pass
    assert called.get("release") is True
    assert "pull" not in called


def test_with_continue_prepends_by_default():
    assert start._with_continue([]) == ["--continue"]
    assert start._with_continue(["explore the data"]) == ["--continue", "explore the data"]


def test_with_continue_respects_explicit_session_flags():
    assert start._with_continue(["--continue"]).count("--continue") == 1
    assert "--continue" not in start._with_continue(["--resume"])
    assert "--continue" not in start._with_continue(["--session", "abc123"])
    assert "--continue" not in start._with_continue(["--no-session"])
    # joined --flag=value form is matched on the token before '='
    assert "--continue" not in start._with_continue(["--session-id=proj-x"])


def test_start_injects_continue_into_execvp(monkeypatch, tmp_path):
    _stub_launch(monkeypatch, tmp_path)
    monkeypatch.setattr(start, "_checkout_release", lambda root, v: 0)
    captured: dict = {}
    monkeypatch.setattr(start.os, "execvp", lambda binary, argv: captured.setdefault("argv", argv))
    start.run_start(extra_args=["explore the data"])
    assert captured["argv"] == ["pi", "--continue", "explore the data"]
