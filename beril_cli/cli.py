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
        choices=["claude", "codex", "gemini", "pi"],
        default=None,
        help="Agent to launch (default: from config, or claude)",
    )
    start_parser.add_argument(
        "--skip-onboard",
        action="store_true",
        default=False,
        help="Skip the automatic /berdl_start onboarding prompt",
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
    discover_parser.add_argument("--max-databases", type=int, default=None)

    # hash
    hash_parser = sub.add_parser("hash", help="Compute notebook content hashes for a project")
    hash_parser.add_argument("project", help="Project directory name under projects/")

    # export
    export_parser = sub.add_parser("export", help="Export query results to MinIO (destructive)")
    export_parser.add_argument("--query", required=True)
    export_parser.add_argument("--path", required=True)
    export_parser.add_argument("--format", default="parquet")
    export_parser.add_argument("--mode", default="overwrite")
    export_parser.add_argument("--no-proxy", dest="proxy", action="store_false", default=True)

    # review
    review_parser = sub.add_parser("review", help="Run a CLI reviewer agent over a project")
    review_parser.add_argument("project", help="Project directory name under projects/")
    review_parser.add_argument("--type", dest="type", default="project", choices=["project", "plan"])
    review_parser.add_argument("--reviewer", default="claude", choices=["claude", "codex"])
    review_parser.add_argument("--model", default=None)

    # submit
    submit_parser = sub.add_parser("submit", help="Upload an approved project to the lakehouse")
    submit_parser.add_argument("project", help="Project directory name under projects/")

    # lifecycle
    lifecycle_parser = sub.add_parser("lifecycle", help="Command the project lifecycle state machine")
    lifecycle_parser.add_argument("action", choices=["status", "set", "approve", "marker"])
    lifecycle_parser.add_argument("project", help="Project directory name under projects/")
    lifecycle_parser.add_argument("state", nargs="?", default=None, help="Target state (for 'set')")
    lifecycle_parser.add_argument("--orcid", default=None)
    lifecycle_parser.add_argument("--report-hash", dest="report_hash", default=None)
    lifecycle_parser.add_argument("--review", default=None)
    lifecycle_parser.add_argument("--review-hash", dest="review_hash", default=None)
    lifecycle_parser.add_argument("--kind", choices=["submitted", "failed"], default=None)

    # lit
    lit_parser = sub.add_parser("lit", help="Search or fetch literature records")
    lit_parser.add_argument("action", choices=["search", "fetch"])
    lit_parser.add_argument("--query", default=None)
    lit_parser.add_argument("--max", type=int, default=20)
    lit_parser.add_argument("--pmid", default=None)

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
            agent=args.agent,
            extra_args=remaining,
            skip_onboard=args.skip_onboard,
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

    if args.command == "export":
        from beril_cli.export_cmd import run_export

        return run_export(args)

    if args.command == "review":
        from beril_cli.review_cmd import run_review

        return run_review(args)

    if args.command == "submit":
        from beril_cli.submit_cmd import run_submit

        return run_submit(args)

    if args.command == "lifecycle":
        from beril_cli.lifecycle_cmd import run_lifecycle

        return run_lifecycle(args)

    if args.command == "lit":
        from beril_cli.lit_cmd import run_lit

        return run_lit(args)

    if args.command == "user":
        from beril_cli.user_cmd import run_user

        return run_user(args)

    return 0


if __name__ == "__main__":
    sys.exit(main())
