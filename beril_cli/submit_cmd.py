"""beril submit — upload an approved project to the lakehouse (2 = partial = failure)."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys

from beril_cli.lifecycle import LifecycleError, load_project
from beril_cli.paths import find_repo_root


def _sha256_file(path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def _report_hash_footer(review_text: str) -> str | None:
    for line in reversed([l.strip() for l in review_text.splitlines() if l.strip()]):
        if line.startswith("<!-- report_hash: ") and line.endswith(" -->"):
            return line.removeprefix("<!-- report_hash: ").removesuffix(" -->")
    return None


def _validate_approved_project(root, project: str) -> None:
    project_dir = root / "projects" / project
    proj = load_project(project_dir)
    if proj.get("status") not in {"reviewed", "complete"}:
        raise LifecycleError("submit requires reviewed or complete project status")
    approval = proj.get("approval")
    if not isinstance(approval, dict):
        raise LifecycleError("submit requires an approval block")
    report = project_dir / "REPORT.md"
    if not report.is_file():
        raise LifecycleError("submit requires REPORT.md")
    current_report_hash = _sha256_file(report)
    if approval.get("report_hash") != current_report_hash:
        raise LifecycleError("approval is stale: REPORT.md changed after approval")
    review_rel = approval.get("review")
    if not isinstance(review_rel, str):
        raise LifecycleError("approval requires a review path")
    review_path = (root / review_rel).resolve()
    if not review_path.is_file() or project_dir.resolve() not in review_path.parents:
        raise LifecycleError("approval review is missing or outside the project")
    review_text = review_path.read_text()
    if _report_hash_footer(review_text) != current_report_hash:
        raise LifecycleError("approval review footer is stale")
    current_review_hash = _sha256_file(review_path)
    if approval.get("review_hash") != current_review_hash:
        raise LifecycleError("approval is stale: review hash changed")


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
    try:
        _validate_approved_project(root, args.project)
    except LifecycleError as exc:
        print(str(exc), file=sys.stderr)
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
