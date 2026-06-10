"""Tests for the `beril notebook` subcommand (scaffold / run / list)."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

import pytest

from beril_cli import notebook_cmd


@pytest.fixture(autouse=True)
def _force_off_cluster(monkeypatch):
    """Default tests to off-cluster so `uv run` is the runner path regardless of
    where the suite runs (CI vs. inside a BERDL pod with berdl_notebook_utils)."""
    monkeypatch.setattr(notebook_cmd, "is_on_cluster", lambda: False)

PLAN = """# Research Plan

## Research Question
Does X correlate with Y?

## Analysis Plan

### Notebook 1: Data Exploration
Load the raw tables and profile the distributions.

### Notebook 2: Correlation Analysis
Compute correlation between X and Y and test significance.

## Expected Outcomes
A clear answer.
"""


def _ns(**kw) -> argparse.Namespace:
    base = dict(action=None, project="demo", notebook=None, from_plan=False, timeout=-1)
    base.update(kw)
    return argparse.Namespace(**base)


def _project(tmp_path: Path, monkeypatch) -> Path:
    (tmp_path / "PROJECT.md").write_text("x")
    project_dir = tmp_path / "projects" / "demo"
    project_dir.mkdir(parents=True)
    monkeypatch.setattr(notebook_cmd, "find_repo_root", lambda: tmp_path)
    return project_dir


# --- scaffold ---------------------------------------------------------------


def test_scaffold_from_plan(tmp_path, monkeypatch, capsys):
    project_dir = _project(tmp_path, monkeypatch)
    (project_dir / "RESEARCH_PLAN.md").write_text(PLAN)

    rc = notebook_cmd.run_notebook(_ns(action="scaffold", from_plan=True))
    out = capsys.readouterr().out
    payload = json.loads(out)  # stdout must be pure JSON

    assert rc == 0
    assert payload["project"] == "demo"
    assert payload["created"] == [
        "notebooks/01_data_exploration.ipynb",
        "notebooks/02_correlation_analysis.ipynb",
    ]
    assert payload["skipped"] == []

    # Two valid nbformat notebooks were written.
    import nbformat

    for rel in payload["created"]:
        nb = nbformat.read(project_dir / rel, as_version=4)
        nbformat.validate(nb)
        assert nb.cells[0].cell_type == "markdown"

    # Title + goal text flow into the first markdown cell.
    nb1 = nbformat.read(project_dir / "notebooks/01_data_exploration.ipynb", as_version=4)
    assert "1. Data Exploration" in nb1.cells[0].source
    assert "profile the distributions" in nb1.cells[0].source


def test_scaffold_idempotent(tmp_path, monkeypatch, capsys):
    project_dir = _project(tmp_path, monkeypatch)
    (project_dir / "RESEARCH_PLAN.md").write_text(PLAN)

    notebook_cmd.run_notebook(_ns(action="scaffold", from_plan=True))
    capsys.readouterr()  # discard first output

    rc = notebook_cmd.run_notebook(_ns(action="scaffold", from_plan=True))
    payload = json.loads(capsys.readouterr().out)
    assert rc == 0
    assert payload["created"] == []
    assert payload["skipped"] == [
        "notebooks/01_data_exploration.ipynb",
        "notebooks/02_correlation_analysis.ipynb",
    ]


def test_scaffold_default_when_no_plan(tmp_path, monkeypatch, capsys):
    project_dir = _project(tmp_path, monkeypatch)  # no RESEARCH_PLAN.md

    rc = notebook_cmd.run_notebook(_ns(action="scaffold"))
    payload = json.loads(capsys.readouterr().out)
    assert rc == 0
    assert payload["created"] == [
        "notebooks/01_data_exploration.ipynb",
        "notebooks/02_analysis.ipynb",
        "notebooks/03_visualization.ipynb",
    ]


def test_scaffold_missing_project_returns_2(tmp_path, monkeypatch, capsys):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(notebook_cmd, "find_repo_root", lambda: tmp_path)
    rc = notebook_cmd.run_notebook(_ns(action="scaffold", project="nope"))
    assert rc == 2
    assert "project not found" in capsys.readouterr().err


# --- list -------------------------------------------------------------------


def test_list_reports_cells_and_outputs(tmp_path, monkeypatch, capsys):
    project_dir = _project(tmp_path, monkeypatch)
    notebooks_dir = project_dir / "notebooks"
    notebooks_dir.mkdir()

    import nbformat
    from nbformat.v4 import new_code_cell, new_markdown_cell, new_notebook, new_output

    # With outputs.
    out_cell = new_code_cell("1 + 1")
    out_cell.outputs = [
        new_output("execute_result", data={"text/plain": "2"}, execution_count=1)
    ]
    nb_out = new_notebook(cells=[new_markdown_cell("# header"), out_cell])
    nbformat.write(nb_out, (notebooks_dir / "01_with_outputs.ipynb").open("w"))

    # Without outputs.
    nb_empty = new_notebook(cells=[new_code_cell("1 + 1"), new_code_cell("2 + 2")])
    nbformat.write(nb_empty, (notebooks_dir / "02_no_outputs.ipynb").open("w"))

    rc = notebook_cmd.run_notebook(_ns(action="list"))
    payload = json.loads(capsys.readouterr().out)
    assert rc == 0
    by_path = {n["path"]: n for n in payload["notebooks"]}
    assert by_path["notebooks/01_with_outputs.ipynb"] == {
        "path": "notebooks/01_with_outputs.ipynb",
        "cells": 2,
        "has_outputs": True,
    }
    assert by_path["notebooks/02_no_outputs.ipynb"] == {
        "path": "notebooks/02_no_outputs.ipynb",
        "cells": 2,
        "has_outputs": False,
    }


# --- run --------------------------------------------------------------------


def test_run_orchestration_all_ok(tmp_path, monkeypatch, capsys):
    """All notebooks succeed → exit 0 and per-notebook ok:true with no error."""
    project_dir = _project(tmp_path, monkeypatch)
    notebooks_dir = project_dir / "notebooks"
    notebooks_dir.mkdir()
    (notebooks_dir / "01_a.ipynb").write_text("{}")
    (notebooks_dir / "02_b.ipynb").write_text("{}")

    def fake_run(argv, **kw):
        class R:
            returncode = 0
            stdout = ""
            stderr = ""

        return R()

    monkeypatch.setattr(notebook_cmd.subprocess, "run", fake_run)
    ns = _ns(action="run", timeout=10)
    ns._with_override = []  # don't resolve the heavy deps in the orchestration test
    rc = notebook_cmd.run_notebook(ns)
    payload = json.loads(capsys.readouterr().out)

    assert rc == 0
    assert payload["project"] == "demo"
    assert payload["ok"] is True
    assert payload["executed"] == [
        {"notebook": "notebooks/01_a.ipynb", "ok": True, "error": None},
        {"notebook": "notebooks/02_b.ipynb", "ok": True, "error": None},
    ]


def test_run_uses_uv_runner(tmp_path, monkeypatch, capsys):
    """The orchestrator invokes `uv run scripts/run_notebook.py NB --timeout N`."""
    project_dir = _project(tmp_path, monkeypatch)
    notebooks_dir = project_dir / "notebooks"
    notebooks_dir.mkdir()
    (notebooks_dir / "01_a.ipynb").write_text("{}")

    seen: dict = {}

    def fake_run(argv, **kw):
        seen["argv"] = argv
        seen["cwd"] = kw.get("cwd")

        class R:
            returncode = 0
            stdout = ""
            stderr = ""

        return R()

    monkeypatch.setattr(notebook_cmd.subprocess, "run", fake_run)
    ns = _ns(action="run", timeout=42)
    ns._with_override = ["--with", "nbclient"]
    notebook_cmd.run_notebook(ns)
    capsys.readouterr()

    argv = seen["argv"]
    assert argv[:2] == ["uv", "run"]
    assert "--with" in argv and "nbclient" in argv
    assert str(tmp_path / "scripts" / "run_notebook.py") in argv
    assert argv[-2:] == ["--timeout", "42"]
    assert seen["cwd"] == tmp_path


def test_run_on_cluster_uses_sys_python(tmp_path, monkeypatch, capsys):
    """On-cluster, the runner is invoked under sys.executable with no `uv run`/`--with`.

    The kernel image already ships pyspark, nbclient/nbformat/ipykernel, and
    berdl_notebook_utils — uv would just rebuild a duplicate env unnecessarily.
    """
    project_dir = _project(tmp_path, monkeypatch)
    notebooks_dir = project_dir / "notebooks"
    notebooks_dir.mkdir()
    (notebooks_dir / "01_a.ipynb").write_text("{}")
    monkeypatch.setattr(notebook_cmd, "is_on_cluster", lambda: True)

    seen: dict = {}

    def fake_run(argv, **kw):
        seen["argv"] = argv

        class R:
            returncode = 0
            stdout = ""
            stderr = ""

        return R()

    monkeypatch.setattr(notebook_cmd.subprocess, "run", fake_run)
    ns = _ns(action="run", timeout=42)
    ns._with_override = ["--with", "nbclient"]  # ignored on-cluster
    notebook_cmd.run_notebook(ns)
    capsys.readouterr()

    argv = seen["argv"]
    assert argv[0] == sys.executable
    assert "uv" not in argv and "--with" not in argv
    assert str(tmp_path / "scripts" / "run_notebook.py") in argv
    assert argv[-2:] == ["--timeout", "42"]


def test_run_continues_on_failing_cell(tmp_path, monkeypatch, capsys):
    """A failing notebook records ok:false and exits 1 without crashing."""
    project_dir = _project(tmp_path, monkeypatch)
    notebooks_dir = project_dir / "notebooks"
    notebooks_dir.mkdir()
    (notebooks_dir / "01_a.ipynb").write_text("{}")

    def fake_run(argv, **kw):
        class R:
            returncode = 1
            stdout = ""
            stderr = "CellExecutionError"

        return R()

    monkeypatch.setattr(notebook_cmd.subprocess, "run", fake_run)
    ns = _ns(action="run", timeout=10)
    ns._with_override = []
    rc = notebook_cmd.run_notebook(ns)
    payload = json.loads(capsys.readouterr().out)
    assert rc == 1
    assert payload["ok"] is False
    assert payload["executed"][0]["ok"] is False
    assert "CellExecutionError" in payload["executed"][0]["error"]


def test_run_missing_project_returns_2(tmp_path, monkeypatch, capsys):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(notebook_cmd, "find_repo_root", lambda: tmp_path)
    ns = _ns(action="run", project="nope")
    ns._with_override = []
    rc = notebook_cmd.run_notebook(ns)
    assert rc == 2
    assert "project not found" in capsys.readouterr().err


@pytest.mark.skipif(shutil.which("uv") is None, reason="uv not available")
def test_run_executes_and_saves_outputs(tmp_path, monkeypatch, capsys):
    """End-to-end: uv resolves only the light PEP 723 deps and runs a 1+1 notebook."""
    project_dir = _project(tmp_path, monkeypatch)
    notebooks_dir = project_dir / "notebooks"
    notebooks_dir.mkdir()

    # `_run` invokes <root>/scripts/run_notebook.py; copy the real PEP 723 runner
    # into the tmp repo so `uv run` resolves only the inline (light) deps.
    from beril_cli.paths import find_repo_root as _real_find_root

    real_root = _real_find_root(Path(__file__).resolve().parent)
    scripts_dir = tmp_path / "scripts"
    scripts_dir.mkdir()
    shutil.copy(real_root / "scripts" / "run_notebook.py", scripts_dir / "run_notebook.py")

    import nbformat
    from nbformat.v4 import new_code_cell, new_notebook

    nb = new_notebook(cells=[new_code_cell("1 + 1")])
    nb.metadata["kernelspec"] = {
        "name": "python3",
        "display_name": "Python 3",
        "language": "python",
    }
    path = notebooks_dir / "01_trivial.ipynb"
    nbformat.write(nb, path.open("w"))

    ns = _ns(action="run", timeout=120)
    ns._with_override = []  # empty --with → uv resolves only nbclient/nbformat/ipykernel
    rc = notebook_cmd.run_notebook(ns)
    payload = json.loads(capsys.readouterr().out)

    assert rc == 0
    assert payload["ok"] is True
    assert payload["executed"] == [
        {"notebook": "notebooks/01_trivial.ipynb", "ok": True, "error": None}
    ]

    # Outputs were saved in place.
    executed = nbformat.read(path, as_version=4)
    code_cells = [c for c in executed.cells if c.cell_type == "code"]
    assert any(c.outputs for c in code_cells)


def test_no_repo_returns_2(monkeypatch, capsys):
    monkeypatch.setattr(notebook_cmd, "find_repo_root", lambda: None)
    rc = notebook_cmd.run_notebook(_ns(action="list"))
    assert rc == 2
    assert "BERIL repo not found" in capsys.readouterr().err
