"""Tests for release-pinning logic in `beril_cli.start`."""

from __future__ import annotations

import json
import subprocess
from io import BytesIO
from pathlib import Path
from typing import Callable
from urllib.error import URLError

import pytest

from beril_cli import start


# ── helpers ───────────────────────────────────────────────


def _completed(returncode: int = 0, stdout: str = "", stderr: str = "") -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(args=[], returncode=returncode, stdout=stdout, stderr=stderr)


def _patch_run(monkeypatch, handler: Callable[[list[str]], subprocess.CompletedProcess]) -> list[list[str]]:
    """Replace start.subprocess.run with `handler(argv)`. Records every argv received."""
    calls: list[list[str]] = []

    def fake_run(argv, **_kwargs):
        calls.append(list(argv))
        return handler(argv)

    monkeypatch.setattr(start.subprocess, "run", fake_run)
    return calls


def _patch_urlopen(monkeypatch, payload=None, *, exc: BaseException | None = None) -> None:
    """Patch urllib.request.urlopen used inside start. Either returns `payload` JSON or raises `exc`."""

    class _Resp:
        def __init__(self, body: bytes):
            self._body = BytesIO(body)

        def __enter__(self):
            return self._body

        def __exit__(self, *_a):
            return False

    def fake_urlopen(_req, timeout=None):
        if exc is not None:
            raise exc
        return _Resp(json.dumps(payload).encode())

    monkeypatch.setattr(start.urllib.request, "urlopen", fake_urlopen)


# ── _github_repo_slug ─────────────────────────────────────


@pytest.mark.parametrize(
    "url,expected",
    [
        ("https://github.com/kbaseincubator/BERIL-research-observatory.git\n", "kbaseincubator/BERIL-research-observatory"),
        ("https://github.com/kbaseincubator/BERIL-research-observatory\n", "kbaseincubator/BERIL-research-observatory"),
        ("git@github.com:kbaseincubator/BERIL-research-observatory.git\n", "kbaseincubator/BERIL-research-observatory"),
        ("git@github.com:owner/repo\n", "owner/repo"),
    ],
)
def test_repo_slug_parses_github_urls(monkeypatch, tmp_path, url, expected):
    _patch_run(monkeypatch, lambda argv: _completed(stdout=url))
    assert start._github_repo_slug(tmp_path) == expected


def test_repo_slug_rejects_non_github_remote(monkeypatch, tmp_path):
    _patch_run(monkeypatch, lambda argv: _completed(stdout="https://gitlab.com/owner/repo.git\n"))
    assert start._github_repo_slug(tmp_path) is None


def test_repo_slug_returns_none_when_git_fails(monkeypatch, tmp_path):
    _patch_run(monkeypatch, lambda argv: _completed(returncode=1, stderr="no remote"))
    assert start._github_repo_slug(tmp_path) is None


# ── _latest_release_tag ───────────────────────────────────


def test_latest_release_tag_reads_tag_name(monkeypatch, tmp_path):
    _patch_run(monkeypatch, lambda argv: _completed(stdout="https://github.com/owner/repo.git\n"))
    _patch_urlopen(monkeypatch, payload={"tag_name": "v0.0.1", "name": "First release"})
    assert start._latest_release_tag(tmp_path) == "v0.0.1"


def test_latest_release_tag_returns_none_on_http_failure(monkeypatch, tmp_path, capsys):
    _patch_run(monkeypatch, lambda argv: _completed(stdout="https://github.com/owner/repo.git\n"))
    _patch_urlopen(monkeypatch, exc=URLError("network down"))
    assert start._latest_release_tag(tmp_path) is None
    assert "could not query GitHub releases" in capsys.readouterr().err


def test_latest_release_tag_skips_when_slug_unparseable(monkeypatch, tmp_path):
    _patch_run(monkeypatch, lambda argv: _completed(stdout="https://gitlab.com/owner/repo.git\n"))
    # If slug is None, we should never reach urlopen. Make urlopen explode if it's called.
    def _boom(*_a, **_kw):
        raise AssertionError("urlopen should not be called when slug is unparseable")

    monkeypatch.setattr(start.urllib.request, "urlopen", _boom)
    assert start._latest_release_tag(tmp_path) is None


def test_latest_release_tag_returns_none_when_tag_name_missing(monkeypatch, tmp_path):
    _patch_run(monkeypatch, lambda argv: _completed(stdout="https://github.com/owner/repo.git\n"))
    _patch_urlopen(monkeypatch, payload={"name": "no tag here"})
    assert start._latest_release_tag(tmp_path) is None


# ── _checkout_release ─────────────────────────────────────


def _make_git_dispatcher(
    *,
    tags: dict[str, str] | None = None,
    head_sha: str = "HEADSHA",
    checkout_rc: int = 0,
    fetch_rc: int = 0,
    merge_base_rc: int = 0,
) -> Callable[[list[str]], subprocess.CompletedProcess]:
    """Build a handler that simulates a git repo with known tags.

    `tags` maps tag name → commit SHA. Anything not in `tags` fails `rev-parse --verify`.
    `merge_base_rc` is the exit code of `git merge-base --is-ancestor HEAD <tag>`
    (0 = HEAD behind the tag → auto-pin moves forward; non-zero = at/ahead → stay).
    """
    tags = tags or {}

    def handler(argv: list[str]) -> subprocess.CompletedProcess:
        # git fetch --tags --quiet
        if argv[:2] == ["git", "fetch"]:
            return _completed(returncode=fetch_rc, stderr="" if fetch_rc == 0 else "fetch failed")
        # git merge-base --is-ancestor HEAD <tag>
        if argv[:3] == ["git", "merge-base", "--is-ancestor"]:
            return _completed(returncode=merge_base_rc)
        # git rev-parse --verify refs/tags/<tag>
        if argv[:3] == ["git", "rev-parse", "--verify"]:
            ref = argv[3]  # "refs/tags/v0.0.1"
            tag = ref.removeprefix("refs/tags/")
            if tag in tags:
                return _completed(stdout=tags[tag] + "\n")
            return _completed(returncode=128, stderr=f"unknown ref {ref}")
        # git rev-parse HEAD
        if argv[:3] == ["git", "rev-parse", "HEAD"]:
            return _completed(stdout=head_sha + "\n")
        # git rev-parse <tag>^{commit}
        if argv[:2] == ["git", "rev-parse"] and argv[2].endswith("^{commit}"):
            tag = argv[2].removesuffix("^{commit}")
            if tag in tags:
                return _completed(stdout=tags[tag] + "\n")
            return _completed(returncode=128, stderr="unknown")
        # git checkout --quiet <tag>
        if argv[:2] == ["git", "checkout"]:
            return _completed(returncode=checkout_rc, stderr="" if checkout_rc == 0 else "dirty tree")
        # Anything else (e.g. git config --get remote.origin.url) — return empty success.
        return _completed()

    return handler


def test_checkout_release_explicit_version(monkeypatch, tmp_path, capsys):
    calls = _patch_run(
        monkeypatch,
        _make_git_dispatcher(tags={"v0.0.1": "ABC"}, head_sha="OLD"),
    )
    rc = start._checkout_release(tmp_path, "v0.0.1")
    assert rc == 0
    assert "Checked out release v0.0.1" in capsys.readouterr().out
    # Verify a checkout happened, targeting the requested tag.
    assert ["git", "checkout", "--quiet", "v0.0.1"] in calls


def test_checkout_release_accepts_version_without_v_prefix(monkeypatch, tmp_path):
    calls = _patch_run(
        monkeypatch,
        _make_git_dispatcher(tags={"v0.0.1": "ABC"}, head_sha="OLD"),
    )
    rc = start._checkout_release(tmp_path, "0.0.1")
    assert rc == 0
    # The user passed "0.0.1"; we should have normalized to "v0.0.1" before verifying/checking out.
    assert ["git", "rev-parse", "--verify", "refs/tags/v0.0.1"] in calls
    assert ["git", "checkout", "--quiet", "v0.0.1"] in calls


def test_checkout_release_unknown_version_fails(monkeypatch, tmp_path, capsys):
    _patch_run(monkeypatch, _make_git_dispatcher(tags={"v0.0.1": "ABC"}))
    rc = start._checkout_release(tmp_path, "v9.9.9")
    assert rc == 1
    assert "release 'v9.9.9' not found" in capsys.readouterr().err


def test_checkout_release_uses_latest_when_no_version(monkeypatch, tmp_path):
    calls = _patch_run(
        monkeypatch,
        _make_git_dispatcher(tags={"v0.0.1": "ABC"}, head_sha="OLD"),
    )
    # `_latest_release_tag` is called when requested_version is None. Stub it directly so
    # we don't have to wire up the GitHub URL parsing in this test.
    monkeypatch.setattr(start, "_latest_release_tag", lambda _root: "v0.0.1")
    rc = start._checkout_release(tmp_path, None)
    assert rc == 0
    assert ["git", "checkout", "--quiet", "v0.0.1"] in calls


def test_checkout_release_stays_when_ahead_of_release(monkeypatch, tmp_path, capsys):
    # On a branch/commit ahead of (or diverged from) the latest release and no
    # --version: do NOT downgrade — stay on the current checkout.
    calls = _patch_run(
        monkeypatch,
        _make_git_dispatcher(tags={"v0.0.1": "ABC"}, head_sha="NEWER", merge_base_rc=1),
    )
    monkeypatch.setattr(start, "_latest_release_tag", lambda _root: "v0.0.1")
    rc = start._checkout_release(tmp_path, None)
    assert rc == 0
    assert "Staying on the current checkout" in capsys.readouterr().out
    assert not any(argv[:2] == ["git", "checkout"] for argv in calls)


def test_checkout_release_explicit_version_pins_even_when_ahead(monkeypatch, tmp_path):
    # An explicit --version is a hard pin and may move backward even when ahead.
    calls = _patch_run(
        monkeypatch,
        _make_git_dispatcher(tags={"v0.0.1": "ABC"}, head_sha="NEWER", merge_base_rc=1),
    )
    rc = start._checkout_release(tmp_path, "v0.0.1")
    assert rc == 0
    assert ["git", "checkout", "--quiet", "v0.0.1"] in calls


def test_checkout_release_no_releases_available_continues_on_head(monkeypatch, tmp_path, capsys):
    # No --version and no published release: degrade gracefully, launch from the
    # current checkout (rc 0) with a warning, and do NOT attempt a checkout.
    calls = _patch_run(monkeypatch, _make_git_dispatcher())
    monkeypatch.setattr(start, "_latest_release_tag", lambda _root: None)
    rc = start._checkout_release(tmp_path, None)
    assert rc == 0
    assert "no published release found" in capsys.readouterr().err
    assert not any(argv[:2] == ["git", "checkout"] for argv in calls)


def test_checkout_release_skips_when_already_on_tag(monkeypatch, tmp_path, capsys):
    # HEAD and the tag both point at SHA "ABC" — no checkout should run.
    calls = _patch_run(
        monkeypatch,
        _make_git_dispatcher(tags={"v0.0.1": "ABC"}, head_sha="ABC"),
    )
    rc = start._checkout_release(tmp_path, "v0.0.1")
    assert rc == 0
    assert "Already on release v0.0.1" in capsys.readouterr().out
    # No checkout invocation should appear.
    assert not any(argv[:2] == ["git", "checkout"] for argv in calls)


def test_checkout_release_propagates_checkout_failure(monkeypatch, tmp_path, capsys):
    _patch_run(
        monkeypatch,
        _make_git_dispatcher(
            tags={"v0.0.1": "ABC"},
            head_sha="OLD",
            checkout_rc=1,
        ),
    )
    rc = start._checkout_release(tmp_path, "v0.0.1")
    assert rc == 1
    err = capsys.readouterr().err
    assert "failed to check out release v0.0.1" in err
    assert "local changes" in err


def test_checkout_release_warns_on_fetch_failure_but_continues(monkeypatch, tmp_path, capsys):
    _patch_run(
        monkeypatch,
        _make_git_dispatcher(tags={"v0.0.1": "ABC"}, head_sha="OLD", fetch_rc=1),
    )
    rc = start._checkout_release(tmp_path, "v0.0.1")
    assert rc == 0
    err = capsys.readouterr().err
    assert "could not refresh git tags" in err


def test_checkout_release_fetch_warning_does_not_dump_raw_ssh_stderr(monkeypatch, tmp_path, capsys):
    raw = "Connection closed by 10.1.11.80 port 22\nfatal: Could not read from remote repository."

    def handler(argv):
        if argv[:2] == ["git", "fetch"]:
            return _completed(returncode=1, stderr=raw)
        return _make_git_dispatcher(tags={"v0.0.1": "ABC"}, head_sha="OLD")(argv)

    _patch_run(monkeypatch, handler)
    rc = start._checkout_release(tmp_path, "v0.0.1")
    assert rc == 0
    err = capsys.readouterr().err
    assert "could not refresh git tags" in err
    assert "Connection closed" not in err
    assert "fatal:" not in err


# ── default theme provisioning ────────────────────────────


def test_ensure_default_theme_creates_settings_when_absent(tmp_path: Path) -> None:
    start._ensure_default_theme(tmp_path)
    data = json.loads((tmp_path / ".pi" / "settings.json").read_text())
    assert data["theme"] == "beril"


def test_ensure_quiet_startup_creates_settings_when_absent(tmp_path: Path) -> None:
    start._ensure_quiet_startup(tmp_path)
    data = json.loads((tmp_path / ".pi" / "settings.json").read_text())
    assert data["quietStartup"] is True


def test_ensure_quiet_startup_adds_to_existing_without_clobbering(tmp_path: Path) -> None:
    settings = tmp_path / ".pi" / "settings.json"
    settings.parent.mkdir(parents=True)
    settings.write_text(json.dumps({"packages": [".."], "theme": "beril"}))
    start._ensure_quiet_startup(tmp_path)
    assert json.loads(settings.read_text()) == {"packages": [".."], "theme": "beril", "quietStartup": True}


def test_ensure_quiet_startup_respects_an_existing_choice(tmp_path: Path) -> None:
    settings = tmp_path / ".pi" / "settings.json"
    settings.parent.mkdir(parents=True)
    settings.write_text(json.dumps({"quietStartup": False}))
    start._ensure_quiet_startup(tmp_path)
    assert json.loads(settings.read_text())["quietStartup"] is False


def test_ensure_default_theme_adds_to_existing_without_clobbering(tmp_path: Path) -> None:
    settings = tmp_path / ".pi" / "settings.json"
    settings.parent.mkdir(parents=True)
    settings.write_text(json.dumps({"packages": [".."]}))
    start._ensure_default_theme(tmp_path)
    data = json.loads(settings.read_text())
    assert data == {"packages": [".."], "theme": "beril"}


def test_ensure_default_theme_respects_an_existing_choice(tmp_path: Path) -> None:
    settings = tmp_path / ".pi" / "settings.json"
    settings.parent.mkdir(parents=True)
    settings.write_text(json.dumps({"theme": "dark"}))
    start._ensure_default_theme(tmp_path)
    assert json.loads(settings.read_text())["theme"] == "dark", "an explicit theme is never overridden"


def test_set_theme_force_overwrites_existing_choice(tmp_path: Path) -> None:
    settings = tmp_path / ".pi" / "settings.json"
    settings.parent.mkdir(parents=True)
    settings.write_text(json.dumps({"theme": "dark", "packages": [".."]}))
    start._set_theme(tmp_path, "phenix", force=True)
    assert json.loads(settings.read_text()) == {"theme": "phenix", "packages": [".."]}


def test_read_pi_theme_returns_existing_choice(tmp_path: Path) -> None:
    settings = tmp_path / ".pi" / "settings.json"
    settings.parent.mkdir(parents=True)
    settings.write_text(json.dumps({"theme": "phenix"}))
    assert start._read_pi_theme(tmp_path) == "phenix"


def test_ensure_default_theme_leaves_malformed_settings_untouched(tmp_path: Path) -> None:
    settings = tmp_path / ".pi" / "settings.json"
    settings.parent.mkdir(parents=True)
    settings.write_text("{ not json")
    start._ensure_default_theme(tmp_path)  # must not raise
    assert settings.read_text() == "{ not json"
