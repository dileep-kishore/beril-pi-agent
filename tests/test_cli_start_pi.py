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


def test_with_continue_does_not_resume_by_default():
    assert start._with_continue([]) == []
    assert start._with_continue(["explore the data"]) == ["explore the data"]


def test_with_continue_respects_explicit_session_flags():
    assert start._with_continue(["--continue"]).count("--continue") == 1
    assert "--continue" not in start._with_continue(["--resume"])
    assert "--continue" not in start._with_continue(["--session", "abc123"])
    assert "--continue" not in start._with_continue(["--no-session"])
    # joined --flag=value form is matched on the token before '='
    assert "--continue" not in start._with_continue(["--session-id=proj-x"])


def test_start_launches_a_fresh_session_by_default(monkeypatch, tmp_path):
    _stub_launch(monkeypatch, tmp_path)
    monkeypatch.setattr(start, "_checkout_release", lambda root, v: 0)
    captured: dict = {}
    monkeypatch.setattr(start.os, "execvp", lambda binary, argv: captured.setdefault("argv", argv))
    start.run_start(extra_args=["explore the data"])
    assert captured["argv"] == ["pi", "explore the data"]
    assert start.os.environ["BERIL_START_SESSION_MODE"] == "fresh"


def test_start_marks_explicit_session_mode(monkeypatch, tmp_path):
    _stub_launch(monkeypatch, tmp_path)
    monkeypatch.setattr(start, "_checkout_release", lambda root, v: 0)
    captured: dict = {}
    monkeypatch.setattr(start.os, "execvp", lambda binary, argv: captured.setdefault("argv", argv))
    start.run_start(extra_args=["--continue"])
    assert captured["argv"] == ["pi", "--continue"]
    assert start.os.environ["BERIL_START_SESSION_MODE"] == "explicit"


def test_start_theme_flag_sets_theme_and_brand_env(monkeypatch, tmp_path):
    _stub_launch(monkeypatch, tmp_path)
    monkeypatch.setattr(start, "_checkout_release", lambda root, v: 0)
    calls: list[tuple[str, bool]] = []
    monkeypatch.setattr(start, "_set_theme", lambda root, theme, *, force=False: calls.append((theme, force)))
    monkeypatch.setattr(start.os, "execvp", lambda binary, argv: None)
    start.run_start(extra_args=[], theme="phenix")
    assert calls == [("phenix", True)]
    assert start.os.environ["BERIL_THEME"] == "phenix"


def test_start_theme_env_sets_theme_when_flag_absent(monkeypatch, tmp_path):
    _stub_launch(monkeypatch, tmp_path)
    monkeypatch.setattr(start, "_checkout_release", lambda root, v: 0)
    monkeypatch.setenv("BERIL_THEME", "phenix")
    calls: list[tuple[str, bool]] = []
    monkeypatch.setattr(start, "_set_theme", lambda root, theme, *, force=False: calls.append((theme, force)))
    monkeypatch.setattr(start.os, "execvp", lambda binary, argv: None)
    start.run_start(extra_args=[])
    assert calls == [("phenix", True)]


# ── --provider ────────────────────────────────────────────

_PROVIDER_ENV = (
    "BERIL_MODEL_PROVIDER",
    "BERIL_MAIN_MODEL",
    "BERIL_FAST_MODEL",
    "BERIL_REVIEW_MODEL",
    "BERIL_VISION_MODEL",
    "CBORG_API_KEY",
)


def _stub_provider_launch(monkeypatch, tmp_path):
    """Provider-test stubs: isolated models.json, stubbed provisioner, captured argv.

    Every provider env var is set-then-deleted via monkeypatch so run_start's
    direct os.environ writes are rolled back to the pre-test state at teardown.
    """
    _stub_launch(monkeypatch, tmp_path)
    monkeypatch.setattr(start, "_checkout_release", lambda root, v: 0)
    monkeypatch.setenv("PI_CODING_AGENT_DIR", str(tmp_path))  # never the real ~/.pi
    for name in _PROVIDER_ENV:
        monkeypatch.setenv(name, "sentinel")
        monkeypatch.delenv(name)
    calls: list[str] = []
    monkeypatch.setattr(start, "ensure_model_provider", lambda p: calls.append(p))
    captured: dict = {}
    monkeypatch.setattr(start.os, "execvp", lambda binary, argv: captured.setdefault("argv", argv))
    return calls, captured


def test_cli_start_passes_provider_flag(monkeypatch):
    """`beril start --provider cborg` is consumed by argparse and forwarded to run_start."""
    from beril_cli import cli, start as start_mod

    seen: dict = {}

    def fake_run_start(extra_args=None, version=None, theme=None, provider=None):
        seen["extra_args"] = extra_args
        seen["provider"] = provider
        return 0

    monkeypatch.setattr(start_mod, "run_start", fake_run_start)
    assert cli.main(["start", "--provider", "cborg", "explore the data"]) == 0
    assert seen["provider"] == "cborg"
    assert seen["extra_args"] == ["explore the data"]


def test_start_provider_cborg_provisions_and_sets_defaults(monkeypatch, tmp_path):
    calls, captured = _stub_provider_launch(monkeypatch, tmp_path)
    monkeypatch.setenv("CBORG_API_KEY", "sk-test")
    start.run_start(extra_args=[], provider="cborg")
    assert calls == ["cborg"]
    assert captured["argv"] == ["pi", "--provider", "cborg", "--model", "lbl/cborg-coder"]
    assert start.os.environ["BERIL_MODEL_PROVIDER"] == "cborg"
    assert start.os.environ["BERIL_MAIN_MODEL"] == "cborg/lbl/cborg-coder"
    assert start.os.environ["BERIL_FAST_MODEL"] == "cborg/lbl/cborg-mini"
    assert start.os.environ["BERIL_REVIEW_MODEL"] == "cborg/lbl/cborg-deepthought"
    assert start.os.environ["BERIL_VISION_MODEL"] == "cborg/lbl/cborg-vision"


def test_start_provider_cborg_keeps_user_model(monkeypatch, tmp_path):
    calls, captured = _stub_provider_launch(monkeypatch, tmp_path)
    start.run_start(extra_args=["--model", "lbl/cborg-coder-fast"], provider="cborg")
    argv = captured["argv"]
    assert argv.count("--model") == 1
    assert "lbl/cborg-coder" not in argv
    assert argv[argv.index("--model") + 1] == "lbl/cborg-coder-fast"


def test_start_provider_cborg_normalizes_joined_model_form(monkeypatch, tmp_path):
    """--model=x is normalized to the space form — the only form Pi's parser accepts."""
    calls, captured = _stub_provider_launch(monkeypatch, tmp_path)
    start.run_start(extra_args=["--model=lbl/cborg-coder-fast"], provider="cborg")
    argv = captured["argv"]
    assert argv.count("--model") == 1
    assert "lbl/cborg-coder" not in argv
    assert argv[argv.index("--model") + 1] == "lbl/cborg-coder-fast"


def test_start_other_provider_is_reappended_not_provisioned(monkeypatch, tmp_path):
    """--provider openai must not be silently dropped (argparse consumed it)."""
    calls, captured = _stub_provider_launch(monkeypatch, tmp_path)
    start.run_start(extra_args=["--model", "gpt-5"], provider="openai")
    assert calls == []
    assert captured["argv"] == ["pi", "--model", "gpt-5", "--provider", "openai"]
    assert "BERIL_MODEL_PROVIDER" not in start.os.environ


def test_start_provider_cborg_warns_without_api_key(monkeypatch, tmp_path, capsys):
    calls, captured = _stub_provider_launch(monkeypatch, tmp_path)
    start.run_start(extra_args=[], provider="cborg")
    assert "CBORG_API_KEY" in capsys.readouterr().err
    assert captured["argv"][0] == "pi"  # launch still happened


def test_start_provider_cborg_respects_user_role_env(monkeypatch, tmp_path):
    calls, captured = _stub_provider_launch(monkeypatch, tmp_path)
    monkeypatch.setenv("BERIL_REVIEW_MODEL", "anthropic/claude-opus-4-8")
    start.run_start(extra_args=[], provider="cborg")
    assert start.os.environ["BERIL_REVIEW_MODEL"] == "anthropic/claude-opus-4-8"
    assert start.os.environ["BERIL_FAST_MODEL"] == "cborg/lbl/cborg-mini"
