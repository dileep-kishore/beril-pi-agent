---
name: berdl-discover
description: Use when exploring an unfamiliar BERDL database, table, or schema — to introspect databases/tables/columns access-awarely, infer cross-table relationships (gene/genome/AMR/COG/GTDB joins), spot non-derivable pitfalls (NULL conventions, ID formats, missing-column workarounds, join-key gotchas, large-table guards), and interpret schema/metadata before writing analysis queries. Applies whenever you need to understand what data exists and how tables connect, rather than knowing it already. Does NOT generate module files.
---

# BERDL Database Discovery

Discovery answers two questions before any analysis: **what data exists** and **how the tables connect**. Structural facts (databases, tables, columns, comments, relationships) come from the live system via access-aware introspection. They are derivable on demand and need not be persisted. **Non-derivable knowledge** — things you cannot read off a schema — is the valuable output and the reason this skill exists.

## Tools

- Use **`berdl_discover`** for access-aware introspection, in two cheap depths — it never scans every table:
  - **Inventory (no args):** tenants → databases (with `name`, `description`, `provider`). One fast call. This is the concise "what can I reach" list. Use `max_databases` only to cap a debugging scan.
  - **Scoped (`database=<id>`):** that one database's tables (`name`, `description`, `row_count`). One fast call. No column schemas.
  It only returns objects the user can reach — **never reason from `SHOW DATABASES` / `SHOW TABLES`**, which bypasses access filtering and will mislead you about what's reachable.
- Use **`berdl_peek`** to read a specific table's **columns** (types + comments) and a few sample rows in one call — this is how you inspect schema, not `berdl_discover` (which deliberately stops at table names to stay fast).
- Use **`berdl_query`** for bounded sampling (`SELECT`, default limit 100) when you need to see real values to confirm a relationship, an ID format, or a NULL convention, or to read richer table metadata (e.g. `DESCRIBE EXTENDED <db>.<table>` for COMMENT / TBLPROPERTIES / storage format / owner / created date). Never run unbounded counts blindly (see large-table guards).
- If anything seems unconfigured or empty, run **`/berdl-status`** (or **`/berdl-connect`** for off-cluster setup) before assuming the data is missing.

## Discovery Workflow

1. **List accessible databases** with `berdl_discover` (inventory), then list **tables** in the target database with `berdl_discover(database=<id>)`. An empty result means the user has no access — say so plainly; do not pretend tables exist.
2. **Read per-column schema with `berdl_peek`** on the specific table (discover stops at table names to stay fast). Each column's `description` is the COMMENT set at ingest. Legacy tables often have empty descriptions — that is normal. **Never fabricate a meaning for an undocumented column**; flag it as undocumented and, if it matters, sample values (peek already returns a few) to infer cautiously.
3. **Read table-level metadata** — the scoped snapshot gives table `description` and `row_count`, useful for provenance and for judging size/freshness. For deeper metadata (properties, storage format, owner, created date), run `DESCRIBE EXTENDED` through `berdl_query` only when it actually matters.
4. **Counts are optional and gated.** The scoped snapshot may already carry `row_count`; otherwise only count rows on explicit request, and ask first for any table without a known size. Treat tables like `gene`, `genome_ani`, and `reaction_similarity` as large by default and avoid `COUNT(*)` / full scans on them.

## Relationship Inference (the core judgment)

Cross-table reasoning is the heart of discovery. Schemas rarely declare foreign keys explicitly, so infer them:

- **Match `_id` columns to primary keys** in other tables. A column ending in `_id` is a candidate join key; find the table where that id is the primary identifier (e.g. `gene_id` → `gene`, `genome_id` → `genome`).
- **Confirm, don't assume.** Sample 2–5 rows from both sides with `berdl_query` and check that values actually overlap and share format. Same-named columns can use different ID schemes; differently-named columns can be the real join.
- **Watch the grain.** Know whether a join is 1:1, 1:many, or many:many before you trust an aggregate — genome→gene is one-to-many; gene→annotation (COG, GTDB taxonomy, AMR/resistance calls) is often one-to-many or many-to-many and will fan out row counts if joined naively.
- **Respect biological hierarchy.** Genome → contig → gene → annotation is the usual containment chain; AMR/resistance, functional (COG), and taxonomic (GTDB) calls hang off genes or genomes. Map a table into this hierarchy before joining it.

## Non-Derivable Pitfalls (what to capture)

These cannot be read off a schema and are the knowledge worth recording when discovery surfaces them:

- **NULL conventions** — does NULL mean "absent", "not tested", or "below threshold"? For AMR/resistance calls especially, absence of a call is not the same as a negative result.
- **ID formats** — prefixing, zero-padding, accession style, or composite keys that must match exactly across tables to join.
- **Missing-column workarounds** — a value you'd expect as a column that must instead be derived or joined from elsewhere.
- **Join-key gotchas** — columns that look joinable but aren't (different namespaces, units, or versions), or a join that silently drops rows.
- **Large-table guards** — tables that must not be scanned or counted unguarded.

When discovery surfaces such a fact **during real project work**, record it to the active project's pitfall log (run the project's pitfall-capture flow). The central historical pitfall archive is frozen — new pitfalls go per-project, append-only, not into the central file. Do **not** write a separate module file; structural snapshots themselves do not need persisting.

## Interpretation & Error Handling

- A missing/empty schema or a "could not retrieve schema" condition usually means the underlying files for that table are absent — report it to the user; do not crash or invent the schema. (`berdl_discover` records such cases as per-table discovery errors rather than failing the whole snapshot.)
- A failed introspection on a specific table is commonly a name typo or a table dropped between listing and inspection — surface the actual error rather than guessing.
- Keep output focused on what the user asked: a compact summary of relevant tables, schemas, inferred relationships, and any new pitfalls. Don't dump full structural snapshots — they're regenerable on demand.
