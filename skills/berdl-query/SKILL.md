---
name: berdl-query
description: Use when writing or interpreting SQL against BERDL lakehouse databases (ke_pangenome, msd_biochemistry, fitnessbrowser, kbase_genomes) — for species/gene/genome/AMR/annotation lookups, cross-database joins (EC/KEGG/COG bridges), metabolic reconstruction, or fitness analysis. Provides query-construction safety rules, partition-filter and result-size rubrics, ID formats (genome_id, gtdb_species_clade_id, gene_cluster_id, ModelSEED), cross-database linking recipes, error-interpretation, and critical pitfalls (NULL/`-` annotation handling, string-typed numeric CAST, JOIN-key gotchas). Execution is handled by the berdl_query, berdl_discover, and berdl_export tools and the /berdl-connect and /berdl-status commands — this skill supplies the scientific judgment, not the plumbing.
---

# BERDL Query Skill

Scientific judgment for constructing and interpreting BERDL Spark SQL. Connection,
environment detection, and result transport are handled by Pi tools and commands —
this skill is about *what* to query and *how to read the answer*, not *how to connect*.

## Execution model (delegate the doing)

- **Connectivity / readiness**: assume `berdl_env_check` (or `/berdl-connect`,
  `/berdl-status`) has confirmed access. Do not reason about proxies, tunnels, or
  JupyterHub sessions — if a query fails on connectivity, point the user at `/berdl-connect`.
- **Discovery**: use **`berdl_discover`** for access-aware listing of databases, tables,
  and schemas. Never use raw `SHOW DATABASES` / `SHOW TABLES` — they bypass access
  filtering. The accessible set depends on the authenticated user, so **verify a database
  is accessible to you *before* adapting any example below**; do not assume from prose.
  For column-level detail (partition flags, data types, descriptions) and table-level
  `COMMENT`/`TBLPROPERTIES`, `berdl_discover` is the access-aware path; if you need a raw
  schema dump in a one-off read, `DESCRIBE EXTENDED <db>.<table>` works but is not
  access-filtered.
- **Bounded reads**: use **`berdl_query`** for a read-only SELECT. It returns the first
  `limit` rows (default 100); raise `limit` for more, or pass `limit: -1` to disable the
  cap (only after you've bounded the result in SQL). Always pass an explicit `LIMIT` in the
  SQL too and prefer `ORDER BY` for deterministic results — the tool cap and the SQL `LIMIT`
  are independent guards.
- **Large outputs**: use **`berdl_export`** (DESTRUCTIVE, gated) to write large result sets
  to object storage instead of returning them inline.
- **Access denied** (`403`, `Token denied`, `AccessControlException`, S3 denial): the user
  lacks permission for that tenant's data. Do **not** surface raw error text. Say:
  *"You don't have access to `<database>.<table>`. To request access, use the BERDL Tenant Browser."*
  This is normal when exploring databases outside your tenant membership — treat it as a
  permissions prompt, not a system failure.

## Mandatory validation checklist

Verify ALL before constructing a query:

- [ ] **Partition filter present**: filter on a partitioned/indexed column
      (`gtdb_species_clade_id`, `genome_id`, `orgId`).
- [ ] **Large-table guard**: filter very-large tables *before* joining. Commonly huge:
      `gene`, `gene_genecluster_junction`, `genome_ani`, `genefitness`, `reaction_similarity`.
- [ ] **Bounded results**: result set bounded by `LIMIT`, aggregation, or a narrow `WHERE`.
- [ ] **Type safety**: `CAST` string-typed numeric columns before comparing (fitnessbrowser,
      genomes, some metadata store numbers as strings).
- [ ] **Species ID quoting**: species IDs contain `--`; keep them inside single-quoted strings.
- [ ] **Annotation NULL filter**: exclude `-` and `NULL` for `EC`, `KEGG_ko`, `COG_category`.
- [ ] **ORDER BY**: present for any paginated query.
- [ ] **Correct JOIN keys**: `eggnog_mapper_annotations.query_name` → `gene_cluster.gene_cluster_id`
      (NOT `gene.gene_id`).

## Result-size rubric

| Expected output | Action |
|---|---|
| ≤ 10K rows | Return inline via `berdl_query` (bounded `LIMIT`). |
| 10K–250K rows | Aggregate/filter in SQL first; return summary + small sample, then offer export. |
| > 250K rows | Use `berdl_export` to object storage; do not return inline. |

Estimate size BEFORE querying. If uncertain, run a bounded `SELECT COUNT(*)` or a filtered
preview first. Aggregate (`GROUP BY`, `COUNT`, `AVG`, `SUM`, `PERCENTILE_APPROX`) in SQL —
never pull raw rows to aggregate locally. Only return small, aggregated results inline.

## Query patterns

**Safe species lookup** — resolve name → exact ID, then query by equality:
```sql
-- 1. Resolve species name to exact clade ID
SELECT gtdb_species_clade_id, GTDB_species
FROM kbase.ke_pangenome.gtdb_species_clade
WHERE GTDB_species LIKE '%Escherichia_coli%' LIMIT 5
-- 2. Query data by exact ID (=, not LIKE)
SELECT * FROM kbase.ke_pangenome.genome
WHERE gtdb_species_clade_id = 's__Escherichia_coli--RS_GCF_000005845.2' LIMIT 100
```

**Annotation query (filter NULLs)** — JOIN on `gene_cluster_id` → `query_name`, filter `-`/NULL.
~40% of genes lack functional annotation; account for this in interpretation.
```sql
SELECT gc.gene_cluster_id, gc.is_core, ann.COG_category, ann.EC, ann.Description
FROM kbase.ke_pangenome.gene_cluster gc
LEFT JOIN kbase.ke_pangenome.eggnog_mapper_annotations ann ON gc.gene_cluster_id = ann.query_name
WHERE gc.gtdb_species_clade_id = '{species_id}'
  AND ann.COG_category != '-' AND ann.COG_category IS NOT NULL
ORDER BY gc.is_core DESC, ann.COG_category
```

**Batched IN-clause** — up to ~100 IDs per `IN`. For more, chunk in groups of 50–100.

**Small → large join** — always filter the largest table by a partition key BEFORE joining
(pangenome → `gtdb_species_clade_id`; fitnessbrowser → `orgId`; genomes → genome/feature ID).
An unfiltered join on a huge table is a full table scan.

**Aggregation before transfer** — `GROUP BY` + `COUNT` in SQL; transfer only the summary.
For distributions, use `PERCENTILE_APPROX(col, 0.5)` in SQL rather than pulling raw rows.

**Safe numeric comparison (string-typed columns)** — fitnessbrowser stores all columns as
strings, so `CAST` before comparing or ordering; `orgId` is case-sensitive:
```sql
SELECT locusId, sysName, gene_name, CAST(fit AS FLOAT) AS fitness
FROM kescience.fitnessbrowser.genefitness
WHERE orgId = 'Keio' AND CAST(fit AS FLOAT) < -2
ORDER BY CAST(fit AS FLOAT) ASC LIMIT 20
-- WRONG: WHERE fit < '-2'  -- lexicographic comparison
```

**Paginated retrieval** — always `ORDER BY`, then `LIMIT … OFFSET …` for deterministic pages.

**Coverage / existence check before analysis** — verify data exists before building on it:
```sql
SELECT COUNT(*) AS total_clusters,
  SUM(CASE WHEN ann.COG_category != '-' AND ann.COG_category IS NOT NULL THEN 1 ELSE 0 END) AS has_cog
FROM kbase.ke_pangenome.gene_cluster gc
LEFT JOIN kbase.ke_pangenome.eggnog_mapper_annotations ann ON gc.gene_cluster_id = ann.query_name
WHERE gc.gtdb_species_clade_id = '{species_id}'
```
Known sparse coverage: AlphaEarth embeddings (partial), NCBI environment metadata (EAV, sparse),
geographic coordinates (often NULL/malformed), functional annotation (~40% missing).

## Cross-database recipes

No direct foreign keys exist across BERDL databases — all links are approximate (name match,
ID pattern, or external mapping). Always validate that matched records make biological sense.

- **EC numbers are the best bridge** (pangenome ↔ biochemistry). Match annotation `EC` to
  ModelSEED `reaction.abbreviation` with `LIKE` (EC is embedded in strings like `2.7.1.150-RXN.c`).
  Some clusters carry comma-separated multi-EC — split before matching. Filter `deltag` outliers
  (`deltag > -10000000`). Get stoichiometry via `reaction → reagent → molecule`:
  ```sql
  SELECT r.id, r.name, r.deltag, m.name AS compound, m.formula, rg.stoichiometry,
    CASE WHEN rg.stoichiometry < 0 THEN 'reactant' ELSE 'product' END AS role
  FROM kbase.msd_biochemistry.reaction r
  JOIN kbase.msd_biochemistry.reagent rg ON r.id = rg.reaction_id
  JOIN kbase.msd_biochemistry.molecule m ON rg.molecule_id = m.id
  WHERE r.abbreviation LIKE '%{ec_number}%'
  ORDER BY r.id, rg.stoichiometry
  ```
- **KEGG/BiGG IDs require external mapping** — KEGG `R00001` does NOT equal ModelSEED
  `seed.reaction:rxn00001`; that mapping isn't in BERDL. Prefer the EC bridge.
- **Pangenome ↔ fitnessbrowser** — no ID mapping; fitnessbrowser covers 48 organisms (limited
  overlap). Link by gene name or functional annotation (COG/KEGG), not by ID; always CAST.
  Resolve the organism first (`SELECT DISTINCT orgId, organism FROM …organism WHERE organism LIKE …`).
- **Pangenome ↔ kbase_genomes** — genomes uses CDM UUID primary keys; map external IDs via the
  `name` table. Junction tables are very large — never query unfiltered.
- **Cross-species comparison** — gene cluster IDs are species-specific and cannot be matched
  across species; compare via functional annotation (COG, KEGG, EC) instead.
- **NCBI Entrez / literature enrichment** (when available): organism name → NCBI taxonomy → GTDB
  species via name match; gene name → EC/COG/KEGG → which species carry it as core vs accessory;
  protein/assembly accession → `genome.genome_id`; PubMed findings → validate against BERDL at
  scale. Use `lit_search` / `lit_fetch` for the literature side.

## Common ID formats

| ID | Format | Example |
|---|---|---|
| `genome_id` | `RS_GCF_XXXXXXXXX.X` or `GB_GCA_XXXXXXXXX.X` | `RS_GCF_000005845.2` |
| `gtdb_species_clade_id` | `s__Genus_species--{rep_genome}` | `s__Escherichia_coli--RS_GCF_000005845.2` |
| `gene_cluster_id` | `{contig}_{number}` | `NZ_CP095497.1_1766` |
| ModelSEED reaction | `seed.reaction:rxnNNNNN` | `seed.reaction:rxn00001` |
| ModelSEED compound | `seed.compound:cpdNNNNN` | `seed.compound:cpd00001` |
| Fitness `orgId` | case-sensitive string | `Keio` |

## Interpreting query failures

Distinguish a *permissions* signal from a *transient* one before retrying or surfacing anything:

| Symptom | Meaning | What to do |
|---|---|---|
| `403` / `Token denied` / `AccessControlException` / S3 denial | No access to that tenant's data | Plain-language message + Tenant Browser (see Execution model); never retry, never show raw text. |
| Gateway/origin timeout (504/524) | Query too heavy | Add filters, aggregate in SQL, or shrink the scope; then retry. |
| "cannot schedule new futures" (503) | Spark executor restarting | Wait ~30s and retry once. |
| Empty result where rows expected | Silent failure or wrong table/column | Re-check the table exists via `berdl_discover` and verify column names/spelling. |
| Connectivity / auth-expired errors | Session or proxy not ready | Point the user at `/berdl-connect` (or `/berdl-status`); do not reason about plumbing here. |

## Critical pitfalls

1. **Unfiltered joins on huge tables** = full scan / timeout. Always partition-filter first.
2. **`-` and NULL in annotation columns** — unfiltered, they pollute counts and distributions.
   ~40% of genes have no functional annotation.
3. **String-typed numeric columns** — comparing/ordering without `CAST` gives lexicographic
   (wrong) order; affects fitnessbrowser and genomes. After retrieval, coerce with
   `pd.to_numeric(col, errors='coerce')`.
4. **Wrong annotation JOIN key** — use `gene_cluster_id` → `query_name`, never `gene_id`.
5. **Species IDs contain `--`** — keep them single-quoted; resolve name → exact ID, then `=`.
6. **Cross-database IDs don't match directly** — KEGG ≠ ModelSEED; clusters are species-specific.
7. **Case-sensitive `orgId`** in fitnessbrowser — use exact case.
8. **Assuming coverage** — embeddings, environment metadata, and coordinates are sparse; check
   coverage before designing an analysis around them.

When a query surprises you (retry cycles, unexpected NULLs, schema mismatches, performance
cliffs), capture the lesson via the `pitfall-capture` skill so the next run benefits.
