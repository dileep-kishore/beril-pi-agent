"""beril review — run a CLI reviewer agent over a project and emit {review_file, report_hash}."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

from beril_cli.paths import find_repo_root

_WRITTEN_RE = re.compile(r"^Review written to:\s*(.+)$", re.MULTILINE)
_HASH_RE = re.compile(r"<!--\s*report_hash:\s*(sha256:[0-9a-f]+)\s*-->")


def run_review(args: argparse.Namespace) -> int:
    """Run tools/review.sh and report the produced review file and embedded report hash.

    review.sh writes ``REVIEW_N.md`` and prints ``Review written to: <path>`` on stdout;
    project reviews embed a ``<!-- report_hash: sha256:... -->`` footer in that file.
    """
    root = find_repo_root()
    if root is None:
        print("BERIL repo not found (no PROJECT.md on path).", file=sys.stderr)
        return 2
    script = root / "tools" / "review.sh"
    argv = ["bash", str(script), args.project, "--type", args.type, "--reviewer", args.reviewer]
    if getattr(args, "model", None):
        argv += ["--model", args.model]
    proc = subprocess.run(argv, cwd=str(root), capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr or proc.stdout)
        return proc.returncode if proc.returncode in (1, 2) else 1

    match = _WRITTEN_RE.search(proc.stdout)
    if not match:
        sys.stderr.write(proc.stdout + proc.stderr)
        print("review produced no output path", file=sys.stderr)
        return 1
    review_file = match.group(1).strip()

    report_hash: str | None = None
    try:
        content = Path(review_file).read_text()
    except OSError:
        content = ""
    hash_match = _HASH_RE.search(content)
    if hash_match:
        report_hash = hash_match.group(1)

    json.dump({"review_file": review_file, "report_hash": report_hash}, sys.stdout)
    sys.stdout.write("\n")
    return 0
