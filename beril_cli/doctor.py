"""beril doctor — environment health check."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


def _find_repo_root() -> Path | None:
    """Walk up from cwd looking for PROJECT.md (repo marker)."""
    current = Path.cwd()
    for parent in [current, *current.parents]:
        if (parent / "PROJECT.md").exists():
            return parent
    return None


def _parse_env_file(env_path: Path) -> dict[str, str]:
    """Minimal .env parser — returns key-value pairs."""
    env_vars: dict[str, str] = {}
    if not env_path.exists():
        return env_vars
    for raw_line in env_path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        if key:
            env_vars[key] = value
    return env_vars


def _run_silent(cmd: list[str], timeout: int = 10, env: dict | None = None) -> tuple[int, str, str]:
    """Run a command and return (returncode, stdout, stderr)."""
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout, check=False,
            env=env,
        )
        return result.returncode, result.stdout, result.stderr
    except FileNotFoundError:
        return -1, "", f"{cmd[0]}: command not found"
    except subprocess.TimeoutExpired:
        return -1, "", f"{cmd[0]}: timed out"


def _check(name: str, ok: bool, detail: str, fix: str = "", optional: bool = False) -> dict:
    """One doctor result: {name, ok, detail, fix, optional}."""
    return {"name": name, "ok": ok, "detail": detail, "fix": fix, "optional": optional}


def collect_checks() -> list[dict]:
    """Run every environment check and return a list of {name, ok, detail, fix, optional}."""
    checks: list[dict] = []

    # 1. Repo root
    repo_root = _find_repo_root()
    if repo_root:
        checks.append(_check("Repo root", True, str(repo_root)))
    else:
        checks.append(
            _check(
                "Repo root", False, "PROJECT.md not found in any parent directory",
                fix="cd into the BERIL repo (the directory containing PROJECT.md)",
            )
        )

    # 2. Python
    rc, stdout, _ = _run_silent([sys.executable, "--version"])
    if rc == 0:
        checks.append(_check("Python", True, stdout.strip()))
    else:
        checks.append(_check("Python", False, "python3 not available", fix="install Python ≥ 3.11"))

    # 3. Git
    rc, stdout, _ = _run_silent(["git", "--version"])
    if rc == 0:
        checks.append(_check("Git", True, stdout.strip()))
    else:
        checks.append(_check("Git", False, "git not available", fix="install git"))

    # 4. gh CLI (optional)
    rc, _, _ = _run_silent(["gh", "auth", "status"])
    if rc == 0:
        checks.append(_check("gh auth", True, "authenticated", optional=True))
    else:
        installed = bool(shutil.which("gh"))
        msg = "not authenticated" if installed else "gh not installed"
        fix = "gh auth login" if installed else "brew install gh && gh auth login"
        checks.append(_check("gh auth", False, msg, fix=fix, optional=True))

    # 5. KBASE_AUTH_TOKEN — check both .env file and process environment
    env_token = os.environ.get("KBASE_AUTH_TOKEN", "")
    token_fix = "add KBASE_AUTH_TOKEN=<your token> to .env (or export it)"
    if repo_root:
        env_path = repo_root / ".env"
        env_vars = _parse_env_file(env_path)
        file_token = env_vars.get("KBASE_AUTH_TOKEN", "")
        if file_token and file_token != "YOUR_AUTH_TOKEN_HERE":
            checks.append(_check("KBASE_AUTH_TOKEN", True, "present in .env"))
        elif env_token:
            checks.append(_check("KBASE_AUTH_TOKEN", True, "present in environment"))
        elif not env_path.exists():
            checks.append(_check("KBASE_AUTH_TOKEN", False, ".env file missing", fix=token_fix))
        else:
            checks.append(_check("KBASE_AUTH_TOKEN", False, "not set in .env or environment", fix=token_fix))
    elif env_token:
        checks.append(_check("KBASE_AUTH_TOKEN", True, "present in environment"))
    else:
        checks.append(_check("KBASE_AUTH_TOKEN", False, "not found in environment", fix=token_fix))

    # 6. Agent CLIs (optional)
    agents_found = [agent for agent in ("pi", "claude", "codex", "gemini") if shutil.which(agent)]
    if agents_found:
        checks.append(_check("Agent CLIs", True, ", ".join(agents_found), optional=True))
    else:
        checks.append(
            _check(
                "Agent CLIs", False, "none found (pi, claude, codex, gemini)",
                fix="install Pi (the beril workbench agent)", optional=True,
            )
        )

    # 7. BERDL environment (optional)
    if repo_root:
        detect_script = repo_root / "scripts" / "detect_berdl_environment.py"
        if detect_script.exists():
            # Pass .env values via environment so the detect script sees them and
            # doesn't write back to .env — doctor is read-only.
            detect_env = os.environ.copy()
            for k, v in _parse_env_file(repo_root / ".env").items():
                detect_env.setdefault(k, v)
            rc, stdout, _ = _run_silent([sys.executable, str(detect_script)], timeout=15, env=detect_env)
            try:
                env_info = json.loads(stdout)
                location = env_info.get("location", "unknown")
                ready = env_info.get("ready", False)
                detail = f"{location}, {'ready' if ready else 'not ready'}"
                next_steps = [] if ready else list(env_info.get("next_steps", []))
                if next_steps:
                    detail = detail + " — " + "; ".join(next_steps)
                checks.append(
                    _check(
                        "BERDL environment", bool(ready), detail,
                        fix="" if ready else (next_steps[0] if next_steps else ""), optional=True,
                    )
                )
            except (json.JSONDecodeError, KeyError):
                checks.append(
                    _check("BERDL environment", False, "detection script returned invalid output", optional=True)
                )
        else:
            checks.append(_check("BERDL environment", False, "detection script not found", optional=True))
    else:
        checks.append(_check("BERDL environment", False, "cannot check without repo root", optional=True))

    return checks


def run_doctor(as_json: bool = False) -> int:
    """Run all environment checks; render a table (or JSON) and return 0/1."""
    checks = collect_checks()
    overall_ok = all(c["ok"] for c in checks if not c["optional"])

    if as_json:
        json.dump({"ok": overall_ok, "checks": checks}, sys.stdout, default=str)
        sys.stdout.write("\n")
        return 0 if overall_ok else 1

    print()
    print("BERIL Environment Check")
    print("=" * 60)
    for c in checks:
        status = "PASS" if c["ok"] else ("WARN" if c["optional"] else "FAIL")
        color = {"PASS": "\033[32m", "FAIL": "\033[31m", "WARN": "\033[33m"}.get(status, "")
        reset = "\033[0m" if color else ""
        print(f"  {color}{status:4s}{reset}  {c['name']:<20s} {c['detail']}")
        if not c["ok"] and c["fix"]:
            print(f"            fix: {c['fix']}")
    print()

    return 0 if overall_ok else 1
