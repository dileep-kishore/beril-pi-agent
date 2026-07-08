"""beril lifecycle — command the project lifecycle state machine.

Actions:
  status <project>            Emit the project's beril.yaml as JSON.
  set <project> <state>       Apply a machine-checked transition; emit new status JSON.
  approve <project> ...       Write the `approval` block (--orcid --report-hash --review --review-hash).
  marker <project> --kind ..  Write SUBMITTED.md or SUBMISSION_FAILED.md.
  current                     Emit {project, status} of the active project, or {} if none.
  session-state <project>     Store (--set <json>) or read (--get) the research_state snapshot.
  gate <project> ...          Record (--record/--verdict/--note) or override (--override/--reason/--by)
                              a gate verdict in beril.yaml `gates:`, or --list them.
  coherence <project>         Emit the filesystem-only record-currency report.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from beril_cli import config
from beril_cli.lifecycle import LifecycleError, load_project, save_project, set_status
from beril_cli.paths import find_repo_root

_MARKER_FILES = {"submitted": "SUBMITTED.md", "failed": "SUBMISSION_FAILED.md"}
_REPORT_REQUIRED_STATES = {"analysis", "reviewed", "complete"}
_AUTHOR_FIELDS = ("name", "affiliation", "orcid")
_HASH_PREFIX = "sha256:"
_PROVENANCE_FILE = "provenance.json"
_TRACE_FILE = "TRACE.jsonl"
# Mirror lib/project-audit.ts redactForTrace: redact values whose KEY names a secret.
_SECRET_KEY = re.compile(r"(token|secret|password|authorization|api[_-]?key|credential)", re.IGNORECASE)


def _redact(value: object) -> object:
    """Recursively redact dict values whose key matches a secret name."""
    if isinstance(value, dict):
        return {k: "[redacted]" if _SECRET_KEY.search(str(k)) else _redact(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_redact(v) for v in value]
    return value


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _read_json(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        payload = json.loads(path.read_text())
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


def _write_provenance(project_dir: Path, payload: dict) -> None:
    (project_dir / _PROVENANCE_FILE).write_text(
        json.dumps(payload, indent=2, sort_keys=True, default=str) + "\n"
    )


def _research_state(project_dir: Path, proj: dict) -> dict:
    provenance = _read_json(project_dir / _PROVENANCE_FILE)
    state = provenance.get("research_state")
    if isinstance(state, dict):
        return state
    legacy = proj.get("research_state")
    return legacy if isinstance(legacy, dict) else {}


def _append_trace(project_dir: Path, event: str, payload: dict | None = None) -> None:
    row = _redact(
        {
            "at": _now(),
            "project": project_dir.name,
            "event": event,
            **(payload or {}),
        }
    )
    with (project_dir / _TRACE_FILE).open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, sort_keys=True, default=str) + "\n")


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


def _validate_signoff_artifacts(project_dir: Path, args: argparse.Namespace) -> None:
    """Validate the ORCID sign-off artifacts (REPORT.md + review file + their hashes).

    Status-agnostic on purpose: the caller decides WHEN it runs — inline on the
    ``analysis → reviewed`` edge (while status is still ``analysis``) or via the
    standalone ``approve`` action (once ``reviewed``).
    """
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


def _validate_approval(project_dir: Path, args: argparse.Namespace) -> None:
    if load_project(project_dir).get("status") != "reviewed":
        raise LifecycleError("approval requires project status reviewed")
    _validate_signoff_artifacts(project_dir, args)


def _write_approval(project_dir: Path, args: argparse.Namespace) -> dict:
    """Write the canonical ``approval`` block to beril.yaml (archiving any prior
    approval) and append a trace row. Shared by the standalone ``approve`` action
    and the inline ``analysis → reviewed`` sign-off gate."""
    proj = load_project(project_dir)
    # Canonical approval key order: by, at, report_hash, review, review_hash.
    approval = {
        "by": args.orcid,
        "at": _now(),
        "report_hash": args.report_hash,
        "review": args.review,
        "review_hash": args.review_hash,
    }
    if proj.get("approval"):
        proj.setdefault("previous_approvals", []).append(proj["approval"])
    proj["approval"] = approval
    save_project(project_dir, proj)
    _append_trace(project_dir, "lifecycle.approve", {"approval": approval})
    return approval


def _record_gate(project_dir: Path, entry: dict) -> None:
    """Append a gate verdict/override to the `gates:` list and the trace (append-only)."""
    proj = load_project(project_dir)
    gates = proj.get("gates")
    if not isinstance(gates, list):
        gates = []
    gates.append(entry)
    proj["gates"] = gates
    save_project(project_dir, proj)
    _append_trace(project_dir, "lifecycle.gate", {"gate": entry})


def _coherence_report(project_dir: Path, status: str) -> dict:
    """Filesystem-only record-currency check (never trusts agent bookkeeping).

    Reads mtimes off disk to decide whether the recorded artifacts (claims,
    provenance, trace) are current with the report and generated run artifacts.
    """
    checks: list[dict] = []
    report = project_dir / "REPORT.md"
    claims = project_dir / "claims.json"

    if status in _REPORT_REQUIRED_STATES:
        present = report.is_file()
        checks.append(
            {
                "id": "report-present",
                "ok": present,
                "detail": "REPORT.md exists" if present else "REPORT.md missing",
            }
        )
    else:
        checks.append(
            {"id": "report-present", "ok": True, "detail": f"REPORT.md not required at {status or 'unknown'}"}
        )

    if report.is_file() and claims.is_file():
        current = claims.stat().st_mtime >= report.stat().st_mtime
        checks.append(
            {
                "id": "claims-current",
                "ok": current,
                "detail": "claims.json current with REPORT.md" if current else "claims.json older than REPORT.md",
            }
        )
    else:
        checks.append({"id": "claims-current", "ok": True, "detail": "no claims.json/REPORT.md pair to compare"})

    record_mtime = 0.0
    for name in (_PROVENANCE_FILE, _TRACE_FILE):
        artifact = project_dir / name
        if artifact.is_file():
            record_mtime = max(record_mtime, artifact.stat().st_mtime)
    artifacts: list[Path] = []
    notebooks_dir = project_dir / "notebooks"
    if notebooks_dir.is_dir():
        artifacts += sorted(notebooks_dir.glob("*.ipynb"))
    figures_dir = project_dir / "figures"
    if figures_dir.is_dir():
        artifacts += [p for p in sorted(figures_dir.iterdir()) if p.is_file()]
    newer = [p for p in artifacts if p.stat().st_mtime > record_mtime]
    record_behind = len(newer)
    if record_behind:
        newest = max(newer, key=lambda p: p.stat().st_mtime)
        detail = f"provenance {record_behind} artifact(s) behind (newest: {newest.relative_to(project_dir).as_posix()})"
    elif not artifacts:
        detail = "no run artifacts to track"
    else:
        detail = "record current with run artifacts"
    checks.append({"id": "record-current", "ok": record_behind == 0, "detail": detail})

    trace = project_dir / _TRACE_FILE
    has_rows = trace.is_file() and any(line.strip() for line in trace.read_text().splitlines())
    checks.append(
        {
            "id": "trace-present",
            "ok": has_rows,
            "detail": "TRACE.jsonl has rows" if has_rows else "TRACE.jsonl missing or empty",
        }
    )

    return {"ok": all(c["ok"] for c in checks), "checks": checks, "record_behind": record_behind}


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
        mtimes = [yaml_path.stat().st_mtime]
        for artifact in (child / _PROVENANCE_FILE, child / _TRACE_FILE):
            if artifact.is_file():
                mtimes.append(artifact.stat().st_mtime)
        mtime = max(mtimes)
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

        if args.action == "coherence":
            proj = load_project(project_dir)  # no beril.yaml -> LifecycleError -> rc 2
            report = _coherence_report(project_dir, str(proj.get("status", "")))
            json.dump(report, sys.stdout, default=str)
            sys.stdout.write("\n")
            return 0

        if args.action == "gate":
            load_project(project_dir)  # no beril.yaml -> LifecycleError -> rc 2
            if getattr(args, "list", False):
                gates = load_project(project_dir).get("gates")
                json.dump({"gates": gates if isinstance(gates, list) else []}, sys.stdout, default=str)
                sys.stdout.write("\n")
                return 0
            override_id = getattr(args, "override", None)
            record_id = getattr(args, "record", None)
            if override_id:
                by = getattr(args, "by", None)
                if not by:
                    print("gate --override requires --by <orcid>.", file=sys.stderr)
                    return 2
                entry = {
                    "gate": override_id,
                    "override": True,
                    "reason": getattr(args, "reason", None) or "",
                    "by": by,
                    "at": _now(),
                }
                _record_gate(project_dir, entry)
                json.dump({"gate": entry}, sys.stdout, default=str)
                sys.stdout.write("\n")
                return 0
            if record_id:
                verdict = getattr(args, "verdict", None)
                if verdict not in ("pass", "fail"):
                    print("gate --record requires --verdict pass|fail.", file=sys.stderr)
                    return 2
                entry = {"gate": record_id, "verdict": verdict, "note": getattr(args, "note", None) or ""}
                by = getattr(args, "by", None)
                if by:
                    entry["by"] = by
                entry["at"] = _now()
                _record_gate(project_dir, entry)
                json.dump({"gate": entry}, sys.stdout, default=str)
                sys.stdout.write("\n")
                return 0
            print("gate requires --record <id> --verdict ..., --override <id> --by ..., or --list.", file=sys.stderr)
            return 2

        if args.action == "session-state":
            # Persist / read the small, tool-derived research-state snapshot the
            # TS memory extension flushes before context compaction. Keep the CLI
            # contract stable, but store the annotation in provenance.json so
            # beril.yaml remains canonical lifecycle state.
            proj = load_project(project_dir)  # no beril.yaml -> LifecycleError -> rc 2
            if args.get_state:
                json.dump(_research_state(project_dir, proj), sys.stdout, default=str)
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
            # Defense-in-depth: never persist/emit a secret-named field, mirroring
            # the TS redactForTrace guard on the audit-write side.
            block = _redact(block)
            provenance = _read_json(project_dir / _PROVENANCE_FILE)
            provenance.update(
                {
                    "project": args.project,
                    "updated_at": block["updated_at"],
                    "research_state": block,
                }
            )
            _write_provenance(project_dir, provenance)
            _append_trace(project_dir, "provenance.updated", {"research_state": block})
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
            current_status = load_project(project_dir).get("status")
            if current_status == "active" and args.state == "analysis":
                _validate_analysis_gate(project_dir)
            # analysis → reviewed is gated on an explicit ORCID sign-off, validated
            # and written INLINE on the transition so the generic lifecycle_transition
            # tool path cannot reach `reviewed` without a recorded human approval.
            sign_off = current_status == "analysis" and args.state == "reviewed"
            if sign_off:
                _validate_signoff_artifacts(project_dir, args)
            if current_status == "reviewed" and args.state == "complete":
                report = _coherence_report(project_dir, current_status)
                if not report["ok"]:
                    if not getattr(args, "override_coherence", False):
                        failing = ", ".join(c["id"] for c in report["checks"] if not c["ok"])
                        raise LifecycleError(
                            f"reviewed → complete blocked by coherence checks: {failing}. "
                            "Re-run with --override-coherence --reason ... --by ... to proceed."
                        )
                    reason = getattr(args, "reason", None)
                    by = getattr(args, "by", None)
                    if not reason or not by:
                        raise LifecycleError("--override-coherence requires --reason and --by")
                    _record_gate(
                        project_dir,
                        {"gate": "coherence", "override": True, "reason": reason, "by": by, "at": _now()},
                    )
            new_status = set_status(project_dir, args.state)
            _append_trace(project_dir, "lifecycle.set", {"status": new_status})
            result = {"status": new_status}
            if sign_off:
                result["approval"] = _write_approval(project_dir, args)
            json.dump(result, sys.stdout, default=str)
            sys.stdout.write("\n")
            return 0

        if args.action == "approve":
            _validate_approval(project_dir, args)
            approval = _write_approval(project_dir, args)
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
            _append_trace(project_dir, "lifecycle.marker", {"marker": filename})
            json.dump({"marker": filename}, sys.stdout)
            sys.stdout.write("\n")
            return 0

    except LifecycleError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    print(f"unknown lifecycle action: {args.action}", file=sys.stderr)
    return 2
