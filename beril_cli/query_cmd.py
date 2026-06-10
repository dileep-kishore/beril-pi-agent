"""beril query — run a bounded read-only SQL query and emit the result payload as JSON."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from beril_cli.paths import find_repo_root
from scripts.detect_berdl_environment import find_on_cluster_python, is_on_cluster


def run_query(args: argparse.Namespace) -> int:
    """Run scripts/run_sql.py with a temp --output and re-emit clean JSON to stdout.

    The underlying script pollutes stdout/stderr with ``[hub]`` chatter, so its JSON
    is routed to a temp file (per the subcommand I/O contract) and re-emitted here.

    On-cluster (BERDL JupyterHub) the script runs under the system Python at
    ``/opt/conda/bin/python3`` (via ``find_on_cluster_python``) so it can see the
    kernel-installed ``berdl_notebook_utils`` and ``pyspark`` — ``sys.executable``
    would point at the project's uv-managed ``.venv`` when beril was launched via
    ``uv run``, which has neither. The proxy chain is also skipped — Spark is
    reachable on the internal master. Off-cluster falls back to ``uv run`` (PEP
    723 deps) with ``--berdl-proxy``.
    """
    root = find_repo_root()
    if root is None:
        print("BERIL repo not found (no PROJECT.md on path).", file=sys.stderr)
        return 2
    script = root / "scripts" / "run_sql.py"
    on_cluster = is_on_cluster()
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "result.json"
        if on_cluster:
            argv = [find_on_cluster_python(), str(script)]
        else:
            argv = ["uv", "run", str(script)]
        argv += [
            "--query", args.query,
            "--limit", str(args.limit),
            "--output", str(out),
        ]
        if getattr(args, "proxy", True) and not on_cluster:
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
