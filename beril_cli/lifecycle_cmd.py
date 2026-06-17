"""beril lifecycle — command the project lifecycle state machine.

Actions:
  status <project>            Emit the project's beril.yaml as JSON.
  set <project> <state>       Apply a machine-checked transition; emit new status JSON.
  approve <project> ...       Write the `approval` block (--orcid --report-hash --review --review-hash).
  marker <project> --kind ..  Write SUBMITTED.md or SUBMISSION_FAILED.md.
  current                     Emit {project, status} of the active project, or {} if none.
  session-state <project>     Store (--set <json>) or read (--get) the research_state snapshot.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from beril_cli import config
from beril_cli.lifecycle import LifecycleError, load_project, save_project, set_status
from beril_cli.paths import find_repo_root

_MARKER_FILES = {"submitted": "SUBMITTED.md", "failed": "SUBMISSION_FAILED.md"}
_AUTHOR_FIELDS = ("name", "affiliation", "orcid")
_HASH_PREFIX = "sha256:"


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


def _sha256_file(path: Path) -> str:
    return _HASH_PREFIX + hashlib.sha256(path.read_bytes()).hexdigest()


def _report_hash_footer(review_text: str) -> str | None:
    for line in reversed([l.strip() for l in review_text.splitlines() if l.strip()]):
        if line.startswith("<!-- report_hash: ") and line.endswith(" -->"):
            return line.removeprefix("<!-- report_hash: ").removesuffix(" -->")
    return None


def _validate_analysis_gate(project_dir: Path) -> None:
    report = project_dir / "REPORT.md"
    if not report.is_file():
        raise LifecycleError("active → analysis requires REPORT.md")
    claims = project_dir / "claims.json"
    if not claims.is_file():
        raise LifecycleError("active → analysis requires claims.json from claim_state")
    try:
        payload = json.loads(claims.read_text())
    except json.JSONDecodeError as exc:
        raise LifecycleError(f"claims.json is invalid JSON: {exc}") from exc
    rows = payload.get("rows") if isinstance(payload, dict) else None
    if not isinstance(rows, list) or not rows:
        raise LifecycleError("claims.json must contain at least one claim row")
    for row in rows:
        if not isinstance(row, dict) or not row.get("claim_id") or not row.get("claim"):
            raise LifecycleError("claims.json rows require claim_id and claim")
        if "supports" not in row or "refutes" not in row:
            raise LifecycleError("claims.json rows require supports and refutes arrays")


def _validate_approval(project_dir: Path, args: argparse.Namespace) -> None:
    proj = load_project(project_dir)
    if proj.get("status") != "reviewed":
        raise LifecycleError("approval requires project status reviewed")
    if not args.orcid:
        raise LifecycleError("approval requires --orcid")
    report = project_dir / "REPORT.md"
    if not report.is_file():
        raise LifecycleError("approval requires REPORT.md")
    current_report_hash = _sha256_file(report)
    if args.report_hash != current_report_hash:
        raise LifecycleError("approval report_hash is stale or incorrect")
    if not args.review:
        raise LifecycleError("approval requires --review")
    review_path = (find_repo_root() / args.review).resolve() if find_repo_root() else Path(args.review)
    if not review_path.is_file() or project_dir.resolve() not in review_path.parents:
        raise LifecycleError("approval review must be an existing file under the project")
    review_text = review_path.read_text()
    if _report_hash_footer(review_text) != current_report_hash:
        raise LifecycleError("approval review footer does not match current REPORT.md")
    current_review_hash = _sha256_file(review_path)
    if args.review_hash != current_review_hash:
        raise LifecycleError("approval review_hash is stale or incorrect")


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

        if args.action == "session-state":
            # Persist / read the small, tool-derived research-state snapshot the
            # TS memory extension flushes before a context compaction. It is a
            # non-authoritative annotation block — `save_project` appends it AFTER
            # the canonical `_KEY_ORDER` keys (incl. any pre-existing `approval`),
            # so it round-trips losslessly without disturbing lifecycle state.
            proj = load_project(project_dir)  # no beril.yaml -> LifecycleError -> rc 2
            if args.get_state:
                json.dump(proj.get("research_state", {}), sys.stdout, default=str)
                sys.stdout.write("\n")
                return 0
            if args.state_json is None:
                print("session-state requires --set <json> or --get.", file=sys.stderr)
                return 2
            try:
                block = json.loads(args.state_json)
            except json.JSONDecodeError as exc:
                print(f"invalid --set JSON: {exc}", file=sys.stderr)
                return 2
            if not isinstance(block, dict):
                print("--set must be a JSON object.", file=sys.stderr)
                return 2
            block["updated_at"] = _now()  # server-stamped, not client-trusted
            proj["research_state"] = block
            save_project(project_dir, proj)
            json.dump({"research_state": block}, sys.stdout, default=str)
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
            if load_project(project_dir).get("status") == "active" and args.state == "analysis":
                _validate_analysis_gate(project_dir)
            new_status = set_status(project_dir, args.state)
            json.dump({"status": new_status}, sys.stdout)
            sys.stdout.write("\n")
            return 0

        if args.action == "approve":
            _validate_approval(project_dir, args)
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
