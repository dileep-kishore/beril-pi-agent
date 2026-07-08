"""Pure-Python data-validity profiling for `beril validate` (import-safe, tested).

Profiles a list of flat row objects (what ``berdl_query`` returns) and surfaces
the traps a numeric summary hides: not-measured zeros, numbers stored as strings,
degenerate variance, underpowered axes, and pseudoreplication. It informs; it
never blocks — the human decides.
"""

from __future__ import annotations

import math
import statistics
from typing import Any

_MISSING_TOKENS = {"", "na", "n/a", "none", "unknown", "missing"}
_ZERO_SENTINEL_FRAC = 0.3
_NUMERIC_AS_STRING_FRAC = 0.9
_TINY_VARIANCE_MIN_ROWS = 10
_PSEUDOREP_RATIO = 5


def is_missing(value: Any) -> bool:
    """True for None, NaN, empty string, or a recognized missing-like token."""
    if value is None:
        return True
    if isinstance(value, float) and math.isnan(value):
        return True
    if isinstance(value, str):
        return value.strip().lower() in _MISSING_TOKENS
    return False


def _to_float(value: Any) -> float | None:
    """Return value as float when castable, else None (bool excluded — not numeric data)."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return None if isinstance(value, float) and math.isnan(value) else float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return None
    return None


def _infer_dtype(values: list[Any]) -> str:
    """Infer a column dtype from its non-missing raw values."""
    if not values:
        return "empty"
    types = {type(v) for v in values}
    if types == {bool}:
        return "bool"
    if types <= {int} and bool not in types:
        return "int"
    if types <= {int, float}:
        return "float"
    if types == {str}:
        return "string"
    return "mixed"


def _columns(rows: list[dict[str, Any]]) -> list[str]:
    """Ordered union of keys across rows (first-seen order)."""
    seen: dict[str, None] = {}
    for row in rows:
        for key in row:
            seen.setdefault(key, None)
    return list(seen)


def profile(rows: list[dict[str, Any]], group_col: str | None = None, axis: str | None = None) -> dict:
    """Profile rows and return the validation payload (columns, findings, verdict)."""
    n_rows = len(rows)
    columns: list[dict] = []
    findings: list[dict] = []
    flags_by_col: dict[str, list[str]] = {}

    def add_finding(check: str, severity: str, column: str | None, detail: str) -> None:
        findings.append({"check": check, "severity": severity, "column": column, "detail": detail})
        if column is not None:
            flags_by_col.setdefault(column, [])
            if check not in flags_by_col[column]:
                flags_by_col[column].append(check)

    for name in _columns(rows):
        raw = [row.get(name) for row in rows]
        present = [v for v in raw if not is_missing(v)]
        null_frac = round(1.0 - len(present) / n_rows, 4) if n_rows else 0.0
        distinct = len({v for v in present})
        dtype = _infer_dtype(present)
        numeric = [f for f in (_to_float(v) for v in present) if f is not None]

        if dtype in ("int", "float") and numeric:
            zeros = sum(1 for f in numeric if f == 0.0)
            zeros_frac = zeros / len(numeric)
            nonzero = [f for f in numeric if f != 0.0]
            if zeros_frac >= _ZERO_SENTINEL_FRAC and nonzero:
                add_finding(
                    "zero-sentinel", "warn", name,
                    f"{round(zeros_frac * 100)}% exact zeros — 0 may mean not-measured",
                )
            if len(numeric) > _TINY_VARIANCE_MIN_ROWS and statistics.pstdev(numeric) <= 1e-9:
                add_finding("tiny-variance", "info", name, "near-zero variance (stdev ≈ 0)")

        if dtype == "string" and present:
            castable = sum(1 for v in present if _to_float(v) is not None)
            frac = castable / len(present)
            if frac >= _NUMERIC_AS_STRING_FRAC:
                add_finding(
                    "numeric-as-string", "warn", name,
                    f"{round(frac * 100)}% of values are numeric strings — "
                    "lexicographic ordering inverts numeric comparisons",
                )

        columns.append(
            {
                "name": name,
                "dtype": dtype,
                "null_frac": null_frac,
                "distinct": distinct,
                "flags": flags_by_col.get(name, []),
            }
        )

    if axis is not None:
        counts: dict[Any, int] = {}
        for row in rows:
            v = row.get(axis)
            if not is_missing(v):
                counts[v] = counts.get(v, 0) + 1
        effective = len(counts)
        singletons = [str(k) for k, c in counts.items() if c == 1]
        if effective < 3:
            add_finding("axis", "warn", axis, f"axis '{axis}': {effective} effective group(s) (<3) — underpowered")
        elif singletons:
            add_finding(
                "axis", "warn", axis,
                f"axis '{axis}': group(s) with n=1 ({', '.join(singletons)}) — no within-group replication",
            )

    if group_col is not None:
        groups = len({row.get(group_col) for row in rows if not is_missing(row.get(group_col))})
        if groups and n_rows / groups >= _PSEUDOREP_RATIO:
            add_finding(
                "pseudoreplication", "warn", group_col,
                f"{n_rows} rows collapse to {groups} independent group(s); analyze at the group grain",
            )

    verdict = "warn" if any(f["severity"] == "warn" for f in findings) else "pass"
    # Re-read flags in case axis/group findings landed after the column was appended.
    for col in columns:
        col["flags"] = flags_by_col.get(col["name"], [])
    return {"n_rows": n_rows, "columns": columns, "findings": findings, "verdict": verdict}
