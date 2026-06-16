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
    sub.add_parser("doctor", help="Check environment health")

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
        "action", choices=["status", "set", "approve", "marker", "current", "session-state"]
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

        return run_doctor()

    if args.command == "setup":
        from beril_cli.setup_cmd import run_setup

        return run_setup()

    if args.command == "start":
        from beril_cli.start import run_start

        return run_start(
            extra_args=remaining,
            version=args.version,
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

    if args.command == "user":
        from beril_cli.user_cmd import run_user

        return run_user(args)

    return 0


if __name__ == "__main__":
    sys.exit(main())
