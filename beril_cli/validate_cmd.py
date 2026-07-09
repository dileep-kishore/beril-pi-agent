"""beril validate — profile query rows for data-validity traps and emit JSON.

Pure/offline mode: reads a JSON array of flat row objects from ``--rows-json``
(no BERDL access) and prints one validation payload on stdout.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from beril_cli.validate import profile


def run_validate(args: argparse.Namespace) -> int:
    path = Path(args.rows_json)
    try:
        rows = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        print(f"cannot read --rows-json: {exc}", file=sys.stderr)
        return 2
    if not isinstance(rows, list) or not all(isinstance(r, dict) for r in rows):
        print("--rows-json must be a JSON array of row objects.", file=sys.stderr)
        return 2
    result = profile(rows, group_col=args.group_col, axis=args.axis)
    json.dump(result, sys.stdout, default=str)
    sys.stdout.write("\n")
    return 0
