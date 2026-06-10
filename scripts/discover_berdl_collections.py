#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Discover BERDL tenants, databases, tables, and schemas into a UI snapshot.

Off-cluster: invoke as `uv run scripts/discover_berdl_collections.py ...`.
The off-cluster REST path uses only the standard library, so the PEP 723 block
above declares no dependencies and uv runs it in a clean, project-independent
env — no `.venv-berdl` activation required. On-cluster, `berdl_notebook_utils`
is imported opportunistically and supplied by the JupyterHub kernel."""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_BASE_URL = "https://hub.berdl.kbase.us/apis/mcp"

TENANT_NAMES = {
    "kbase": "KBase",
    "kescience": "KE Science",
    "enigma": "ENIGMA",
    "nmdc": "NMDC",
    "phagefoundry": "PhageFoundry",
    "planetmicrobe": "PlanetMicrobe",
    "protect": "PROTECT",
    "globalusers": "Development/Test",
}

# Administrative / scratch namespaces to hide from the user-facing inventory.
# get_databases() / the discovery REST are already access-aware (RBAC-filtered),
# so this is a surface-curation, not a security check: we drop demo/test/
# personal/scratch namespaces and surface everything else. Previously this was a
# hand-maintained allowlist of ~50 ids — it silently hid every database added
# since it was last curated (e.g. plantmicrobeinterfaces_pmi_data, refdata_*,
# planetmicrobe.pangenome). Denylist patterns match the categories the prior
# `visibility_filter_note` already named.
_DENY_TENANT_PREFIXES = ("globalusers",)  # shared scratch / demo / cross-tenant playground
_DENY_LITERALS = frozenset({"default"})


def _is_curated_visible(database_id: str) -> bool:
    """Return True when ``database_id`` should appear in the curated inventory.

    Hides: ``globalusers`` tenant, personal ``u_<userhash>__*`` namespaces, bare
    ``default``, and any namespace whose name marks it as a test / demo /
    startup workspace. Everything else (real tenant databases) passes through.
    """
    if not database_id:
        return False
    low = database_id.lower()
    tenant = low.split("_", 1)[0].split(".", 1)[0]
    if tenant in _DENY_TENANT_PREFIXES:
        return False
    if low.startswith("u_") and "__" in low:
        return False
    if low in _DENY_LITERALS:
        return False
    # Test / demo / startup markers. Match on word-ish boundaries so we don't
    # accidentally hide e.g. `protect_integration` for containing "test".
    for marker in ("test", "demo", "startup"):
        if (
            f"_{marker}_" in low
            or f".{marker}_" in low
            or low.endswith(f"_{marker}")
            or low.endswith(f".{marker}")
            or low.endswith(f"_{marker}s")  # e.g. "_tests"
        ):
            return False
    return True


def read_auth_token(env_path: Path | None = None) -> str | None:
    """Read KBASE_AUTH_TOKEN from environment or a simple .env file."""
    if os.environ.get("KBASE_AUTH_TOKEN"):
        return os.environ["KBASE_AUTH_TOKEN"]
    env_path = env_path or Path(".env")
    if not env_path.exists():
        return None
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() == "KBASE_AUTH_TOKEN":
            return value.strip().strip('"').strip("'")
    return None


def _post_json(url: str, token: str, payload: dict[str, Any], timeout: float) -> Any:
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            # The hub sits behind Cloudflare, which 403s the default
            # "Python-urllib/x.y" agent (error 1010). A curl-style UA passes.
            "User-Agent": "curl/8.7.1",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read()
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code} {exc.reason}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(str(exc.reason)) from exc
    try:
        return json.loads(body.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError("invalid JSON response") from exc


def _load_berdl_helpers() -> Any | None:
    """Returns berdl_notebook_utils on-cluster, None off-cluster."""
    try:
        import berdl_notebook_utils
        return berdl_notebook_utils
    except ImportError:
        return None


def discover_collections(
    *,
    database: str | None = None,
    max_databases: int | None = None,
    token: str | None = None,
    base_url: str = DEFAULT_BASE_URL,
    timeout: float = 30.0,
) -> dict[str, Any]:
    """Discover the accessible BERDL inventory, or one database's tables.

    Two cheap depths — neither scans the whole lakehouse:

    - ``database is None`` (inventory): list accessible databases grouped by
      tenant. One round-trip. No table or schema crawl.
    - ``database`` set (scoped): list that one database's tables (name,
      description, row_count). One round-trip. No schema crawl — use
      ``berdl_peek`` / ``berdl_query`` to read a specific table's columns.

    Uses berdl_notebook_utils on-cluster (access-aware), falling back to the
    REST API off-cluster.
    """
    helpers = _load_berdl_helpers()

    if helpers is not None:
        def _get_databases():
            return _extract_databases(helpers.get_databases())

        def _get_tables(db_id):
            return _extract_tables(helpers.get_tables(db_id))

        discovery_method = "berdl_notebook_utils"
        source_url = "berdl-notebook-utils"
    else:
        if not token:
            raise RuntimeError(
                "berdl_notebook_utils is not available. "
                "Set KBASE_AUTH_TOKEN for off-cluster REST discovery."
            )
        base_url = base_url.rstrip("/")

        def _get_databases():
            return _extract_databases(
                _post_json(
                    f"{base_url}/delta/databases/list", token,
                    {"use_hms": True, "filter_by_namespace": True}, timeout,
                )
            )

        def _get_tables(db_id):
            return _extract_tables(
                _post_json(
                    f"{base_url}/delta/databases/tables/list", token,
                    {"database": db_id, "use_hms": True}, timeout,
                )
            )

        discovery_method = "rest"
        source_url = base_url

    snapshot: dict[str, Any] = {
        "schema_version": 1,
        "source_url": source_url,
        "discovery_method": discovery_method,
        "discovered_at": datetime.now(timezone.utc).isoformat(),
    }

    if database is not None:
        snapshot["scope"] = {"database": database}
        snapshot["tenants"] = [_discover_one_database(database, _get_tables)]
        return snapshot

    databases = sorted(_get_databases(), key=lambda item: item["id"])
    if max_databases is not None:
        databases = databases[:max_databases]

    tenants: dict[str, dict[str, Any]] = {}
    for db in databases:
        tenant_id = db.get("tenant_id") or infer_tenant_id(db["id"])
        tenant = tenants.setdefault(tenant_id, _new_tenant(tenant_id))
        tenant["collections"].append(
            {
                "id": db["id"],
                "name": db.get("name") or title_from_id(db["id"]),
                "description": db.get("description", ""),
                "provider": db.get("provider"),
                "tables": [],
                "discovery_errors": [],
            }
        )

    snapshot["tenants"] = list(tenants.values())
    return snapshot


def _new_tenant(tenant_id: str) -> dict[str, Any]:
    return {
        "id": tenant_id,
        "name": TENANT_NAMES.get(tenant_id, tenant_id.replace("_", " ").title()),
        "collections": [],
    }


def _discover_one_database(database: str, get_tables: Any) -> dict[str, Any]:
    """Scoped depth: one database's tables (no schema crawl), wrapped in a tenant."""
    collection = {
        "id": database,
        "name": title_from_id(database),
        "description": "",
        "provider": None,
        "tables": [],
        "discovery_errors": [],
    }
    try:
        tables = get_tables(database)
    except Exception as exc:
        collection["discovery_errors"].append(f"table list failed: {_format_error(exc)}")
        tables = []
    for table in tables:
        collection["tables"].append(
            {
                "name": table["name"],
                "description": table.get("description", ""),
                "row_count": table.get("row_count"),
                "columns": [],
            }
        )
    tenant = _new_tenant(infer_tenant_id(database))
    tenant["collections"].append(collection)
    return tenant


def write_snapshot_atomic(snapshot: dict[str, Any], output: Path) -> None:
    """Write JSON snapshot atomically to avoid partial config files."""
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        dir=output.parent,
        prefix=f".{output.name}.",
        delete=False,
    ) as handle:
        json.dump(snapshot, handle, indent=2, sort_keys=True)
        handle.write("\n")
        temp_name = handle.name
    Path(temp_name).replace(output)


def filter_user_facing_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
    """Hide administrative / scratch namespaces from the user-facing inventory.

    Backend is RBAC-filtered already; this drops only globalusers / personal /
    test / demo / startup workspaces. Everything else passes through — so newly
    onboarded tenant databases appear without a manual allowlist bump.
    """
    filtered = dict(snapshot)
    filtered_tenants = []
    for tenant in snapshot.get("tenants", []):
        collections = [
            collection
            for collection in tenant.get("collections", [])
            if _is_curated_visible(collection.get("id", ""))
        ]
        if not collections:
            continue
        tenant_record = dict(tenant)
        tenant_record["collections"] = collections
        filtered_tenants.append(tenant_record)
    filtered["tenants"] = filtered_tenants
    filtered["visibility_filter"] = "user_facing_v2"
    filtered["visibility_filter_note"] = (
        "Hides globalusers tenant, personal u_*__* namespaces, bare 'default', "
        "and any *_test_* / *_demo_* / *_startup workspace. Real tenant databases "
        "pass through automatically."
    )
    return filtered


def infer_tenant_id(database_id: str) -> str:
    """Infer tenant from BERDL database naming conventions."""
    if database_id.startswith("u_") and "__" in database_id:
        return database_id.split("__", 1)[0]
    if database_id.startswith("kbase_"):
        return "kbase"
    if database_id.startswith("kescience_"):
        return "kescience"
    return database_id.split("_", 1)[0]


def title_from_id(database_id: str) -> str:
    return database_id.replace("_", " ").title()


def _format_error(exc: Exception, max_length: int = 500) -> str:
    text = " ".join(str(exc).split())
    if len(text) <= max_length:
        return text
    return text[: max_length - 1].rstrip() + "…"


def _extract_databases(payload: Any) -> list[dict[str, Any]]:
    items = _first_list(payload, ("databases", "database", "data", "result", "items"))
    databases = []
    for item in items:
        if isinstance(item, str):
            databases.append({"id": item})
            continue
        if isinstance(item, tuple):
            database_id = item[0] if item else None
            if database_id:
                databases.append(
                    {
                        "id": str(database_id),
                        "name": str(item[1]) if len(item) > 1 and item[1] else None,
                        "description": str(item[2]) if len(item) > 2 and item[2] else "",
                        "provider": None,
                        "tenant_id": None,
                    }
                )
            continue
        if not isinstance(item, dict):
            continue
        database_id = (
            item.get("database")
            or item.get("database_name")
            or item.get("name")
            or item.get("id")
            or item.get("namespace")
        )
        if not database_id:
            continue
        databases.append(
            {
                "id": str(database_id),
                "name": item.get("display_name") or item.get("label"),
                "description": item.get("description") or "",
                "provider": item.get("provider"),
                "tenant_id": item.get("tenant") or item.get("tenant_id"),
            }
        )
    return databases


def _extract_tables(payload: Any) -> list[dict[str, Any]]:
    items = _first_list(payload, ("tables", "table", "data", "result", "items"))
    tables = []
    for item in items:
        if isinstance(item, str):
            tables.append({"name": item})
            continue
        if isinstance(item, tuple):
            table_name = item[0] if item else None
            if table_name:
                tables.append(
                    {
                        "name": str(table_name),
                        "description": str(item[1]) if len(item) > 1 and item[1] else "",
                        "row_count": item[2] if len(item) > 2 else None,
                    }
                )
            continue
        if not isinstance(item, dict):
            continue
        table_name = item.get("table") or item.get("table_name") or item.get("name")
        if not table_name:
            continue
        tables.append(
            {
                "name": str(table_name),
                "description": item.get("description") or "",
                "row_count": item.get("row_count") or item.get("rows"),
            }
        )
    return tables


def _first_list(payload: Any, keys: tuple[str, ...]) -> list[Any]:
    if isinstance(payload, str):
        return [payload]
    if isinstance(payload, tuple):
        return list(payload)
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []
    if _looks_like_record(payload):
        return [payload]
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str):
            return [value]
        if isinstance(value, (list, tuple)):
            return list(value)
        if isinstance(value, dict):
            nested = _first_list(value, keys)
            if nested:
                return nested
    if any(key in payload for key in keys):
        return [payload]
    for value in payload.values():
        if isinstance(value, dict):
            nested = _first_list(value, keys)
            if nested:
                return nested
    return []


def _looks_like_record(payload: dict[str, Any]) -> bool:
    record_keys = {
        "id",
        "name",
        "database_name",
        "namespace",
        "table_name",
        "column",
        "column_name",
        "type",
        "data_type",
    }
    if any(key in payload for key in record_keys):
        return True
    for key in ("database", "table"):
        if key in payload and not isinstance(payload[key], (dict, list, tuple)):
            return True
    return False


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("ui/config/berdl_collections_snapshot.json"),
        help="Snapshot JSON output path.",
    )
    parser.add_argument(
        "--base-url",
        default=DEFAULT_BASE_URL,
        help="BERDL MCP base URL (used for off-cluster REST fallback).",
    )
    parser.add_argument(
        "--timeout", type=float, default=30.0,
        help="REST request timeout in seconds (off-cluster only).",
    )
    parser.add_argument(
        "--database",
        default=None,
        help="Scope to one database: list its tables (no schema crawl). "
        "Omit for the accessible-collections inventory.",
    )
    parser.add_argument(
        "--max-databases",
        type=int,
        help="Optional debugging cap on discovered databases (inventory only).",
    )
    parser.add_argument(
        "--include-non-user-facing",
        action="store_true",
        help="Keep every discovered namespace instead of the curated user-facing set.",
    )
    parser.add_argument(
        "--env-file", type=Path, default=Path(".env"),
        help="Path to .env file containing KBASE_AUTH_TOKEN (off-cluster fallback).",
    )
    args = parser.parse_args(argv)

    token = read_auth_token(args.env_file)
    try:
        snapshot = discover_collections(
            database=args.database,
            max_databases=args.max_databases,
            token=token,
            base_url=args.base_url,
            timeout=args.timeout,
        )
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    # The user-facing curation applies to the broad inventory only; an explicit
    # --database request is honored verbatim.
    if args.database is None and not args.include_non_user_facing:
        snapshot = filter_user_facing_snapshot(snapshot)
    write_snapshot_atomic(snapshot, args.output)
    if args.database is not None:
        table_count = sum(
            len(c["tables"]) for t in snapshot["tenants"] for c in t["collections"]
        )
        print(f"Wrote {table_count} tables for {args.database} to {args.output}")
    else:
        collection_count = sum(len(t["collections"]) for t in snapshot["tenants"])
        print(
            f"Wrote {collection_count} collections across "
            f"{len(snapshot['tenants'])} tenants to {args.output}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
