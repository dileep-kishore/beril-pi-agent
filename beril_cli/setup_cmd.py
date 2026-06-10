"""beril setup — interactive onboarding wizard."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

from beril_cli import config
from beril_cli.detect import detect_user_identity, print_jupyterhub_path_hint


def _find_repo_root() -> Path | None:
    """Walk up from cwd looking for PROJECT.md."""
    current = Path.cwd()
    for parent in [current, *current.parents]:
        if (parent / "PROJECT.md").exists():
            return parent
    return None


def _prompt(question: str, default: str = "") -> str:
    """Prompt user for input with optional default."""
    suffix = f" [{default}]" if default else ""
    answer = input(f"{question}{suffix}: ").strip()
    return answer or default


def _confirm(question: str, default: bool = True) -> bool:
    """Yes/no prompt."""
    hint = "Y/n" if default else "y/N"
    answer = input(f"{question} [{hint}]: ").strip().lower()
    if not answer:
        return default
    return answer in ("y", "yes")


def _step(number: int, label: str) -> None:
    """Print a numbered step header."""
    print(f"\n{'─' * 50}")
    print(f"  Step {number}: {label}")
    print(f"{'─' * 50}")


def run_setup() -> int:
    """Run the interactive setup wizard."""
    print()
    print("BERIL Research Observatory — Setup")
    print("=" * 50)

    # ── Step 1: Repo detection ──────────────────────
    _step(1, "Repository")

    repo_root = _find_repo_root()
    if not repo_root:
        print("  BERIL repository not found in current directory tree.")
        clone_url = "https://github.com/kbaseincubator/BERIL-research-observatory.git"
        if _confirm(f"  Clone it into {Path.cwd() / 'BERIL-research-observatory'}?"):
            print(f"  Cloning {clone_url} ...")
            result = subprocess.run(
                ["git", "clone", clone_url],
                check=False,
            )
            if result.returncode != 0:
                print("  ERROR: git clone failed. Check your network and try again.")
                return 1
            repo_root = Path.cwd() / "BERIL-research-observatory"
            os.chdir(repo_root)
            print(f"  Cloned to: {repo_root}")
        else:
            print("  To set up manually:")
            print(f"    git clone {clone_url}")
            print("    cd BERIL-research-observatory")
            print("    beril setup")
            return 1

    print(f"  Found repo at: {repo_root}")

    # ── Step 2: .env creation + credential sync ─────
    _step(2, "Environment file (.env)")

    env_path = repo_root / ".env"
    env_example = repo_root / ".env.example"

    # Ensure .env exists
    if not env_path.exists():
        if env_example.exists():
            print("  Creating .env from .env.example...")
            shutil.copy2(env_example, env_path)
        else:
            print("  Creating minimal .env...")
            env_path.write_text("")

    # Sync credentials from environment → .env
    # On JupyterHub these are the freshest source and should always overwrite .env
    _ENV_KEYS = [
        "KBASE_AUTH_TOKEN",
        "MINIO_ACCESS_KEY",
        "MINIO_SECRET_KEY",
        "MINIO_ENDPOINT_URL",
    ]
    synced = []
    for key in _ENV_KEYS:
        live_val = os.environ.get(key, "")
        if live_val:
            _update_env_var(env_path, key, live_val)
            synced.append(key)

    if synced:
        print(f"  Synced from environment: {', '.join(synced)}")

    # Check if KBASE_AUTH_TOKEN ended up set
    env_vars = _parse_env_file(env_path)
    file_token = env_vars.get("KBASE_AUTH_TOKEN", "")
    if not file_token or file_token == "YOUR_AUTH_TOKEN_HERE":
        token = _prompt(
            "  Enter your KBASE_AUTH_TOKEN (from https://narrative.kbase.us/#auth2/account)"
        )
        if token:
            _update_env_var(env_path, "KBASE_AUTH_TOKEN", token)
            print("  Token saved to .env")
        else:
            print("  WARNING: No KBASE_AUTH_TOKEN configured. BERDL commands will fail.")
            print("  Add it to .env later: KBASE_AUTH_TOKEN=your-token-here")
    else:
        print("  KBASE_AUTH_TOKEN is set.")

    # ── Step 3: BERDL environment ───────────────────
    _step(3, "BERDL environment")

    on_cluster = False
    detect_script = repo_root / "scripts" / "detect_berdl_environment.py"
    if detect_script.exists():
        result = subprocess.run(
            [sys.executable, str(detect_script)],
            capture_output=True, text=True, timeout=15, check=False,
        )
        print(result.stdout)
        if result.returncode != 0:
            print("  Some checks failed — see above for next steps.")
        # Parse location for downstream decisions
        try:
            import json
            env_info = json.loads(result.stdout)
            on_cluster = env_info.get("location") == "on-cluster"
        except (json.JSONDecodeError, ValueError):
            pass
    else:
        print("  Detection script not found, skipping.")

    # ── Step 4: BERDL client environment ────────────
    # Off-cluster, the Spark scripts + analysis notebooks run under `uv run` with
    # inline (PEP 723) dependencies, so uv builds and caches their environments on
    # first use — there is no venv to create or activate. The bootstrap step is an
    # optional one-time pre-warm of those caches. On-cluster, Spark is direct.
    _step(4, "BERDL client environment")
    if on_cluster:
        print("  On-cluster — Spark is directly available; nothing to set up.")
    else:
        bootstrap_script = repo_root / "scripts" / "bootstrap_client.sh"
        print("  Off-cluster — uv manages the script/notebook envs automatically (no venv to create).")
        if bootstrap_script.exists() and _confirm(
            "  Pre-warm the uv caches now (one-time; speeds the first query/notebook)?"
        ):
            print("  Pre-warming uv environments...")
            result = subprocess.run(["bash", str(bootstrap_script)], cwd=str(repo_root), check=False)
            if result.returncode != 0:
                print(f"  WARNING: pre-warm failed (exit {result.returncode}); uv will build on first use instead.")
        else:
            print("  Skipped — uv builds the envs on first use.")

    # ── Step 5: GitHub CLI ──────────────────────────
    _step(5, "GitHub CLI")

    rc = subprocess.run(
        ["gh", "auth", "status"],
        capture_output=True, text=True, check=False,
    ).returncode if shutil.which("gh") else -1

    if rc == 0:
        print("  gh is authenticated.")
    elif shutil.which("gh"):
        print("  gh is installed but not authenticated.")
        print("  Run: gh auth login")
    else:
        print("  gh is not installed.")
        print("  Install: https://cli.github.com/")

    # ── Step 6: Profile (optional) ──────────────────
    _step(6, "Profile (optional — press Enter to skip)")

    existing_cfg = config.load()
    user_cfg = existing_cfg.get("user", {})

    detected = detect_user_identity()
    auto_filled = [k for k in ("name", "affiliation", "orcid") if detected.get(k) and not user_cfg.get(k)]
    if auto_filled:
        print(
            "  Auto-detected from JupyterHub / ORCID — press Enter to accept or type to override."
        )

    name = _prompt("  Your name", user_cfg.get("name") or detected.get("name", ""))
    affiliation = _prompt("  Affiliation", user_cfg.get("affiliation") or detected.get("affiliation", ""))
    orcid = _prompt("  ORCID", user_cfg.get("orcid") or detected.get("orcid", ""))

    user_cfg = {}
    if name:
        user_cfg["name"] = name
    if affiliation:
        user_cfg["affiliation"] = affiliation
    if orcid:
        user_cfg["orcid"] = orcid

    # ── Step 7: Coding agent (Pi) ───────────────────
    _step(7, "Coding agent (Pi)")

    pi_found = shutil.which("pi") is not None
    if pi_found:
        print("  ✓ pi detected — beril always launches Pi.")
    else:
        print("  pi not found on PATH. beril is a Pi workbench; install Pi from")
        print("  https://pi.dev, then re-run setup (or `beril start`).")

    # ── Save config ─────────────────────────────────
    cfg: dict = {}
    if user_cfg:
        cfg["user"] = user_cfg
    config.save(cfg)
    print(f"\n  Config saved to {config.CONFIG_PATH}")

    # ── Step 8: Launch ──────────────────────────────
    _step(8, "Launch")

    if pi_found and _confirm("  Launch pi now?"):
        print("\n  Starting pi...\n")
        print_jupyterhub_path_hint(repo_root)
        binary = shutil.which("pi")
        if binary:
            os.chdir(repo_root)
            os.execvp(binary, ["pi"])
        else:
            print("  Error: 'pi' not found on PATH.", file=sys.stderr)
            return 1

    print("\n  Setup complete! Run 'beril start' when you're ready.\n")
    print_jupyterhub_path_hint(repo_root)
    return 0


def _parse_env_file(env_path: Path) -> dict[str, str]:
    """Minimal .env parser."""
    env_vars: dict[str, str] = {}
    if not env_path.exists():
        return env_vars
    for raw_line in env_path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env_vars[key.strip()] = value.strip().strip("'").strip('"')
    return env_vars


def _update_env_var(env_path: Path, key: str, value: str) -> None:
    """Update or insert a key=value pair in a .env file."""
    lines = env_path.read_text().splitlines()
    updated = False
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith(f"{key}="):
            lines[i] = f"{key}={value}"
            updated = True
            break
    if not updated:
        lines.append(f"{key}={value}")
    env_path.write_text("\n".join(lines) + "\n")
