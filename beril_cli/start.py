"""beril start — launch a coding agent."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

from beril_cli.detect import print_jupyterhub_path_hint
from beril_cli.paths import find_repo_root

GITHUB_API_TIMEOUT_SECONDS = 10

# Session-control flags Pi understands; if the user passes any of these, the
# launcher marks the session as explicit so extensions may safely restore context.
_SESSION_FLAGS = frozenset(
    {"-c", "--continue", "-r", "--resume", "--session", "--session-id", "--fork", "--no-session"}
)


def _has_session_flag(extra_args: list[str]) -> bool:
    return any(arg.split("=", 1)[0] in _SESSION_FLAGS for arg in extra_args)


def _with_continue(extra_args: list[str]) -> list[str]:
    """Return Pi args without implicit resume.

    Historically this prepended ``--continue``. That made every ``beril start``
    resurrect the last research thread, which is surprising for new users and
    makes fresh sessions show stale project state. Keep the helper for backward-
    compatible tests/call sites, but make fresh launch the default; users can
    still pass ``--continue`` / ``--resume`` / ``--session`` explicitly.
    """
    return extra_args


def _sync_auth_token(env_path: Path) -> None:
    """Sync KBASE_AUTH_TOKEN from live environment into .env if available."""
    token = os.environ.get("KBASE_AUTH_TOKEN", "")
    if not token or not env_path.exists():
        return
    lines = env_path.read_text().splitlines()
    updated = False
    for i, line in enumerate(lines):
        if line.strip().startswith("KBASE_AUTH_TOKEN="):
            if line.strip() != f"KBASE_AUTH_TOKEN={token}":
                lines[i] = f"KBASE_AUTH_TOKEN={token}"
                updated = True
            break
    else:
        lines.append(f"KBASE_AUTH_TOKEN={token}")
        updated = True
    if updated:
        env_path.write_text("\n".join(lines) + "\n")
        print("Refreshed KBASE_AUTH_TOKEN in .env")


def _set_theme(repo_root: Path, theme: str, *, force: bool = False) -> None:
    """Set Pi's active project theme in `.pi/settings.json`.

    By default this provisions a first-launch default without clobbering a user
    choice. With ``force=True`` (from `beril start --theme`), the user is making
    an explicit new choice, so overwrite the theme key while preserving the rest
    of the local settings file.
    """
    settings_path = repo_root / ".pi" / "settings.json"
    try:
        data = json.loads(settings_path.read_text()) if settings_path.exists() else {}
        if not isinstance(data, dict):
            return
        if data.get("theme") == theme:
            return
        if data.get("theme") and not force:
            return
        data["theme"] = theme
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text(json.dumps(data, indent=2) + "\n")
        action = "Set" if force else "Set the default"
        print(f"{action} theme to '{theme}' in .pi/settings.json")
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Warning: could not set the theme: {exc}", file=sys.stderr)


def _ensure_quiet_startup(repo_root: Path) -> None:
    """Hide Pi's generic startup resource listing for the BERIL workbench.

    BERIL installs its own science/workflow welcome panel from `beril-env`.
    `quietStartup` removes Pi's built-in context/skills/extensions inventory so
    the first visible surface is the BERIL-focused orientation. Respect an
    explicit user value if one already exists.
    """
    settings_path = repo_root / ".pi" / "settings.json"
    try:
        data = json.loads(settings_path.read_text()) if settings_path.exists() else {}
        if not isinstance(data, dict):
            return
        if "quietStartup" in data:
            return
        data["quietStartup"] = True
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text(json.dumps(data, indent=2) + "\n")
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Warning: could not set quiet startup: {exc}", file=sys.stderr)


def _read_pi_theme(repo_root: Path) -> str | None:
    """Read the active project-local Pi theme, if present."""
    settings_path = repo_root / ".pi" / "settings.json"
    try:
        data = json.loads(settings_path.read_text()) if settings_path.exists() else {}
        if not isinstance(data, dict):
            return None
        theme = data.get("theme")
        return theme if isinstance(theme, str) and theme.strip() else None
    except (OSError, json.JSONDecodeError):
        return None


def _ensure_default_theme(repo_root: Path, theme: str = "beril") -> None:
    """Make the bundled `beril` theme the default look on first launch.

    The theme ships in the package (`themes/beril.json`) and is registered by
    `pi install -l .`, but a *registered* theme is only selectable, not active.
    Pi reads the active theme from `.pi/settings.json` (project settings), which is
    git-ignored and user-local, so it can't be shipped in the repo. We provision it
    here — the same way `beril start` already syncs the KBase token into `.env` —
    setting `theme` only when the user hasn't chosen one, so an explicit pick is
    never overridden. Best-effort: a malformed settings file is left untouched.
    """
    _set_theme(repo_root, theme, force=False)


def _github_repo_slug(repo_root: Path) -> str | None:
    """Return 'owner/repo' parsed from origin's URL, or None if it isn't a GitHub remote."""
    result = subprocess.run(
        ["git", "config", "--get", "remote.origin.url"],
        cwd=repo_root, capture_output=True, text=True, check=False,
    )
    if result.returncode != 0:
        return None
    url = result.stdout.strip()
    # Handles https://github.com/owner/repo(.git) and git@github.com:owner/repo(.git)
    match = re.search(r"github\.com[:/]([^/]+)/([^/]+?)(?:\.git)?/?$", url)
    if not match:
        return None
    return f"{match.group(1)}/{match.group(2)}"


def _latest_release_tag(repo_root: Path) -> str | None:
    """Return the tag of the latest published GitHub release, or None.

    Uses the public Releases API, which excludes drafts and prereleases. Raw git tags
    that were never published as a release (e.g. internal version bumps) are ignored.
    """
    slug = _github_repo_slug(repo_root)
    if not slug:
        return None
    url = f"https://api.github.com/repos/{slug}/releases/latest"
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json"})
    try:
        with urllib.request.urlopen(req, timeout=GITHUB_API_TIMEOUT_SECONDS) as resp:
            payload = json.load(resp)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        print(f"Warning: could not query GitHub releases: {exc}", file=sys.stderr)
        return None
    tag = payload.get("tag_name")
    return tag if isinstance(tag, str) and tag else None


def _checkout_release(repo_root: Path, requested_version: str | None) -> int:
    """Fetch tags and check out the requested release (or the latest if unspecified).

    Returns 0 on success, non-zero on failure.
    """
    fetch = subprocess.run(
        ["git", "fetch", "--tags", "--quiet"],
        cwd=repo_root, capture_output=True, text=True, check=False,
    )
    if fetch.returncode != 0:
        print(
            "Warning: could not refresh git tags; using local tag cache/current checkout.",
            file=sys.stderr,
        )

    if requested_version:
        tag = requested_version if requested_version.startswith("v") else f"v{requested_version}"
        verify = subprocess.run(
            ["git", "rev-parse", "--verify", f"refs/tags/{tag}"],
            cwd=repo_root, capture_output=True, text=True, check=False,
        )
        if verify.returncode != 0:
            print(f"Error: release '{tag}' not found.", file=sys.stderr)
            return 1
    else:
        tag = _latest_release_tag(repo_root)
        if not tag:
            # No published release to pin to (e.g. a fresh standalone checkout).
            # The version pin is a best-effort reproducibility aid, not a launch
            # requirement, so warn and continue on the current checkout. An
            # explicitly requested --version that is missing still hard-fails above.
            print(
                "Warning: no published release found; launching from the current "
                "checkout without a version pin.",
                file=sys.stderr,
            )
            return 0

    head = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repo_root, capture_output=True, text=True, check=False,
    )
    target = subprocess.run(
        ["git", "rev-parse", f"{tag}^{{commit}}"],
        cwd=repo_root, capture_output=True, text=True, check=False,
    )
    if (
        head.returncode == 0
        and target.returncode == 0
        and head.stdout.strip() == target.stdout.strip()
    ):
        print(f"Already on release {tag}")
        return 0

    if not requested_version:
        # The auto-pin only ever moves FORWARD. Check out the latest release only
        # when HEAD is strictly behind it (HEAD is an ancestor of the tag). On a
        # feature branch or a commit at/ahead of the release, stay on the current
        # checkout rather than silently downgrading newer work to the last release.
        # An explicit --version still hard-pins (and may move backward) by design.
        behind = subprocess.run(
            ["git", "merge-base", "--is-ancestor", "HEAD", tag],
            cwd=repo_root, capture_output=True, text=True, check=False,
        )
        if behind.returncode != 0:
            print(f"Staying on the current checkout (at or ahead of release {tag}).")
            return 0

    checkout = subprocess.run(
        ["git", "checkout", "--quiet", tag],
        cwd=repo_root, capture_output=True, text=True, check=False,
    )
    if checkout.returncode != 0:
        print(
            f"Error: failed to check out release {tag}: {checkout.stderr.strip()}",
            file=sys.stderr,
        )
        print(
            "You may have local changes. Commit or stash them and try again.",
            file=sys.stderr,
        )
        return checkout.returncode
    print(f"Checked out release {tag}")
    return 0


def _read_env_setting(repo_root: Path, key: str, default: str = "") -> str:
    """Read a setting from the live environment, falling back to the repo `.env`.

    Lets a flag like ``BERIL_UPDATE_CHANNEL`` live in `.env` (the natural home for
    per-checkout config) while still honouring an exported shell value if present.
    """
    live = os.environ.get(key)
    if live and live.strip():
        return live.strip()
    env_path = repo_root / ".env"
    if env_path.exists():
        for raw in env_path.read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if k.strip() == key:
                return v.strip().strip("'").strip('"')
    return default


def _pull_latest(repo_root: Path, branch: str) -> int:
    """Fast-forward `branch` to origin's latest and check it out.

    The opt-in counterpart to `_checkout_release` (via ``BERIL_UPDATE_CHANNEL``).
    Best-effort like the release pin: on a dirty tree, divergence, or a network
    failure it warns and launches from the current checkout rather than blocking.
    Only ever FAST-FORWARDS (never merges/rebases), so local commits are never
    clobbered — if it can't fast-forward, it leaves the checkout untouched.
    """
    fetch = subprocess.run(
        ["git", "fetch", "--quiet", "origin", branch],
        cwd=repo_root, capture_output=True, text=True, check=False,
    )
    if fetch.returncode != 0:
        print(
            f"Warning: could not fetch origin/{branch}: {fetch.stderr.strip()}; "
            "launching from the current checkout.",
            file=sys.stderr,
        )
        return 0
    current = subprocess.run(
        ["git", "symbolic-ref", "--quiet", "--short", "HEAD"],
        cwd=repo_root, capture_output=True, text=True, check=False,
    ).stdout.strip()
    if current != branch:
        checkout = subprocess.run(
            ["git", "checkout", "--quiet", branch],
            cwd=repo_root, capture_output=True, text=True, check=False,
        )
        if checkout.returncode != 0:
            print(
                f"Warning: could not check out {branch}: {checkout.stderr.strip()}; "
                "launching from the current checkout.",
                file=sys.stderr,
            )
            return 0
    ff = subprocess.run(
        ["git", "merge", "--ff-only", f"origin/{branch}"],
        cwd=repo_root, capture_output=True, text=True, check=False,
    )
    if ff.returncode != 0:
        print(
            f"Warning: could not fast-forward {branch} to origin/{branch} "
            "(local changes or divergence?); launching from the current checkout.",
            file=sys.stderr,
        )
        return 0
    print(f"Updated to the latest origin/{branch}.")
    return 0


def run_start(
    extra_args: list[str] | None = None,
    version: str | None = None,
    theme: str | None = None,
) -> int:
    """Launch the Pi coding agent from the repo root.

    beril is a Pi workbench, so `beril start` always launches `pi` — no other
    agent is supported here, and a stale config can't redirect it. (Other agents
    like claude/codex are still used *inside* skills and subagents — e.g. the
    `/berdl-review` Opus reviewer — but the workbench launcher itself is pi-only.)
    """
    agent = "pi"
    extra_args = extra_args or []

    binary = shutil.which(agent)
    if not binary:
        print("Error: 'pi' is not installed or not on PATH.", file=sys.stderr)
        print("beril is a Pi workbench — install Pi from https://pi.dev and try again.", file=sys.stderr)
        return 1

    # Ensure we launch from the repo root so agent workflows have correct paths
    repo_root = find_repo_root()
    if repo_root:
        os.chdir(repo_root)
    else:
        print("Error: BERIL repository not found. Run 'beril setup' first.", file=sys.stderr)
        return 1

    # Update step. Default: pin to the latest published release (forward-only).
    # Opt-in: set BERIL_UPDATE_CHANNEL=<branch> (e.g. "main") in .env to instead
    # fast-forward to that branch's latest changes — handy while iterating before
    # a release is cut. An explicit --version always wins (a hard release pin).
    channel = _read_env_setting(repo_root, "BERIL_UPDATE_CHANNEL", "release")
    if version is None and channel.lower() not in ("", "release"):
        rc = _pull_latest(repo_root, channel)
    else:
        rc = _checkout_release(repo_root, version)
    if rc != 0:
        return rc

    # Refresh KBASE_AUTH_TOKEN in .env from live environment (tokens expire)
    _sync_auth_token(repo_root / ".env")

    # Make the bundled beril theme the default look, unless the user explicitly
    # selects another registered/built-in Pi theme. BERIL_THEME is also exported
    # so the extensions can switch branding (e.g. PHENIX) at startup.
    selected_theme = theme or _read_env_setting(repo_root, "BERIL_THEME", "")
    if selected_theme:
        _set_theme(repo_root, selected_theme, force=True)
        os.environ["BERIL_THEME"] = selected_theme
    else:
        _ensure_default_theme(repo_root)
        os.environ.setdefault("BERIL_THEME", _read_pi_theme(repo_root) or "beril")
    _ensure_quiet_startup(repo_root)

    print(f"Launching {agent}...")
    print_jupyterhub_path_hint(repo_root)
    os.environ["BERIL_START_SESSION_MODE"] = "explicit" if _has_session_flag(extra_args) else "fresh"
    # Replace the current process with the agent. Fresh launch is the default;
    # pass Pi's --continue/--resume/--session flags explicitly to restore a thread.
    os.execvp(binary, [agent, *_with_continue(extra_args)])

    # execvp doesn't return on success; this is only reached on failure
    return 1  # pragma: no cover
