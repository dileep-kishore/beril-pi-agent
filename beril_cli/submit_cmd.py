"""beril submit — upload an approved project to the lakehouse (2 = partial = failure)."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys

from beril_cli.paths import find_repo_root


def run_submit(args: argparse.Namespace) -> int:
    """Run tools/lakehouse_upload.py for a project and map its exit-code contract.

    Exit-code contract (from lakehouse_upload.py):
      0 = full success     → emit the manifest JSON, return 0
      1 = hard failure     → no JSON (error already on stderr), return 1
      2 = partial upload   → emit the manifest JSON + ``"partial": true``, return 2
                             (partial is treated as a submission failure)
    """
    root = find_repo_root()
    if root is None:
        print("BERIL repo not found (no PROJECT.md on path).", file=sys.stderr)
        return 2
    script = root / "tools" / "lakehouse_upload.py"
    proc = subprocess.run(
        [sys.executable, str(script), args.project],
        cwd=str(root),
        capture_output=True,
        text=True,
        check=False,
    )

    if proc.returncode == 1:
        sys.stderr.write(proc.stderr or proc.stdout)
        return 1
    if proc.returncode not in (0, 2):
        sys.stderr.write(proc.stderr or proc.stdout)
        return 1

    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError:
        sys.stderr.write(proc.stdout + proc.stderr)
        return 1

    if proc.returncode == 2:
        payload["partial"] = True
    json.dump(payload, sys.stdout, default=str)
    sys.stdout.write("\n")
    return proc.returncode
