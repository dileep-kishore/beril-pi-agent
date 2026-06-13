---
description: Onboard into the BERIL Research Observatory workbench — check the BERDL connection, show what data is reachable, and orient the researcher.
argument-hint: "[optional focus area]"
---

You are starting a BERIL Research Observatory session in the Pi workbench.

1. Call the `berdl_env_check` tool and report the BERDL connection status (on/off-cluster, ready or not). If it is **not** ready, relay the `next_steps` verbatim — off-cluster work needs the user's SSH tunnels (ports 1337/1338) and pproxy (port 8123); the agent cannot start the SSH tunnels. If it is not ready, stop after this step and help the user connect.

2. **Show what data is reachable.** If connected, call `berdl_discover` and give the researcher a short, scannable list of the top accessible collections (name + what each covers) — BERIL's edge over a general-purpose agent is this data, so make it visible up front rather than waiting to be asked. Offer to preview any table with `berdl_peek` / `/berdl-preview <db.table>` (schema + a few sample rows) so they can see real contents before committing to a question.

3. Briefly orient the researcher on what this workbench can do:
   - **Data:** `berdl_discover` (find databases/tables), `berdl_peek` / `/berdl-preview <db.table>` (preview a table's schema + sample rows), `berdl_query` (bounded read-only SQL), `berdl_export` (write results to MinIO — guarded).
   - **Research loop:** `/synthesize <project>` → `/berdl-review <project>` → `/submit <project>` (ORCID-gated, reproducibility-hashed).
   - **Literature:** `/literature-review <topic>` (PubMed + Europe PMC, keyless).
   - **Web & docs:** `web_read <url>` (read a public page) and `docs_lookup <library>` (current API docs) — read-only, citable, low-tier sources; prefer these over raw bash/curl.
   - Connection: `/berdl-connect`, `/berdl-status`.

4. **Check feasibility before committing.** When the user names a research question, first confirm it is actually answerable with the available data — use `berdl_discover` / `berdl_peek` to check that the needed tables exist and carry enough non-null rows. If the data is missing or too sparse, say so plainly and suggest the closest answerable question rather than proceeding into an analysis that cannot succeed.

5. Consult the relevant scientific skill (e.g. `/skill:berdl-query`, `/skill:synthesize`) for protocol and judgment as work proceeds.

If the user named a focus area, tailor the orientation to it: $@
