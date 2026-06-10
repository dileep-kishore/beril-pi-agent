"""beril notebook — scaffold, run, and list project analysis notebooks as JSON.

This is the execution substrate for the BERIL Jupyter notebook workflow:

  - ``scaffold`` writes numbered skeleton notebooks (via ``nbformat``) parsed from
    the project's ``RESEARCH_PLAN.md`` analysis plan (or a sensible default set).
  - ``run`` executes notebooks in place in a uv-managed env (``uv run`` of
    ``scripts/run_notebook.py``), saving outputs (the BERIL reproducibility
    requirement). No hand-bootstrapped ``.venv-berdl`` is needed.
  - ``list`` reports the notebooks and whether each carries saved outputs.

Per the subcommand I/O contract, each action prints a single JSON object/array to
stdout (then a newline) and routes any human/log chatter to stderr.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

from beril_cli.paths import find_repo_root
from scripts.detect_berdl_environment import is_on_cluster

# Heavy notebook-content deps, layered onto the light PEP 723 runner env via
# `uv run --with`. Mirrors the dependency list in scripts/bootstrap_client.sh.
# uv caches the resolved env per dep-set, so repeat runs are fast.
NOTEBOOK_WITH: list[str] = [
    "--with", "pyspark",
    "--with", "spark_connect_remote @ git+https://github.com/BERDataLakehouse/spark_connect_remote.git",
    "--with", "berdl_remote @ git+https://github.com/BERDataLakehouse/berdl_remote.git",
    "--with", "pandas",
    "--with", "matplotlib",
    "--with", "boto3",
]

# Default analysis plan used when RESEARCH_PLAN.md has no parseable notebooks.
_DEFAULT_NOTEBOOKS: list[tuple[str, str]] = [
    ("Data Exploration", "Load and explore the data available for this project."),
    ("Analysis", "Run the core analysis for the research question."),
    ("Visualization", "Produce figures summarizing the findings."),
]

# `### Notebook 1: Data Exploration` (any heading level, optional `Notebook` word).
_NOTEBOOK_HEADING = re.compile(
    r"^#{1,6}\s*(?:Notebook\s+)?(\d+)\s*[:.\-)]\s*(.+?)\s*$",
    re.IGNORECASE,
)
# Section heading that opens the analysis plan, e.g. `## Analysis Plan`.
_ANALYSIS_HEADING = re.compile(r"^#{1,6}\s*analysis\s+plan\b", re.IGNORECASE)
# Any heading at all (used to detect the end of the analysis-plan section).
_ANY_HEADING = re.compile(r"^#{1,6}\s+\S")


def _slug(title: str) -> str:
    """Turn a notebook title into a filesystem slug (``Data Exploration`` -> ``data_exploration``)."""
    slug = re.sub(r"[^a-z0-9]+", "_", title.lower()).strip("_")
    return slug or "notebook"


def _parse_plan(plan_text: str) -> list[tuple[int, str, str]]:
    """Parse the Analysis Plan section into ``(number, title, goal)`` tuples.

    The analysis plan is the block following an ``Analysis Plan`` heading, up to the
    next same-or-higher section. Within it, each ``### Notebook N: Title`` entry's
    goal is the prose lines following the heading (up to the next notebook heading).
    Returns an empty list if there is no analysis section or no notebook entries.
    """
    lines = plan_text.splitlines()

    # Locate the analysis-plan section bounds.
    start = None
    for i, line in enumerate(lines):
        if _ANALYSIS_HEADING.match(line):
            start = i
            heading_depth = len(line) - len(line.lstrip("#"))
            break
    if start is None:
        return []

    end = len(lines)
    for j in range(start + 1, len(lines)):
        line = lines[j]
        if _ANY_HEADING.match(line):
            depth = len(line) - len(line.lstrip("#"))
            # A notebook entry is a deeper heading and stays inside the section;
            # a same-or-higher heading closes it.
            if depth <= heading_depth and not _NOTEBOOK_HEADING.match(line):
                end = j
                break

    notebooks: list[tuple[int, str, str]] = []
    current: tuple[int, str] | None = None
    goal_lines: list[str] = []

    def _flush() -> None:
        if current is not None:
            num, title = current
            goal = " ".join(s.strip() for s in goal_lines if s.strip()).strip()
            notebooks.append((num, title, goal))

    for line in lines[start + 1 : end]:
        m = _NOTEBOOK_HEADING.match(line)
        if m:
            _flush()
            current = (int(m.group(1)), m.group(2).strip())
            goal_lines = []
        elif current is not None:
            goal_lines.append(line)
    _flush()

    return notebooks


def _setup_source() -> str:
    """Code-cell source for the off-cluster Spark setup, matching get_spark_session."""
    return (
        "# Setup — works off-cluster via the BERDL proxy chain.\n"
        "# On JupyterHub get_spark_session() is injected; locally it is provided\n"
        "# by scripts/get_spark_session.py (on PYTHONPATH in the uv-managed env).\n"
        "from get_spark_session import get_spark_session\n"
        "\n"
        "spark = get_spark_session()"
    )


def _build_notebook(number: int, title: str, goal: str):
    """Return an nbformat v4 notebook node with title + setup + skeleton cells."""
    import nbformat
    from nbformat.v4 import new_code_cell, new_markdown_cell, new_notebook

    header = f"# {number}. {title}"
    if goal:
        header += f"\n\n{goal}"

    cells = [
        new_markdown_cell(header),
        new_code_cell(_setup_source()),
        new_markdown_cell("## Query"),
        new_code_cell(
            "# TODO: query the lakehouse for the data this notebook needs.\n"
            "# df = spark.sql(\"SELECT * FROM <database>.<table> LIMIT 100\")\n"
            "# df.show()"
        ),
        new_markdown_cell("## Analysis"),
        new_code_cell("# TODO: analyze the data (transform, aggregate, test hypotheses)."),
        new_markdown_cell("## Visualization"),
        new_code_cell(
            "# TODO: visualize results; save figures under ../figures/.\n"
            "# import matplotlib.pyplot as plt"
        ),
    ]

    nb = new_notebook(cells=cells)
    nb.metadata["kernelspec"] = {
        "display_name": "Python 3",
        "language": "python",
        "name": "python3",
    }
    nb.metadata["language_info"] = {"name": "python", "mimetype": "text/x-python"}
    # nbformat 5 sets nbformat/nbformat_minor on new_notebook already.
    return nbformat, nb


def _scaffold(root: Path, project: str) -> int:
    project_dir = root / "projects" / project
    if not project_dir.is_dir():
        json.dump({"error": f"project not found: projects/{project}"}, sys.stderr)
        sys.stderr.write("\n")
        return 2

    plan_path = project_dir / "RESEARCH_PLAN.md"
    parsed: list[tuple[int, str, str]] = []
    if plan_path.is_file():
        parsed = _parse_plan(plan_path.read_text(encoding="utf-8"))

    if parsed:
        entries = [(num, title, goal) for num, title, goal in parsed]
    else:
        entries = [(i + 1, title, goal) for i, (title, goal) in enumerate(_DEFAULT_NOTEBOOKS)]

    notebooks_dir = project_dir / "notebooks"
    notebooks_dir.mkdir(parents=True, exist_ok=True)

    created: list[str] = []
    skipped: list[str] = []
    for number, title, goal in entries:
        fname = f"{number:02d}_{_slug(title)}.ipynb"
        rel = f"notebooks/{fname}"
        path = notebooks_dir / fname
        if path.exists():
            skipped.append(rel)
            continue
        nbformat, nb = _build_notebook(number, title, goal)
        with path.open("w", encoding="utf-8") as f:
            nbformat.write(nb, f)
        created.append(rel)

    json.dump({"project": project, "created": created, "skipped": skipped}, sys.stdout)
    sys.stdout.write("\n")
    return 0


def _resolve_notebooks(project_dir: Path, notebook: str | None) -> list[Path] | None:
    """Resolve the notebook(s) to operate on.

    With ``notebook`` given, accept a path or bare name (with/without ``.ipynb``),
    relative to the project's ``notebooks/`` dir or the project dir. Returns None if
    a named notebook cannot be found; otherwise a sorted list of notebook paths.
    """
    notebooks_dir = project_dir / "notebooks"
    if notebook:
        candidates = [
            project_dir / notebook,
            notebooks_dir / notebook,
            notebooks_dir / (notebook if notebook.endswith(".ipynb") else f"{notebook}.ipynb"),
        ]
        for cand in candidates:
            if cand.is_file():
                return [cand]
        return None
    if not notebooks_dir.is_dir():
        return []
    return sorted(notebooks_dir.glob("*.ipynb"))


def _rel(path: Path, project_dir: Path) -> str:
    try:
        return path.relative_to(project_dir).as_posix()
    except ValueError:
        return path.name


def _run(
    root: Path,
    project: str,
    notebook: str | None,
    timeout: int,
    extra_with: list[str] | None = None,
) -> int:
    project_dir = root / "projects" / project
    if not project_dir.is_dir():
        json.dump({"error": f"project not found: projects/{project}"}, sys.stderr)
        sys.stderr.write("\n")
        return 2

    targets = _resolve_notebooks(project_dir, notebook)
    if targets is None:
        json.dump({"error": f"notebook not found: {notebook}"}, sys.stderr)
        sys.stderr.write("\n")
        return 2

    runner = root / "scripts" / "run_notebook.py"
    # On-cluster the kernel image already ships pyspark, nbclient/nbformat/ipykernel,
    # and berdl_notebook_utils — running under sys.executable picks all of that up
    # and avoids a needless uv resolution. Off-cluster we still go through `uv run`
    # so the PEP 723 runner deps plus the heavy `--with` content deps get cached.
    on_cluster = is_on_cluster()
    with_flags = NOTEBOOK_WITH if extra_with is None else extra_with

    executed: list[dict] = []
    for path in targets:
        if on_cluster:
            argv = [sys.executable, str(runner), str(path), "--timeout", str(timeout)]
        else:
            argv = [
                "uv",
                "run",
                *with_flags,
                str(runner),
                str(path),
                "--timeout",
                str(timeout),
            ]
        proc = subprocess.run(argv, capture_output=True, text=True, check=False, cwd=root)
        ok = proc.returncode == 0
        error = None
        if not ok:
            error = (proc.stderr or proc.stdout or f"uv run exited {proc.returncode}").strip()
            sys.stderr.write(error + "\n")
        executed.append({"notebook": _rel(path, project_dir), "ok": ok, "error": error})

    all_ok = all(e["ok"] for e in executed)
    json.dump({"project": project, "executed": executed, "ok": all_ok}, sys.stdout)
    sys.stdout.write("\n")
    return 0 if all_ok else 1


def _list(root: Path, project: str) -> int:
    project_dir = root / "projects" / project
    if not project_dir.is_dir():
        json.dump({"error": f"project not found: projects/{project}"}, sys.stderr)
        sys.stderr.write("\n")
        return 2

    notebooks_dir = project_dir / "notebooks"
    results: list[dict] = []
    if notebooks_dir.is_dir():
        for path in sorted(notebooks_dir.glob("*.ipynb")):
            try:
                nb = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            cells = nb.get("cells", []) or []
            has_outputs = any(
                c.get("cell_type") == "code" and (c.get("outputs") or [])
                for c in cells
            )
            results.append(
                {
                    "path": _rel(path, project_dir),
                    "cells": len(cells),
                    "has_outputs": has_outputs,
                }
            )

    json.dump({"project": project, "notebooks": results}, sys.stdout)
    sys.stdout.write("\n")
    return 0


def run_notebook(args: argparse.Namespace) -> int:
    """Dispatch the ``beril notebook`` action and emit its JSON payload to stdout."""
    root = find_repo_root()
    if root is None:
        json.dump({"error": "BERIL repo not found (no PROJECT.md on path)."}, sys.stderr)
        sys.stderr.write("\n")
        return 2

    if args.action == "scaffold":
        return _scaffold(root, args.project)
    if args.action == "list":
        return _list(root, args.project)
    if args.action == "run":
        # Test seam: an injected `_with_override` (e.g. []) swaps the heavy
        # `--with` deps for a light/empty set so a trivial notebook runs fast.
        extra_with = getattr(args, "_with_override", None)
        return _run(root, args.project, args.notebook, args.timeout, extra_with)

    json.dump({"error": f"unknown action: {args.action}"}, sys.stderr)
    sys.stderr.write("\n")
    return 2
