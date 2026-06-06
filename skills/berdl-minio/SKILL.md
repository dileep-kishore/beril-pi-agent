---
name: berdl-minio
description: Use when result artifacts need to move between BERDL MinIO object storage and the local machine — listing, downloading, sharing, or uploading exported query results — or when only KBASE_AUTH_TOKEN is available and MinIO access/secret keys must be acquired. Covers the credential-resolution order, MinIO endpoints and `cdm-lake` bucket/prefix path patterns, the list-before-download retrieval discipline, and secret-handling safety rules. There is no Pi MinIO tool, so transfers run through the agent's bash tool plus the vendored scripts; off-cluster reachability is handled by /berdl-connect, and destructive `mc rm` passes the beril-safety gate.
---

# BERDL MinIO Skill

Scientific/operational judgment for moving BERDL result artifacts between object
storage and local disk: *which* credentials to use, *where* artifacts live, and
*how* to retrieve them safely. The artifacts this skill retrieves are typically the
output of the `berdl_export` tool (large query results written to object storage
instead of returned inline).

## Execution model (delegate the doing)

- **Off-cluster reachability is not your problem.** `minio.berdl.kbase.us` is only
  reachable through the BERDL proxy chain when you are off-cluster. Do **not** reason
  about SSH tunnels, pproxy, or `https_proxy` setup here — run **`/berdl-connect`**
  first (it checks the connection and starts pproxy if the tunnels are up) and
  **`/berdl-status`** to confirm readiness. Only proceed once the connection is ready.
- **No Pi tool wraps MinIO**, so transfers use the agent's built-in **bash** tool
  plus the vendored scripts below. Reference only these scripts; do not invent names.
- **Destructive removals** (`mc rm`, `rm -rf`) pass through the central **beril-safety**
  gate, which requires interactive confirmation; in a non-interactive session they are
  auto-denied. Treat any delete as irreversible.

## Preconditions

1. `/berdl-connect` reports the connection ready (off-cluster requires the proxy chain).
2. `KBASE_AUTH_TOKEN` set in environment or `.env`.
3. **`mc` (MinIO client) installed.** Check with `command -v mc`. If missing:
   - macOS: `brew install minio/stable/mc`, or
     `curl -sSL https://dl.min.io/client/mc/release/darwin-arm64/mc -o /usr/local/bin/mc && chmod +x /usr/local/bin/mc`
   - Linux:
     `curl -sSL https://dl.min.io/client/mc/release/linux-amd64/mc -o /usr/local/bin/mc && chmod +x /usr/local/bin/mc`

## Credential strategy (resolution order)

Resolve MinIO keys in this order — stop at the first that works:

1. Existing `MINIO_ACCESS_KEY` and `MINIO_SECRET_KEY` in the environment or `.env`.
2. Derive them from the authenticated BERDL remote context (using `KBASE_AUTH_TOKEN`)
   via `--bootstrap-remote`.

## Workflow

Run from the repo root. Off-cluster, ensure `/berdl-connect` succeeded first.

1. **Verify readiness** (optional sanity check before transfers):
   ```bash
   python scripts/berdl_env.py --check    # exit 0 if ready, 1 otherwise
   ```
   If it reports off-cluster and not ready, run `/berdl-connect`, then retry.

2. **Resolve credentials** and load them into the shell:
   ```bash
   eval "$(python scripts/get_minio_creds.py --shell)"
   # or, if remote bootstrap is needed:
   eval "$(python scripts/get_minio_creds.py --bootstrap-remote --shell)"
   ```

3. **Configure the `mc` alias** (alias name is `berdl-minio`):
   ```bash
   bash scripts/configure_mc.sh --berdl-proxy   # off-cluster (routes via 127.0.0.1:8123)
   bash scripts/configure_mc.sh                 # on-cluster only
   ```

4. **List before you download**, then copy only the run folder(s) you need.
   Off-cluster, every `mc` command needs the proxy env set, not just alias setup —
   export it once in the shell:
   ```bash
   export https_proxy=http://127.0.0.1:8123
   export no_proxy=localhost,127.0.0.1

   mc ls berdl-minio/cdm-lake/users-general-warehouse/<user>/exports/
   mc cp --recursive berdl-minio/cdm-lake/users-general-warehouse/<user>/exports/run_20260217 ./exports/run_20260217
   mc cp --recursive ./local_data berdl-minio/cdm-lake/users-general-warehouse/<user>/uploads/local_data
   ```

## MinIO endpoints

- Production API endpoint (default): `https://minio.berdl.kbase.us`
- Production UI: `https://minio-ui.berdl.kbase.us`
- Staging UI: `https://minio-ui.stage.berdl.kbase.us`
- Development UI: `https://minio-ui.dev.berdl.kbase.us`

## Bucket / prefix path patterns

All BERDL data lives under the `cdm-lake` bucket. Common prefixes:

| Scope | Path |
|---|---|
| Personal files | `s3://cdm-lake/users-general-warehouse/<username>/` |
| Personal SQL warehouse | `s3://cdm-lake/users-sql-warehouse/<username>/` |
| Tenant files | `s3://cdm-lake/tenant-general-warehouse/<tenant>/` |
| Tenant SQL warehouse | `s3://cdm-lake/tenant-sql-warehouse/<tenant>/` |

With the `mc` alias, address objects as `berdl-minio/cdm-lake/...` (drop the
`s3://` scheme). `berdl_export` results typically land under the personal or
tenant general-warehouse `exports/` prefix.

## Retrieval discipline

1. Resolve credentials (above).
2. Configure the `mc` alias.
3. **List the prefix before downloading** — confirm the run folder exists and its
   size before pulling it.
4. Copy only the required run folder(s) locally; avoid recursive copies of an entire
   warehouse prefix.

## Vendored scripts

Only these exist. If you need behavior not covered, ask the user — do not invent scripts.

- `scripts/berdl_env.py` — environment/readiness check (`--check`, `--json`).
- `scripts/get_minio_creds.py` — resolve MinIO keys locally or via the BERDL remote
  context (`--shell` emits exports for `eval`; `--bootstrap-remote` derives keys from
  the authenticated remote; `--env-file` points at an alternate `.env`).
- `scripts/configure_mc.sh` — set the `berdl-minio` `mc` alias and test connectivity;
  `--berdl-proxy` routes through `http://127.0.0.1:8123` (required off-cluster).

## Safety rules

1. Never print full secrets (access/secret keys) in user-facing summaries unless
   explicitly asked.
2. Never commit credentials into repository files.
3. Prefer short-lived retrieval — resolve keys, export into the active shell, use,
   and let them expire; don't persist them.
4. Treat `mc rm` / `rm -rf` as irreversible. These pass the **beril-safety** gate
   (interactive confirmation; auto-denied non-interactively). List and double-check
   the target prefix before any delete.
