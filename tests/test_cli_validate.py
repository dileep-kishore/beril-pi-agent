"""Tests for `beril validate` profiling and command wrapper."""

from __future__ import annotations

import argparse
import json

from beril_cli import validate_cmd
from beril_cli.validate import profile


def _finding(result, check):
    return next((f for f in result["findings"] if f["check"] == check), None)


def _col(result, name):
    return next(c for c in result["columns"] if c["name"] == name)


def test_zero_sentinel_flags_measured_zeros():
    rows = [{"x": v} for v in (0, 0, 0, 5, 7, 9)]
    result = profile(rows)
    f = _finding(result, "zero-sentinel")
    assert f is not None and f["severity"] == "warn" and f["column"] == "x"
    assert "not-measured" in f["detail"]
    assert "zero-sentinel" in _col(result, "x")["flags"]
    assert result["verdict"] == "warn"


def test_zero_sentinel_ignores_all_zero_column():
    # No nonzero spread → not a sentinel, just a constant.
    result = profile([{"x": 0} for _ in range(6)])
    assert _finding(result, "zero-sentinel") is None


def test_numeric_as_string_lexicographic_trap():
    rows = [{"ph": s} for s in ("1", "2", "10", "20", "7.5")]
    result = profile(rows)
    f = _finding(result, "numeric-as-string")
    assert f is not None and f["severity"] == "warn"
    assert _col(result, "ph")["dtype"] == "string"
    assert result["verdict"] == "warn"


def test_tiny_variance_is_info_not_warn():
    rows = [{"c": 3.0} for _ in range(12)]
    result = profile(rows)
    f = _finding(result, "tiny-variance")
    assert f is not None and f["severity"] == "info"
    # info alone does not flip the verdict to warn.
    assert result["verdict"] == "pass"


def test_pseudoreplication_warns_on_low_group_count():
    rows = [{"y": i, "subject": "s1"} for i in range(10)]
    result = profile(rows, group_col="subject")
    f = _finding(result, "pseudoreplication")
    assert f is not None and f["severity"] == "warn"
    assert "group grain" in f["detail"]


def test_pseudoreplication_quiet_when_groups_are_independent():
    rows = [{"y": i, "subject": f"s{i}"} for i in range(10)]
    result = profile(rows, group_col="subject")
    assert _finding(result, "pseudoreplication") is None


def test_axis_underpowered_when_fewer_than_three_groups():
    rows = [{"g": g} for g in ("A", "A", "B", "B")]
    result = profile(rows, axis="g")
    f = _finding(result, "axis")
    assert f is not None and "underpowered" in f["detail"]


def test_axis_flags_singleton_group():
    rows = [{"g": g} for g in ("A", "A", "B", "B", "C")]
    result = profile(rows, axis="g")
    f = _finding(result, "axis")
    assert f is not None and "n=1" in f["detail"]


def test_null_frac_counts_missing_tokens():
    rows = [{"v": x} for x in ("1", "", "NA", "n/a", None, "5")]
    result = profile(rows)
    col = _col(result, "v")
    # 4 of 6 are missing-like.
    assert col["null_frac"] == round(4 / 6, 4)


def test_clean_data_passes():
    rows = [{"a": i, "b": f"lab-{i}"} for i in range(5)]
    result = profile(rows)
    assert result["verdict"] == "pass" and result["findings"] == []


# ── command wrapper ──────────────────────────────────────


def test_run_validate_reads_rows_json(tmp_path, capsys):
    path = tmp_path / "rows.json"
    path.write_text(json.dumps([{"x": 0}, {"x": 0}, {"x": 0}, {"x": 5}]))
    args = argparse.Namespace(rows_json=str(path), group_col=None, axis=None)
    rc = validate_cmd.run_validate(args)
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and out["n_rows"] == 4 and out["verdict"] == "warn"


def test_run_validate_rejects_non_array(tmp_path, capsys):
    path = tmp_path / "rows.json"
    path.write_text(json.dumps({"not": "an array"}))
    args = argparse.Namespace(rows_json=str(path), group_col=None, axis=None)
    rc = validate_cmd.run_validate(args)
    assert rc == 2
    assert "array" in capsys.readouterr().err.lower()


def test_run_validate_missing_file_returns_2(tmp_path, capsys):
    args = argparse.Namespace(rows_json=str(tmp_path / "nope.json"), group_col=None, axis=None)
    rc = validate_cmd.run_validate(args)
    assert rc == 2
