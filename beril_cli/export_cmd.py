"""beril export — export query results to MinIO and emit the manifest as JSON (DESTRUCTIVE)."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from beril_cli.paths import find_repo_root


def run_export(args: argparse.Namespace) -> int:
    """Run scripts/export_sql.py, route its manifest to a temp file, re-emit clean JSON.

    This is a destructive operation (writes to MinIO). The underlying script pollutes
    stdout with ``[hub]`` chatter, so its manifest is routed to a temp ``--manifest``
    file (per the subcommand I/O contract) and re-emitted to stdout here.
    """
    root = find_repo_root()
    if root is None:
        print("BERIL repo not found (no PROJECT.md on path).", file=sys.stderr)
        return 2
    script = root / "scripts" / "export_sql.py"
    with tempfile.TemporaryDirectory() as td:
        manifest = Path(td) / "manifest.json"
        argv = [
            "uv", "run", str(script),
            "--query", args.query,
            "--path", args.path,
            "--format", args.format,
            "--mode", args.mode,
            "--manifest", str(manifest),
        ]
        if getattr(args, "proxy", True):
            argv.append("--berdl-proxy")
        proc = subprocess.run(argv, cwd=str(root), capture_output=True, text=True, check=False)
        if proc.returncode != 0:
            sys.stderr.write(proc.stderr or proc.stdout)
            return proc.returncode if proc.returncode in (1, 2) else 1
        try:
            payload = json.loads(manifest.read_text())
        except (OSError, json.JSONDecodeError) as exc:
            print(f"export produced no manifest JSON: {exc}", file=sys.stderr)
            return 1
    json.dump(payload, sys.stdout, default=str)
    sys.stdout.write("\n")
    return 0
