# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "nbclient",
#   "nbformat",
#   "ipykernel",
# ]
# ///
"""Execute a single notebook in place via nbclient (uv-managed env).

This is the headless execution worker for ``beril notebook run``. It is a PEP 723
script: ``uv run scripts/run_notebook.py NOTEBOOK`` builds a cached env from the
inline deps above (light: nbclient/nbformat/ipykernel). The heavy notebook-content
deps (pyspark, berdl_remote, ...) are layered on by the caller via ``uv run --with``.

The notebook's ``python3`` kernel auto-resolves to this uv env's interpreter because
``ipykernel`` is present — no kernelspec registration is needed. The repo ``scripts/``
dir is prepended to ``PYTHONPATH`` so the notebook's
``from get_spark_session import get_spark_session`` resolves inside the kernel.

Outputs are saved back to the notebook file (the BERIL reproducibility requirement).
stdout is kept clean; the orchestrator builds the JSON. On success exit 0; on any
execution error write a concise message to stderr and exit 1.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import nbformat
from nbclient import NotebookClient
from nbclient.exceptions import CellExecutionError


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("notebook", help="Path to the .ipynb to execute in place")
    parser.add_argument(
        "--timeout",
        type=int,
        default=-1,
        help="Per-cell timeout in seconds (default: -1 = no timeout)",
    )
    args = parser.parse_args()

    path = Path(args.notebook).resolve()

    # Make scripts/ importable inside the kernel so notebooks can do
    #   from get_spark_session import get_spark_session
    scripts_dir = str(Path(__file__).resolve().parent)
    existing = os.environ.get("PYTHONPATH", "")
    os.environ["PYTHONPATH"] = (
        scripts_dir + os.pathsep + existing if existing else scripts_dir
    )

    nb = nbformat.read(path, as_version=4)
    client = NotebookClient(
        nb,
        timeout=None if args.timeout < 0 else args.timeout,
        kernel_name="python3",
        resources={"metadata": {"path": str(path.parent)}},
    )

    try:
        client.execute()
    except CellExecutionError as exc:
        nbformat.write(nb, path)  # persist partial outputs for debugging
        sys.stderr.write(f"{exc}\n")
        return 1
    except Exception as exc:  # noqa: BLE001 — surface any execution error concisely
        sys.stderr.write(f"{type(exc).__name__}: {exc}\n")
        return 1

    nbformat.write(nb, path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
