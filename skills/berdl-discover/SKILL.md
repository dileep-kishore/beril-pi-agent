---
name: berdl-discover
description: Use when exploring an unfamiliar BERDL database, table, or schema — to introspect tables/columns access-awarely, infer cross-table relationships (gene/genome/AMR/COG/GTDB joins), spot non-derivable pitfalls (NULL conventions, ID formats, missing-column workarounds, join-key gotchas, large-table guards), and interpret schema/metadata before writing analysis queries. Applies whenever you need to understand what data exists and how tables connect, rather than knowing it already.
---

# BERDL Database Discovery

Discovery answers two questions before any analysis: **what data exists** and **how the tables connect**. Structural facts (databases, tables, columns, comments, relationships) come from the live system via introspection. They are derivable on demand and need not be persisted. **Non-derivable knowledge** — things you cannot read off a schema — is the valuable output and the reason this skill exists.

## Tools

- Use `berdl_discover` for access-aware introspection: it lists databases, tables, and per-column schema, and surfaces table-level metadata (table COMMENT, properties, format, owner, created date). It only returns objects the user can actually see — never reason from `SHOW DATABASES`/`SHOW TABLES` output, which bypasses access filtering and will mislead you about what's reachable.
- Use `berdl_query` for bounded sampling (SELECT, limit 100) when you need to see real values to confirm a relationship, an ID format, or a NULL convention. Never run unbounded counts blindly (see large-table guards below).
- If anything seems unconfigured, run `/berdl-status` (or `/berdl-connect`) before assuming the data is missing.

## Discovery Workflow

1. **List accessible databases**, then **list tables** in the target database, via `berdl_discover`. An empty result means the user has no access — say so plainly; do not pretend tables exist.
2. **Read per-column schema.** Each column carries `name`, `dataType`, `nullable`, `description`, `isPartition`. The `description` is the column COMMENT set at ingest. Legacy tables often have empty descriptions — that is normal. **Never fabricate a meaning for an undocumented column**; flag it as undocumented and, if it matters, sample values to infer cautiously.
3. **Read table-level metadata** for COMMENT, properties, storage format, owner, and created date — useful for provenance and for judging table size/freshness.
4. **Counts are optional and gated.** Only count rows on explicit request, and ask first for any table without a known size. Treat tables like `gene`, `genome_ani`, and `reaction_similarity` as large by default and avoid `COUNT(*)` / full scans on them.

## Relationship Inference (the core judgment)

Cross-table reasoning is the heart of discovery. Schemas rarely declare foreign keys explicitly, so infer them:

- **Match `_id` columns to primary keys** in other tables. A column ending in `_id` is a candidate join key; find the table where that id is the primary identifier (e.g. `gene_id` → `gene`, `genome_id` → `genome`).
- **Confirm, don't assume.** Sample 2–5 rows from both sides with `berdl_query` and check that values actually overlap and share format. Same-named columns can use different ID schemes; differently-named columns can be the real join.
- **Watch the grain.** Know whether a join is 1:1, 1:many, or many:many before you trust an aggregate — genome→gene is one-to-many; gene→annotation (COG, GTDB taxonomy, AMR/resistance calls) is often one-to-many or many-to-many and will fan out row counts if joined naively.
- **Respect biological hierarchy.** Genome → contig → gene → annotation is the usual containment chain; AMR/resistance and functional (COG) and taxonomic (GTDB) calls hang off genes or genomes. Map a table into this hierarchy before joining it.

## Non-Derivable Pitfalls (what to capture)

These cannot be read off a schema and are the knowledge worth recording when discovery surfaces them:

- **NULL conventions** — does NULL mean "absent", "not tested", or "below threshold"? For AMR/resistance calls especially, absence of a call is not the same as a negative result.
- **ID formats** — prefixing, zero-padding, accession style, or composite keys that must match exactly across tables to join.
- **Missing-column workarounds** — a value you'd expect as a column that must instead be derived or joined from elsewhere.
- **Join-key gotchas** — columns that look joinable but aren't (different namespaces, units, or versions), or a join that silently drops rows.
- **Large-table guards** — tables that must not be scanned or counted unguarded.

When discovery surfaces such a fact during real project work, record it via the project's pitfall capture flow (run the relevant slash command); structural snapshots themselves do not need persisting.

## Interpretation & Error Handling

- A missing/empty schema or a "could not retrieve schema" condition usually means the underlying files for that table are absent — report it to the user; do not crash or invent the schema.
- A failed introspection on a specific table is commonly a name typo or a table dropped between listing and inspection — surface the actual error rather than guessing.
- Keep output focused on what the user asked: a compact summary of relevant tables, schemas, inferred relationships, and any new pitfalls. Don't dump full structural snapshots — they're regenerable on demand.
