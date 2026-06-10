#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "pyspark",
#   "spark_connect_remote @ git+https://github.com/BERDataLakehouse/spark_connect_remote.git",
#   "berdl_remote @ git+https://github.com/BERDataLakehouse/berdl_remote.git",
# ]
# ///
"""Run SQL on BERDL Spark from a local machine *or* the on-cluster JupyterHub.

Off-cluster: invoke as `uv run scripts/run_sql.py --berdl-proxy --query "..."`.
uv resolves the PEP 723 dependencies above on first run, no `.venv-berdl`
activation required.

On-cluster: invoke under the kernel's system Python (no `uv run`); the script
detects ``berdl_notebook_utils`` and uses its local-cluster ``get_spark_session``
instead of the Spark Connect public ingress, which does not terminate at the
user's in-pod Spark master."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any


def _is_on_cluster() -> bool:
    """True when running inside a BERDL JupyterHub user pod.

    Mirrors scripts/detect_berdl_environment.is_on_cluster — duplicated here so the
    script stays self-contained when run via ``uv run`` (which does not put the repo
    on ``sys.path``). Checks JupyterHub env vars first so the signal survives a
    project-local uv venv where ``berdl_notebook_utils`` is not importable; the
    import remains as a kernel-side fallback.
    """
    if os.environ.get("JUPYTERHUB_API_TOKEN") and os.environ.get("SPARK_MASTER_URL"):
        return True
    try:
        import berdl_notebook_utils  # noqa: F401
        return True
    except ImportError:
        return False


def load_env_file(env_path: Path) -> None:
    if not env_path.exists():
        return
    for raw_line in env_path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        if key and key not in os.environ:
            os.environ[key] = value


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Execute SQL through spark_connect_remote.")
    parser.add_argument("--query", help="SQL query text.")
    parser.add_argument("--query-file", help="Path to a SQL file.")
    parser.add_argument(
        "--limit",
        type=int,
        default=100,
        help="Apply a post-query row limit for safe local return. Use --limit -1 to disable.",
    )
    parser.add_argument("--output", help="Optional output JSON path.")
    parser.add_argument("--app-name", default="berdl-local-query", help="Spark app name.")
    parser.add_argument(
        "--host-template",
        help="Spark Connect host template. Defaults to BERDL_SPARK_HOST_TEMPLATE or spark.berdl.kbase.us.",
    )
    parser.add_argument(
        "--port",
        type=int,
        help="Spark Connect port. Defaults to BERDL_SPARK_PORT or 443.",
    )
    parser.add_argument(
        "--no-ssl",
        action="store_true",
        help="Disable SSL for Spark Connect (for local/port-forward scenarios).",
    )
    parser.add_argument("--grpc-proxy", help="Set grpc_proxy for Spark Connect traffic.")
    parser.add_argument(
        "--https-proxy",
        help="Set https_proxy for HTTP clients (including token validation).",
    )
    parser.add_argument("--no-proxy", help="Set no_proxy value.")
    parser.add_argument(
        "--berdl-proxy",
        action="store_true",
        help="Use BERDL proxy defaults: spark.berdl.kbase.us + grpc/https proxy http://127.0.0.1:8123.",
    )
    parser.add_argument(
        "--env-file",
        default=".env",
        help="Optional dotenv file to load before reading environment variables.",
    )
    parser.add_argument(
        "--kbase-token",
        help="Optional explicit token. Defaults to KBASE_AUTH_TOKEN env var.",
    )
    return parser.parse_args()


def resolve_query(args: argparse.Namespace) -> str:
    if args.query and args.query_file:
        raise ValueError("Use only one of --query or --query-file.")
    if args.query_file:
        return Path(args.query_file).read_text()
    if args.query:
        return args.query
    raise ValueError("Provide --query or --query-file.")


def bound_spark_retries() -> None:
    """Cap Spark Connect's retry budget *before* a session is built.

    PySpark's ``DefaultPolicy`` retries an ``UNAVAILABLE`` endpoint for ~10
    minutes, which for an interactive query just looks like a hang — and it
    outlives the caller's own timeout, so the failure surfaces as empty output
    instead of a real error. The first RPC fires inside ``getOrCreate()`` (while
    applying session options), so the cap has to be installed up front by
    patching the policy that ``SparkConnectClient`` instantiates, not on the
    returned client. A non-serving Spark Connect server then raises a clear
    ``[RETRIES_EXCEEDED]`` within seconds. Override with ``BERDL_QUERY_MAX_RETRIES``
    when a flaky cluster needs more patience.
    """
    try:
        from pyspark.sql.connect.client import core

        base = core.DefaultPolicy
        max_retries = int(os.getenv("BERDL_QUERY_MAX_RETRIES", "5"))

        class _BoundedDefaultPolicy(base):  # type: ignore[misc, valid-type]
            def __init__(self, **kwargs: Any) -> None:
                kwargs.setdefault("max_retries", max_retries)
                kwargs.setdefault("max_backoff", 8000)
                super().__init__(**kwargs)

        core.DefaultPolicy = _BoundedDefaultPolicy
    except Exception:
        # Unrecognised pyspark internals — leave the default retry behavior in place.
        pass


def apply_proxy_settings(args: argparse.Namespace) -> None:
    if args.berdl_proxy:
        if args.host_template is None:
            args.host_template = "spark.berdl.kbase.us"
        if args.grpc_proxy is None:
            args.grpc_proxy = "http://127.0.0.1:8123"
        if args.https_proxy is None:
            args.https_proxy = "http://127.0.0.1:8123"
        if args.no_proxy is None:
            args.no_proxy = "localhost,127.0.0.1"

    if args.grpc_proxy:
        os.environ["grpc_proxy"] = args.grpc_proxy
    if args.https_proxy:
        os.environ["https_proxy"] = args.https_proxy
    if args.no_proxy:
        os.environ["no_proxy"] = args.no_proxy


def main() -> int:
    args = parse_args()
    load_env_file(Path(args.env_file))

    on_cluster = _is_on_cluster()
    if not on_cluster:
        apply_proxy_settings(args)

    token = args.kbase_token or os.getenv("KBASE_AUTH_TOKEN")
    if not token and not on_cluster:
        # On-cluster, berdl_notebook_utils builds the session against the user's
        # local Spark master and does not require a KBase token at this layer.
        print("KBASE_AUTH_TOKEN is required.", file=sys.stderr)
        return 2

    host_template = args.host_template or os.getenv(
        "BERDL_SPARK_HOST_TEMPLATE", "spark.berdl.kbase.us"
    )
    port = args.port or int(os.getenv("BERDL_SPARK_PORT", "443"))
    use_ssl = not args.no_ssl

    try:
        query = resolve_query(args).strip().rstrip(";")
    except Exception as exc:
        print(f"Failed to load query: {exc}", file=sys.stderr)
        return 2

    if not query:
        print("Query cannot be empty.", file=sys.stderr)
        return 2

    if on_cluster:
        try:
            from berdl_notebook_utils import get_spark_session as _on_cluster_session
        except Exception as exc:
            print(f"Cannot import berdl_notebook_utils: {exc}", file=sys.stderr)
            return 2
    else:
        try:
            from spark_connect_remote import create_spark_session
        except Exception as exc:
            print(f"Cannot import spark_connect_remote: {exc}", file=sys.stderr)
            return 2
        bound_spark_retries()
        if args.berdl_proxy:
            try:
                from get_spark_session import ensure_hub
                ensure_hub()
            except Exception as exc:
                print(f"[hub] auto-spawn skipped: {exc}", file=sys.stderr)

    try:
        if on_cluster:
            spark = _on_cluster_session(app_name=args.app_name)
        else:
            spark = create_spark_session(
                host_template=host_template,
                port=port,
                use_ssl=use_ssl,
                kbase_token=token,
                app_name=args.app_name,
            )
        df = spark.sql(query)
        if args.limit is not None and args.limit >= 0:
            df = df.limit(args.limit)
        rows = [row.asDict(recursive=True) for row in df.collect()]
    except Exception as exc:
        msg = str(exc)
        if not on_cluster and ("RETRIES_EXCEEDED" in msg or "UNAVAILABLE" in msg):
            # Not a SQL error: the Spark Connect endpoint never answered. Make the
            # distinction explicit so it isn't mistaken for a bad query.
            print(
                "Query failed: the BERDL Spark Connect server is unreachable "
                "(retries exhausted). Its JupyterHub server may not be running — "
                "check `berdl-remote status` and that the SSH tunnels + pproxy are "
                "up, then retry.",
                file=sys.stderr,
            )
        else:
            print(f"Query failed: {exc}", file=sys.stderr)
        return 1

    payload: dict[str, Any] = {
        "query": query,
        "on_cluster": on_cluster,
        "host_template": None if on_cluster else host_template,
        "port": None if on_cluster else port,
        "use_ssl": None if on_cluster else use_ssl,
        "grpc_proxy": os.getenv("grpc_proxy"),
        "https_proxy": os.getenv("https_proxy"),
        "no_proxy": os.getenv("no_proxy"),
        "limit_applied": None if args.limit is not None and args.limit < 0 else args.limit,
        "returned_rows": len(rows),
        "rows": rows,
    }

    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(payload, indent=2, default=str))
        print(f"Wrote {len(rows)} rows to {output_path}")
    else:
        print(json.dumps(payload, indent=2, default=str))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
