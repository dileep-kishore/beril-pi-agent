"""beril lifecycle — command the project lifecycle state machine.

Actions:
  status <project>            Emit the project's beril.yaml as JSON.
  set <project> <state>       Apply a machine-checked transition; emit new status JSON.
  approve <project> ...       Write the `approval` block (--orcid --report-hash --review --review-hash).
  marker <project> --kind ..  Write SUBMITTED.md or SUBMISSION_FAILED.md.
  current                     Emit {project, status} of the active project, or {} if none.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from beril_cli import config
from beril_cli.lifecycle import LifecycleError, load_project, save_project, set_status
from beril_cli.paths import find_repo_root

_MARKER_FILES = {"submitted": "SUBMITTED.md", "failed": "SUBMISSION_FAILED.md"}
_AUTHOR_FIELDS = ("name", "affiliation", "orcid")


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _authors_from_config() -> list[dict[str, str]]:
    """The single author block from `beril user` config, or [] when no name is set."""
    cfg = config.load()
    user = cfg.get("user", {}) if isinstance(cfg, dict) else {}
    fields = {f: (user.get(f, "") or "").strip() for f in _AUTHOR_FIELDS}
    if not fields["name"]:
        return []
    return [{f: fields[f] for f in _AUTHOR_FIELDS if fields[f]}]


def _init_exploration(project_dir: Path) -> None:
    """Seed a new project's `beril.yaml` at `exploration` (the implicit start state).

    Called when a transition is requested on a project directory that exists but
    has no state file yet — so the first `exploration → proposed` move succeeds
    instead of erroring on a missing file.
    """
    now = _now()
    proj: dict[str, object] = {
        "project_id": project_dir.name,
        "status": "exploration",
        "created_at": now,
        "last_session_at": now,
        "branch": f"projects/{project_dir.name}",
        "engine": {"name": "pi"},
    }
    authors = _authors_from_config()
    if authors:
        proj["authors"] = authors
    save_project(project_dir, proj)


def _find_current_project(projects_dir: Path) -> dict[str, str] | None:
    """The active project: the most-recently-touched one not yet `complete`.

    Scans `projects/*/beril.yaml`, skips finished projects, and picks the latest by
    file mtime (robust even when `last_session_at` isn't maintained). Returns
    `{project, status}` or None when there is no active project.
    """
    if not projects_dir.is_dir():
        return None
    best: tuple[float, str, str] | None = None
    for child in sorted(projects_dir.iterdir()):
        yaml_path = child / "beril.yaml"
        if not yaml_path.is_file():
            continue
        try:
            proj = load_project(child)
        except LifecycleError:
            continue
        status = str(proj.get("status", ""))
        if status == "complete":
            continue  # finished — not the active working project
        project_id = str(proj.get("project_id", child.name))
        mtime = yaml_path.stat().st_mtime
        if best is None or mtime > best[0]:
            best = (mtime, project_id, status)
    return None if best is None else {"project": best[1], "status": best[2]}


def run_lifecycle(args: argparse.Namespace) -> int:
    root = find_repo_root()
    if root is None:
        print("BERIL repo not found (no PROJECT.md on path).", file=sys.stderr)
        return 2

    # `current` takes no project argument — resolve it before the per-project actions.
    if args.action == "current":
        result = _find_current_project(root / "projects")
        json.dump(result or {}, sys.stdout)
        sys.stdout.write("\n")
        return 0

    if not args.project:
        print(f"lifecycle {args.action} requires a <project>.", file=sys.stderr)
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
            # A brand-new project (dir exists, no state file yet) starts at
            # exploration — seed it so the first transition doesn't error.
            if not (project_dir / "beril.yaml").exists():
                if not project_dir.is_dir():
                    print(f"project not found: {project_dir}", file=sys.stderr)
                    return 2
                _init_exploration(project_dir)
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
