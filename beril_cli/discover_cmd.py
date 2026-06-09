"""beril discover — introspect accessible BERDL collections and emit the snapshot as JSON."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from beril_cli.paths import find_repo_root


def run_discover(args: argparse.Namespace) -> int:
    """Run scripts/discover_berdl_collections.py and re-emit its snapshot JSON to stdout.

    The script writes its snapshot to ``--output`` and prints only a summary line, so
    the snapshot is routed to a temp file (per the subcommand I/O contract) and
    re-emitted here.
    """
    root = find_repo_root()
    if root is None:
        print("BERIL repo not found (no PROJECT.md on path).", file=sys.stderr)
        return 2
    script = root / "scripts" / "discover_berdl_collections.py"
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "snapshot.json"
        argv = ["uv", "run", str(script), "--output", str(out)]
        if getattr(args, "database", None):
            argv += ["--database", args.database]
        if getattr(args, "max_databases", None) is not None:
            argv += ["--max-databases", str(args.max_databases)]
        proc = subprocess.run(argv, cwd=str(root), capture_output=True, text=True, check=False)
        if proc.returncode != 0:
            sys.stderr.write(proc.stderr or proc.stdout)
            return proc.returncode if proc.returncode in (1, 2) else 1
        try:
            payload = json.loads(out.read_text())
        except (OSError, json.JSONDecodeError) as exc:
            print(f"discover produced no JSON output: {exc}", file=sys.stderr)
            return 1
    json.dump(payload, sys.stdout, default=str)
    sys.stdout.write("\n")
    return 0
