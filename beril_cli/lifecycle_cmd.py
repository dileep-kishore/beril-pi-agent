"""beril lifecycle — command the project lifecycle state machine.

Actions:
  status <project>            Emit the project's beril.yaml as JSON.
  set <project> <state>       Apply a machine-checked transition; emit new status JSON.
  approve <project> ...       Write the `approval` block (--orcid --report-hash --review --review-hash).
  marker <project> --kind ..  Write SUBMITTED.md or SUBMISSION_FAILED.md.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone

from beril_cli.lifecycle import LifecycleError, load_project, save_project, set_status
from beril_cli.paths import find_repo_root

_MARKER_FILES = {"submitted": "SUBMITTED.md", "failed": "SUBMISSION_FAILED.md"}


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def run_lifecycle(args: argparse.Namespace) -> int:
    root = find_repo_root()
    if root is None:
        print("BERIL repo not found (no PROJECT.md on path).", file=sys.stderr)
        return 2
    project_dir = root / "projects" / args.project

    try:
        if args.action == "status":
            proj = load_project(project_dir)
            json.dump(proj, sys.stdout, default=str)
            sys.stdout.write("\n")
            return 0

        if args.action == "set":
            if not args.state:
                print("set requires a target <state>.", file=sys.stderr)
                return 2
            new_status = set_status(project_dir, args.state)
            json.dump({"status": new_status}, sys.stdout)
            sys.stdout.write("\n")
            return 0

        if args.action == "approve":
            proj = load_project(project_dir)
            # Canonical approval key order: by, at, report_hash, review, review_hash.
            approval = {
                "by": args.orcid,
                "at": _now(),
                "report_hash": args.report_hash,
                "review": args.review,
                "review_hash": args.review_hash,
            }
            # Keep history of any prior approval.
            if proj.get("approval"):
                proj.setdefault("previous_approvals", []).append(proj["approval"])
            proj["approval"] = approval
            save_project(project_dir, proj)
            json.dump({"approval": approval}, sys.stdout, default=str)
            sys.stdout.write("\n")
            return 0

        if args.action == "marker":
            if args.kind not in _MARKER_FILES:
                print("marker requires --kind submitted|failed.", file=sys.stderr)
                return 2
            if not project_dir.is_dir():
                print(f"project not found: {project_dir}", file=sys.stderr)
                return 2
            filename = _MARKER_FILES[args.kind]
            (project_dir / filename).write_text(
                f"# {filename.removesuffix('.md').replace('_', ' ').title()}\n\n"
                f"Written by `beril lifecycle marker` at {_now()}.\n"
            )
            json.dump({"marker": filename}, sys.stdout)
            sys.stdout.write("\n")
            return 0

    except LifecycleError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    print(f"unknown lifecycle action: {args.action}", file=sys.stderr)
    return 2
