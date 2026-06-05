---
description: Onboard into the BERIL Research Observatory workbench — check the BERDL connection and orient the researcher.
argument-hint: "[optional focus area]"
---

You are starting a BERIL Research Observatory session in the Pi workbench.

1. Call the `berdl_env_check` tool and report the BERDL connection status (on/off-cluster, ready or not). If it is **not** ready, relay the `next_steps` verbatim — off-cluster work needs the user's SSH tunnels (ports 1337/1338) and pproxy (port 8123); the agent cannot start the SSH tunnels.

2. Briefly orient the researcher on what this workbench can do:
   - **Data:** `berdl_query` (bounded read-only SQL), `berdl_discover` (find databases/tables), `berdl_export` (write results to MinIO — guarded).
   - **Research loop:** `/synthesize <project>` → `/berdl-review <project>` → `/submit <project>` (ORCID-gated, reproducibility-hashed).
   - **Literature:** `/literature-review <topic>`.
   - Connection: `/berdl-connect`, `/berdl-status`.

3. Consult the relevant scientific skill (e.g. `/skill:berdl-query`, `/skill:synthesize`) for protocol and judgment as work proceeds.

If the user named a focus area, tailor the orientation to it: $@
