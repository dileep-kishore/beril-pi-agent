"""BERIL CLI — launcher and environment manager for the BERIL Research Observatory."""

import argparse
import sys

from beril_cli import __version__


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="beril",
        description="BERIL Research Observatory — setup, check, and launch your research environment.",
    )
    parser.add_argument("--version", action="version", version=f"beril {__version__}")

    sub = parser.add_subparsers(dest="command")

    # doctor
    doctor_parser = sub.add_parser("doctor", help="Check environment health")
    doctor_parser.add_argument(
        "--json", action="store_true", default=False, help="Emit machine-readable JSON"
    )

    # setup
    sub.add_parser("setup", help="Interactive onboarding wizard")

    # start
    start_parser = sub.add_parser("start", help="Launch a coding agent")
    start_parser.add_argument(
        "--agent",
        choices=["pi"],
        default="pi",
        help="Coding agent to launch. Only 'pi' is supported — beril is a Pi workbench.",
    )
    start_parser.add_argument(
        "--version",
        default=None,
        metavar="VERSION",
        help="Pin to a specific release tag (e.g. v0.3.4.5). Defaults to the latest tag.",
    )
    start_parser.add_argument(
        "--theme",
        default=None,
        metavar="THEME",
        help="Set the Pi theme for this checkout (e.g. beril, phenix, dark, light, or a custom registered theme).",
    )
    start_parser.add_argument(
        "--provider",
        default=None,
        metavar="PROVIDER",
        help="Model provider for this launch. 'cborg' provisions the CBORG profile; other values pass through to Pi.",
    )

    # env
    env_parser = sub.add_parser("env", help="Report BERDL environment readiness")
    env_parser.add_argument(
        "--json",
        action="store_true",
        default=True,
        help="Emit JSON (default)",
    )

    # query
    query_parser = sub.add_parser("query", help="Run a bounded read-only SQL query")
    query_parser.add_argument("--query", required=True)
    query_parser.add_argument("--limit", type=int, default=100)
    query_parser.add_argument("--no-proxy", dest="proxy", action="store_false", default=True)

    # discover
    discover_parser = sub.add_parser("discover", help="Introspect accessible BERDL collections")
    discover_parser.add_argument(
        "--database",
        default=None,
        help="Scope to one database: list its tables (no schema crawl). Omit for the inventory.",
    )
    discover_parser.add_argument("--max-databases", type=int, default=None)

    # hash
    hash_parser = sub.add_parser("hash", help="Compute notebook content hashes for a project")
    hash_parser.add_argument("project", help="Project directory name under projects/")

    # notebook
    notebook_parser = sub.add_parser(
        "notebook", help="Scaffold, run, or list a project's analysis notebooks"
    )
    notebook_parser.add_argument("action", choices=["scaffold", "run", "list"])
    notebook_parser.add_argument("project", help="Project directory name under projects/")
    notebook_parser.add_argument(
        "notebook",
        nargs="?",
        default=None,
        help="Notebook path/name under notebooks/ (for 'run'; default: all)",
    )
    notebook_parser.add_argument(
        "--from-plan",
        dest="from_plan",
        action="store_true",
        default=False,
        help="Scaffold from RESEARCH_PLAN.md's Analysis Plan (for 'scaffold')",
    )
    notebook_parser.add_argument(
        "--timeout",
        type=int,
        default=-1,
        help="Per-cell execution timeout in seconds (for 'run'; default: -1 = none)",
    )
    notebook_parser.add_argument(
        "--resume",
        action="store_true",
        default=False,
        help="For 'run': skip notebooks with prior successful BERIL execution metadata.",
    )

    # export
    export_parser = sub.add_parser("export", help="Export query results to MinIO (destructive)")
    export_parser.add_argument("--query", required=True)
    export_parser.add_argument("--path", required=True)
    export_parser.add_argument("--format", default="parquet")
    export_parser.add_argument("--mode", default="overwrite")
    export_parser.add_argument("--no-proxy", dest="proxy", action="store_false", default=True)

    # submit
    submit_parser = sub.add_parser("submit", help="Upload an approved project to the lakehouse")
    submit_parser.add_argument("project", help="Project directory name under projects/")

    # lifecycle
    lifecycle_parser = sub.add_parser("lifecycle", help="Command the project lifecycle state machine")
    lifecycle_parser.add_argument(
        "action",
        choices=["status", "set", "approve", "marker", "current", "session-state", "gate", "coherence"],
    )
    lifecycle_parser.add_argument(
        "project", nargs="?", default=None, help="Project directory name under projects/ (omit for 'current')"
    )
    lifecycle_parser.add_argument("state", nargs="?", default=None, help="Target state (for 'set')")
    lifecycle_parser.add_argument("--orcid", default=None)
    lifecycle_parser.add_argument("--report-hash", dest="report_hash", default=None)
    lifecycle_parser.add_argument("--review", default=None)
    lifecycle_parser.add_argument("--review-hash", dest="review_hash", default=None)
    lifecycle_parser.add_argument("--kind", choices=["submitted", "failed"], default=None)
    lifecycle_parser.add_argument(
        "--set", dest="state_json", default=None, help="JSON object to store as research_state (for 'session-state')"
    )
    lifecycle_parser.add_argument(
        "--get", dest="get_state", action="store_true", default=False, help="Emit research_state (for 'session-state')"
    )
    # gate / coherence (for 'gate' and reviewed → complete override)
    lifecycle_parser.add_argument("--record", default=None, metavar="GATE_ID", help="Record a verdict for this gate")
    lifecycle_parser.add_argument("--override", default=None, metavar="GATE_ID", help="Record an override for this gate")
    lifecycle_parser.add_argument("--verdict", choices=["pass", "fail"], default=None, help="Verdict (for gate --record)")
    lifecycle_parser.add_argument("--note", default=None, help="Note (for gate --record)")
    lifecycle_parser.add_argument("--by", default=None, help="Recording ORCID (required for an override)")
    lifecycle_parser.add_argument("--reason", default=None, help="Reason (for an override)")
    lifecycle_parser.add_argument(
        "--list", action="store_true", default=False, help="List recorded gates (for 'gate')"
    )
    lifecycle_parser.add_argument(
        "--override-coherence",
        dest="override_coherence",
        action="store_true",
        default=False,
        help="Override a failing coherence check on reviewed → complete (requires --reason and --by)",
    )

    # validate
    validate_parser = sub.add_parser("validate", help="Profile query rows for data-validity traps")
    validate_parser.add_argument(
        "--rows-json", dest="rows_json", required=True, help="Path to a JSON array of flat row objects"
    )
    validate_parser.add_argument("--group-col", dest="group_col", default=None, help="Column to check for pseudoreplication")
    validate_parser.add_argument("--axis", default=None, help="Categorical column to check for group coverage")

    # commons
    commons_parser = sub.add_parser("commons", help="Land / query / list the knowledge commons")
    commons_parser.add_argument("verb", choices=["land", "query", "list"])
    commons_parser.add_argument("project", nargs="?", default=None, help="Project id (for 'land')")
    commons_parser.add_argument("--kind", choices=["finding", "lesson", "gap"], default=None)
    commons_parser.add_argument("--text", default=None, help="Body text (for 'land')")
    commons_parser.add_argument("--tag", action="append", default=None, help="Tag (repeatable, for 'land')")
    commons_parser.add_argument(
        "--from-report", dest="from_report", action="store_true", default=False,
        help="Extract findings/gaps/lessons from the project's report artifacts",
    )
    commons_parser.add_argument("--q", default=None, help="Query text (for 'query')")
    commons_parser.add_argument("--k", type=int, default=5, help="Max matches (for 'query')")
    commons_parser.add_argument(
        "--project", dest="filter_project", default=None, help="Filter by project id (for 'list')"
    )

    # crate
    crate_parser = sub.add_parser("crate", help="Write an RO-Crate metadata file for a project")
    crate_parser.add_argument("project", help="Project directory name under projects/")

    # user
    user_parser = sub.add_parser(
        "user",
        help="Show user identity from ~/.config/beril/config.toml",
    )
    user_parser.add_argument(
        "--json",
        action="store_true",
        default=False,
        help="Emit machine-readable JSON",
    )

    args, remaining = parser.parse_known_args(argv)

    if args.command is None:
        parser.print_help()
        return 0

    if args.command == "doctor":
        from beril_cli.doctor import run_doctor

        return run_doctor(as_json=args.json)

    if args.command == "setup":
        from beril_cli.setup_cmd import run_setup

        return run_setup()

    if args.command == "start":
        from beril_cli.start import run_start

        return run_start(
            extra_args=remaining,
            version=args.version,
            theme=args.theme,
            provider=args.provider,
        )

    if args.command == "env":
        from beril_cli.env_cmd import run_env

        return run_env(args)

    if args.command == "query":
        from beril_cli.query_cmd import run_query

        return run_query(args)

    if args.command == "discover":
        from beril_cli.discover_cmd import run_discover

        return run_discover(args)

    if args.command == "hash":
        from beril_cli.hash_cmd import run_hash

        return run_hash(args)

    if args.command == "notebook":
        from beril_cli.notebook_cmd import run_notebook

        return run_notebook(args)

    if args.command == "export":
        from beril_cli.export_cmd import run_export

        return run_export(args)

    if args.command == "submit":
        from beril_cli.submit_cmd import run_submit

        return run_submit(args)

    if args.command == "lifecycle":
        from beril_cli.lifecycle_cmd import run_lifecycle

        return run_lifecycle(args)

    if args.command == "validate":
        from beril_cli.validate_cmd import run_validate

        return run_validate(args)

    if args.command == "commons":
        from beril_cli.commons_cmd import run_commons

        return run_commons(args)

    if args.command == "crate":
        from beril_cli.crate_cmd import run_crate

        return run_crate(args)

    if args.command == "user":
        from beril_cli.user_cmd import run_user

        return run_user(args)

    return 0


if __name__ == "__main__":
    sys.exit(main())
