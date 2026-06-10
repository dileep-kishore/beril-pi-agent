#!/usr/bin/env python3
"""Detect BERDL environment and check prerequisites.

Determines if running on-cluster (BERDL JupyterHub) or off-cluster (local machine).
Checks proxy status, KBASE_AUTH_TOKEN, uv availability, and provides actionable next steps.
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import sys
from pathlib import Path
from typing import Any


def test_connectivity(host: str, port: int, timeout: float = 2.0) -> bool:
    """Test if a host:port is reachable."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except (socket.timeout, socket.error, OSError):
        return False


def is_on_cluster() -> bool:
    """Return True when running inside a BERDL JupyterHub user pod.

    The Hub injects ``berdl_notebook_utils`` into the kernel, so importability is
    a sufficient signal *in the kernel*. But when beril is launched via
    ``uv run beril ...`` the calling process lives in a project-local venv that
    does NOT see ``/opt/conda``'s site-packages, and the import check would
    spuriously report off-cluster. JupyterHub's own env vars
    (``JUPYTERHUB_API_TOKEN`` plus the BERDL-specific ``SPARK_MASTER_URL``)
    propagate into every child process — including isolated venvs — so check
    those first. The import remains as a fallback for kernels whose env
    somehow lost the vars.
    """
    if os.environ.get("JUPYTERHUB_API_TOKEN") and os.environ.get("SPARK_MASTER_URL"):
        return True
    try:
        import berdl_notebook_utils  # noqa: F401
    except ImportError:
        return False
    return True


def find_on_cluster_python() -> str:
    """Return a Python interpreter that can import the BERDL kernel helpers.

    On the BERDL JupyterHub image, ``berdl_notebook_utils`` and ``pyspark`` live
    under ``/opt/conda`` — not in any uv-managed project venv. When beril is
    launched via ``uv run beril start``, ``sys.executable`` points at
    ``.venv/bin/python3`` which can't see those packages. So we route on-cluster
    subprocesses through the system Python when it exists; off-cluster (or on a
    different image) we fall back to ``sys.executable``.
    """
    for candidate in ("/opt/conda/bin/python3", "/opt/conda/bin/python"):
        if Path(candidate).is_file():
            return candidate
    return sys.executable


def check_port_listening(port: int) -> bool:
    """Check if a local port has something listening.

    Dependency-free TCP probe — NOT `lsof`, which isn't installed on minimal
    remote / JupyterHub images (a missing `lsof` used to crash the whole check
    with FileNotFoundError). A successful connect to 127.0.0.1:<port> means
    something is accepting connections there; the SSH SOCKS tunnels and pproxy
    all accept TCP, so this is a reliable "is it up?" signal.
    """
    return test_connectivity("127.0.0.1", port, timeout=0.5)


def load_env_file(env_path: Path) -> dict[str, str]:
    """Load .env file and return key-value pairs."""
    env_vars = {}
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


def save_to_env(env_path: Path, key: str, value: str) -> None:
    """Append or update a key in .env file."""
    existing = load_env_file(env_path)
    existing[key] = value

    with env_path.open("w") as f:
        for k, v in existing.items():
            # Quote values that might have special characters
            if any(c in v for c in [" ", "#", "$", "!", "&"]):
                f.write(f'{k}="{v}"\n')
            else:
                f.write(f"{k}={v}\n")


def detect_environment() -> dict[str, Any]:
    """Detect environment and return status report."""
    repo_root = Path(__file__).resolve().parent.parent
    env_file = repo_root / ".env"

    result: dict[str, Any] = {
        "location": "unknown",
        "ready": False,
        "checks": {},
        "next_steps": [],
    }

    # Test connectivity to BERDL Spark endpoint (informational only; the host is
    # publicly routable, so this alone does not imply on-cluster).
    spark_reachable = test_connectivity("spark.berdl.kbase.us", 443, timeout=2.0)

    if is_on_cluster():
        # On-cluster (BERDL JupyterHub)
        result["location"] = "on-cluster"
        result["checks"]["spark_direct"] = spark_reachable

        # Check for KBASE_AUTH_TOKEN in environment
        token = os.getenv("KBASE_AUTH_TOKEN")
        if token:
            result["checks"]["kbase_token_env"] = True
            # Write to .env if not already there
            env_vars = load_env_file(env_file)
            if "KBASE_AUTH_TOKEN" not in env_vars:
                save_to_env(env_file, "KBASE_AUTH_TOKEN", token)
                result["next_steps"].append(
                    f"✅ Saved KBASE_AUTH_TOKEN to {env_file.relative_to(repo_root)}"
                )
            else:
                result["checks"]["kbase_token_env_file"] = True
            result["ready"] = True
            result["next_steps"].append(
                "✅ On BERDL cluster with direct access. Use scripts without --berdl-proxy."
            )
        else:
            result["checks"]["kbase_token_env"] = False
            result["next_steps"].append(
                "⚠️ KBASE_AUTH_TOKEN not found in environment. "
                "Get your token from https://narrative.kbase.us/#auth2/account "
                "and add it to .env"
            )
    else:
        # Off-cluster (local machine)
        result["location"] = "off-cluster"
        result["checks"]["spark_direct"] = False

        # Check .env for KBASE_AUTH_TOKEN
        env_vars = load_env_file(env_file)
        token_in_env = "KBASE_AUTH_TOKEN" in env_vars and bool(env_vars["KBASE_AUTH_TOKEN"])
        result["checks"]["kbase_token_env_file"] = token_in_env

        if not token_in_env:
            result["next_steps"].append(
                "❌ KBASE_AUTH_TOKEN missing from .env. "
                "Get your token from https://narrative.kbase.us/#auth2/account "
                "and add: KBASE_AUTH_TOKEN=\"your-token-here\""
            )

        # Check uv (used to run scripts via PEP 723 and to launch pproxy via
        # `uv run --with pproxy ...` — no hand-bootstrapped venv required).
        uv_available = shutil.which("uv") is not None
        result["checks"]["uv_available"] = uv_available

        if not uv_available:
            result["next_steps"].append(
                "❌ uv not found on PATH. Install it from https://docs.astral.sh/uv/"
            )

        # Check SSH tunnels
        tunnel_1337 = check_port_listening(1337)
        tunnel_1338 = check_port_listening(1338)
        result["checks"]["ssh_tunnel_1337"] = tunnel_1337
        result["checks"]["ssh_tunnel_1338"] = tunnel_1338

        if not tunnel_1337 or not tunnel_1338:
            missing = []
            if not tunnel_1337:
                missing.append("1337")
            if not tunnel_1338:
                missing.append("1338")
            result["next_steps"].append(
                f"❌ SSH tunnel(s) on port(s) {', '.join(missing)} not running. "
                "Start with: ssh -f -N -o ServerAliveInterval=60 -D <port> ac.<username>@login1.berkeley.kbase.us"
            )

        # Check pproxy
        pproxy_running = check_port_listening(8123)
        result["checks"]["pproxy_8123"] = pproxy_running

        if not pproxy_running:
            result["next_steps"].append(
                "❌ pproxy not running on port 8123. "
                "See skills/berdl-query/SKILL.md for startup instructions."
            )

        # Overall readiness
        result["ready"] = all([
            token_in_env,
            uv_available,
            tunnel_1337,
            tunnel_1338,
            pproxy_running,
        ])

        if result["ready"]:
            result["next_steps"] = [
                "✅ Off-cluster environment fully configured. "
                "Use --berdl-proxy with all scripts."
            ]
        else:
            result["next_steps"].append(
                "\nFull setup guide: skills/berdl-query/SKILL.md"
            )

    return result


def main() -> int:
    """Run detection and print results."""
    result = detect_environment()
    print(json.dumps(result, indent=2))
    return 0 if result["ready"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
