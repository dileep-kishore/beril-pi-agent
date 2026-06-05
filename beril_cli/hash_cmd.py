"""beril hash — emit notebook content hashes for a project as JSON."""

from __future__ import annotations

import argparse
import subprocess
import sys

from beril_cli.paths import find_repo_root


def run_hash(args: argparse.Namespace) -> int:
    """Run tools/notebook_hash.py compute-hashes and pass its JSON through to stdout.

    notebook_hash.py already prints a single-line, ``sha256:``-prefixed JSON object
    (per the subcommand I/O contract), so it is re-emitted verbatim.
    """
    root = find_repo_root()
    if root is None:
        print("BERIL repo not found (no PROJECT.md on path).", file=sys.stderr)
        return 2
    script = root / "tools" / "notebook_hash.py"
    project_dir = root / "projects" / args.project
    proc = subprocess.run(
        [sys.executable, str(script), "compute-hashes", str(project_dir)],
        cwd=str(root),
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr or proc.stdout)
        return proc.returncode if proc.returncode in (1, 2) else 1
    sys.stdout.write(proc.stdout)
    if not proc.stdout.endswith("\n"):
        sys.stdout.write("\n")
    return 0
