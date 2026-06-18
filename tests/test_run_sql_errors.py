"""Tests for sanitized BERDL SQL runner errors."""

from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("run_sql", ROOT / "scripts" / "run_sql.py")
run_sql = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(run_sql)


def test_permission_error_is_sanitized():
    msg = run_sql.sanitized_query_error(
        RuntimeError(
            "Traceback...\nAccessControlException: org.apache.hadoop.fs.s3a.auth.NoAuthWithAWSException: secret details"
        ),
        on_cluster=False,
    )
    assert "authorization" in msg.lower() or "permission" in msg.lower()
    assert "stop" in msg.lower()
    assert "NoAuthWithAWSException" not in msg
    assert "secret details" not in msg


def test_missing_token_is_auth_guidance():
    msg = run_sql.sanitized_query_error(RuntimeError("KBASE_AUTH_TOKEN is required."), on_cluster=False)
    assert "KBASE_AUTH_TOKEN" in msg
    assert "beril setup" in msg or "/berdl-status" in msg


def test_connectivity_guidance_stays_distinct():
    msg = run_sql.sanitized_query_error(RuntimeError("UNAVAILABLE: RETRIES_EXCEEDED"), on_cluster=False)
    assert "unreachable" in msg.lower()
    assert "Spark Connect" in msg


def test_query_errors_keep_original_summary():
    msg = run_sql.sanitized_query_error(RuntimeError("[TABLE_OR_VIEW_NOT_FOUND] db.t missing"), on_cluster=False)
    assert "TABLE_OR_VIEW_NOT_FOUND" in msg
