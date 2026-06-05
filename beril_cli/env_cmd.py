"""beril env — emit BERDL environment readiness as JSON (per the subcommand I/O contract)."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys

from beril_cli.paths import find_repo_root


def run_env(args: argparse.Namespace) -> int:
    """Run scripts/berdl_env.py --json and re-emit its JSON to stdout.

    Always exits 0; readiness is carried in the payload's ``ready`` field.
    """
    root = find_repo_root()
    if root is None:
        print("BERIL repo not found (no PROJECT.md on path).", file=sys.stderr)
        return 2
    script = root / "scripts" / "berdl_env.py"
    proc = subprocess.run(
        [sys.executable, str(script), "--json"],
        cwd=str(root),
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode not in (0, 1):  # detector emits JSON on exit 0
        sys.stderr.write(proc.stderr)
        return 2
    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError:
        sys.stderr.write(proc.stdout + proc.stderr)
        return 2
    json.dump(payload, sys.stdout)
    sys.stdout.write("\n")
    return 0
