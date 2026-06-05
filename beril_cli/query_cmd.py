"""beril query — run a bounded read-only SQL query and emit the result payload as JSON."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from beril_cli.paths import find_repo_root


def run_query(args: argparse.Namespace) -> int:
    """Run scripts/run_sql.py with a temp --output and re-emit clean JSON to stdout.

    The underlying script pollutes stdout/stderr with ``[hub]`` chatter, so its JSON
    is routed to a temp file (per the subcommand I/O contract) and re-emitted here.
    """
    root = find_repo_root()
    if root is None:
        print("BERIL repo not found (no PROJECT.md on path).", file=sys.stderr)
        return 2
    script = root / "scripts" / "run_sql.py"
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "result.json"
        argv = [
            "uv", "run", str(script),
            "--query", args.query,
            "--limit", str(args.limit),
            "--output", str(out),
        ]
        if getattr(args, "proxy", True):
            argv.append("--berdl-proxy")
        proc = subprocess.run(argv, cwd=str(root), capture_output=True, text=True, check=False)
        if proc.returncode != 0:
            sys.stderr.write(proc.stderr or proc.stdout)
            return proc.returncode if proc.returncode in (1, 2) else 1
        try:
            payload = json.loads(out.read_text())
        except (OSError, json.JSONDecodeError) as exc:
            print(f"query produced no JSON output: {exc}", file=sys.stderr)
            return 1
    json.dump(payload, sys.stdout, default=str)
    sys.stdout.write("\n")
    return 0
