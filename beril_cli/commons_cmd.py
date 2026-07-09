"""beril commons — land / query / list the cross-project knowledge commons.

Verbs:
  land <project> --kind finding|lesson|gap --text "..." [--tag t]   One entry.
  land <project> --from-report                                     Extract from report artifacts.
  query --q "<text>" [--k 5]                                       tf-idf cosine search.
  list [--project <id>] [--kind <k>]                               Filtered manifest.
"""

from __future__ import annotations

import argparse
import json
import sys

from beril_cli import commons, config
from beril_cli.paths import find_repo_root


def _by_orcid() -> str:
    cfg = config.load()
    user = cfg.get("user", {}) if isinstance(cfg, dict) else {}
    return (user.get("orcid", "") or "").strip()


def _land(root, project: str, records: list[tuple[str, str, list[str]]]) -> dict:
    """Land (kind, body, tags) tuples; return the landed/skipped summary."""
    by = _by_orcid()
    known = {r.get("sha256", "") for r in commons.read_index(root)}
    landed = 0
    skipped = 0
    by_kind: dict[str, int] = {}
    for kind, body, tags in records:
        record = commons.make_record(kind, body, project=project, by=by, tags=tags)
        if commons.land(root, record, known=known):
            landed += 1
            by_kind[kind] = by_kind.get(kind, 0) + 1
        else:
            skipped += 1
    return {"landed": landed, "skipped_duplicates": skipped, "by_kind": by_kind}


def run_commons(args: argparse.Namespace) -> int:
    root = commons.store_root()

    if args.verb == "query":
        if not args.q:
            print("commons query requires --q <text>.", file=sys.stderr)
            return 2
        result = commons.query(root, args.q, k=args.k)
        json.dump(result, sys.stdout, default=str)
        sys.stdout.write("\n")
        return 0

    if args.verb == "list":
        records = commons.read_index(root)
        if args.filter_project:
            records = [r for r in records if r.get("project") == args.filter_project]
        if args.kind:
            records = [r for r in records if r.get("kind") == args.kind]
        json.dump({"records": records}, sys.stdout, default=str)
        sys.stdout.write("\n")
        return 0

    if args.verb == "land":
        if not args.project:
            print("commons land requires a <project>.", file=sys.stderr)
            return 2
        if args.from_report:
            repo = find_repo_root()
            if repo is None:
                print("BERIL repo not found (no PROJECT.md on path).", file=sys.stderr)
                return 2
            project_dir = repo / "projects" / args.project
            if not project_dir.is_dir():
                print(f"project not found: {project_dir}", file=sys.stderr)
                return 2
            extracted = commons.extract_from_report(project_dir)
            records = [
                (kind, body, [])
                for kind in commons.KINDS
                for body in extracted.get(kind, [])
            ]
            summary = _land(root, args.project, records)
            json.dump(summary, sys.stdout, default=str)
            sys.stdout.write("\n")
            return 0
        if args.kind not in commons.KINDS:
            print("commons land requires --kind finding|lesson|gap.", file=sys.stderr)
            return 2
        if not args.text:
            print("commons land requires --text (or --from-report).", file=sys.stderr)
            return 2
        summary = _land(root, args.project, [(args.kind, args.text, args.tag or [])])
        json.dump(summary, sys.stdout, default=str)
        sys.stdout.write("\n")
        return 0

    print(f"unknown commons verb: {args.verb}", file=sys.stderr)
    return 2
