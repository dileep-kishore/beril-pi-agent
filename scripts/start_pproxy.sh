#!/usr/bin/env bash
# Start pproxy HTTP-to-SOCKS5 bridge on port 8123
# This bridges HTTP requests (used by Spark Connect and MinIO) to the SSH SOCKS5 tunnel on port 1338.
# Prerequisites: SSH tunnels on ports 1337 and 1338 must be running.
#
# pproxy runs in a cached `uv` environment (`uv run --with pproxy ...`), so there
# is no hand-bootstrapped .venv-berdl to maintain. The proxy is launched detached
# (nohup + background) and keeps running after this script exits.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="${REPO_ROOT}/pproxy.log"

if ! command -v uv >/dev/null 2>&1; then
  echo "Error: uv not found on PATH. Install it from https://docs.astral.sh/uv/" >&2
  exit 1
fi

# Portable "is something listening on this local port?" — no `lsof` dependency
# (lsof is absent on minimal remote/JupyterHub images). Uses python3 (a hard
# prereq of this repo) to attempt a localhost TCP connect; exit 0 == accepting.
port_listening() {
  python3 -c "import socket,sys; s=socket.socket(); s.settimeout(0.5); sys.exit(0 if s.connect_ex(('127.0.0.1',$1))==0 else 1)" 2>/dev/null
}

# Check if SSH tunnel on 1338 is up
if ! port_listening 1338; then
  echo "Warning: SSH tunnel on port 1338 not detected." >&2
  echo "Start it with: ssh -f -N -o ServerAliveInterval=60 -D 1338 ac.<username>@login1.berkeley.kbase.us" >&2
  echo "Continuing anyway..." >&2
fi

# Check if pproxy is already running
if port_listening 8123; then
  echo "pproxy is already running on port 8123." >&2
  exit 0
fi

echo "Starting pproxy on port 8123..."
echo "Routes HTTP → SOCKS5 (127.0.0.1:1338)"
echo "Logging to ${LOG_FILE}"

# Launch pproxy detached so it survives this script exiting. uv resolves pproxy
# into a cached environment without touching the project venv.
nohup uv run --with pproxy python -m pproxy \
  -l http://:8123 \
  -r socks5://127.0.0.1:1338 \
  -v \
  >"${LOG_FILE}" 2>&1 &

# Give it a moment to bind the port, then report.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if port_listening 8123; then
    echo "pproxy is listening on port 8123."
    exit 0
  fi
  sleep 0.5
done

echo "Error: pproxy did not start listening on port 8123. See ${LOG_FILE}." >&2
exit 1
