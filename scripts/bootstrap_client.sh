#!/usr/bin/env bash
# Optional uv pre-warm for the off-cluster BERDL client.
#
# A hand-bootstrapped .venv-berdl is no longer required: scripts run via PEP 723
# + `uv run`, pproxy runs via `uv run --with pproxy ...`, and notebooks run via
# `uv run` with `--with` deps. This script just resolves those uv environments
# once so the first real query / notebook / pproxy start isn't slow.
#
# It is safe to skip entirely; uv will resolve on demand on first use.

set -euo pipefail

if ! command -v uv >/dev/null 2>&1; then
  echo "Error: uv not found on PATH. Install it from https://docs.astral.sh/uv/" >&2
  exit 1
fi

echo "Pre-warming uv environments (this is optional; uv resolves on demand otherwise)..."

# pproxy bridge env (matches scripts/start_pproxy.sh).
echo "  • pproxy"
uv run --with pproxy python -c "import pproxy" >/dev/null

# Heavy notebook / script env (mirrors beril_cli/notebook_cmd.py NOTEBOOK_WITH).
echo "  • spark / berdl client deps"
uv run \
  --with pyspark \
  --with "spark_connect_remote @ git+https://github.com/BERDataLakehouse/spark_connect_remote.git" \
  --with "berdl_remote @ git+https://github.com/BERDataLakehouse/berdl_remote.git" \
  --with pandas \
  --with matplotlib \
  --with boto3 \
  python -c "pass" >/dev/null

echo "uv environments are warm. Off-cluster client is ready (no .venv-berdl needed)."
