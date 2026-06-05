---
name: literature-review
description: Use when the user wants to find papers, review existing research on a topic, check what is known about an organism/gene/pathway, support or refute a hypothesis with citations, or build a references list. Covers biological/biomedical literature (microbiology, genomics, AMR, metabolic pathways) with MeSH/GTDB/COG-aware query construction, relevance ranking, depth tiers, full-text reading, citation snowballing, and gene-paper cross-referencing. Provides the scientific judgment; run /literature-review and use lit_search and lit_fetch for execution.
---

# Literature Review

Search, read, and synthesize biological literature relevant to BERDL research. This skill holds the scientific judgment — query strategy, ranking, depth tiers, and synthesis templates. Execution (searching, fetching full text, managing state) is delegated to Pi tools and commands:

- **`/literature-review <topic>`** — runs the end-to-end review workflow.
- **`lit_search`** — multi-source discovery (PubMed, bioRxiv, arXiv, Google Scholar) returning ranked metadata.
- **`lit_fetch`** — retrieves full text for a paper by identifier (PMCID/DOI/arXiv ID).

Your role is to decide *what* to search, *how* to rank it, *how deep* to go, and *how to synthesize* — then let the tools do the fetching.

## Step 1: Understand the Research Question

Clarify scope before searching. Ask if unclear:

- Specific organism, gene, pathway, or phenotype?
- Time frame (recent only, or comprehensive)?
- Does it involve specific genes/proteins/enzymes? (enables gene-paper cross-referencing)

### Select a Depth Tier

| Tier | Papers | Full text? | Citation snowball? | Gene cross-ref? | When to use |
|---|---|---|---|---|---|
| **Quick scan** | 5-10 | No | No | No | Ad-hoc questions, quick checks |
| **Standard review** | 20-30 | Top 10 | Yes | If genes involved | Default for project work |
| **Deep review** | 50+ | Top 20 | Yes | Yes | Systematic/comprehensive, grant writing |

Default to **quick scan** for ad-hoc questions and **standard review** for project-based work. Use **deep review** only when explicitly requested or when the question demands comprehensive coverage. If a hypothesis is supplied (e.g. from a synthesis workflow), it provides the search context.

## Step 2: Construct Search Queries

Build biology-aware queries before calling `lit_search`.

### MeSH Term Expansion

Expand biological topics to MeSH terms for better PubMed coverage:

| User term | MeSH expansion |
|---|---|
| "pangenome" | "pangenome" OR "pan-genome" OR "core genome" OR "accessory genome" |
| "horizontal gene transfer" | "Gene Transfer, Horizontal"[MeSH] OR "lateral gene transfer" |
| "E. coli" | "Escherichia coli"[MeSH] OR "E. coli" |
| "antibiotic resistance" | "Drug Resistance, Microbial"[MeSH] OR "antimicrobial resistance" |
| "metabolic pathway" | "Metabolic Networks and Pathways"[MeSH] |

### Organism Filters (aligned with BERDL's GTDB taxonomy)

When searching for a BERDL species, use both the GTDB name and common variants:

```
"Escherichia coli" OR "E. coli"
"Staphylococcus aureus" OR "S. aureus" OR "MRSA"
```

### Functional Annotation Keyword Expansion

When searching for gene functions found in BERDL data, expand annotation codes to natural-language terms:

| BERDL annotation | Search terms |
|---|---|
| COG category J | "translation" AND "ribosomal" |
| COG category V | "defense mechanisms" OR "restriction modification" OR "CRISPR" |
| COG category X | "mobilome" OR "transposon" OR "prophage" OR "mobile genetic element" |
| EC 2.7.1.* | "kinase" AND "phosphorylation" |
| KEGG pathway map00010 | "glycolysis" OR "gluconeogenesis" |

## Step 3: Discover and Rank Papers

Use **`lit_search`** to query sources. Search priority: PubMed → bioRxiv → arXiv → Google Scholar. Start focused; broaden if fewer than 5 results, narrow if more than 100. Deduplicate by DOI (primary) or PMID, and track which sources each paper appeared in.

### Rank by BERDL Relevance

- **HIGH**: BERDL organism overlap, pangenome / comparative genomics, metabolic pathway analyses, environmental genomics with BERDL taxonomic overlap.
- **MEDIUM**: Methodology papers, reviews, related organisms or pathways.
- **LOW**: Tangential topics, distant organisms.

Sort HIGH → MEDIUM → LOW, newest first within each tier.

### Citation Snowball *(Standard + Deep tiers — skip for quick scan)*

For the top ~10 papers, use `lit_search` related-article lookups to pull in similar/cited papers. Score new papers by the same HIGH/MEDIUM/LOW criteria and deduplicate again.

## Step 4: Gene-Paper Cross-Reference *(Deep tier, or when genes/proteins are involved)*

When the question involves specific genes, proteins, enzymes, or pathways, cross-reference against BERDL's gene-paper literature mining (`kescience_paperblast`) using **`berdl_query`** (bounded SELECT). First identify the relevant identifiers: gene names (e.g. rpoB, dnaA), protein accessions (NP_*, WP_*), EC numbers, or pathway IDs.

Useful lookups (bounded SELECT, limit 100):

- **Gene lookup**: match `kescience_paperblast.gene` on `desc LIKE '%[name]%'` or `geneId='[accession]'`.
- **Gene-paper links**: `kescience_paperblast.genepaper` filtered by `geneId`, ordered by year.
- **Snippets**: `kescience_paperblast.snippet` filtered by `geneId` (text-mined evidence sentences).
- **Curated**: join `curatedgene` and `curatedpaper` on `db` and `protId`.
- **GeneRIF**: `kescience_paperblast.generif` filtered by `geneId`.

**Pitfalls** (non-derivable):
- `year` is stored as a **string** — always `CAST(year AS INT)` for ordering/comparison.
- Gene IDs span multiple namespaces (RefSeq NP_*, UniProt WP_*, VIMSS) — use the `seqtoduplicate` table to cross-reference across namespaces.

Categorize results against the Step 3 manifest:
- **Confirmed**: PMIDs found by both keyword search and gene cross-reference (strengthens relevance).
- **New from cross-ref**: PMIDs absent from discovery — add to results.
- **Discovery-only**: papers without gene associations — still relevant for broader context.

## Step 5: Deep Reading of Key Papers *(Standard + Deep tiers)*

Use **`lit_fetch`** to retrieve full text for the top papers — Standard: top 10; Deep: top 20. Focus on Methods, Results, and Discussion. For each paper, extract:

- **Methods** — study design, key techniques, sample size, organisms used.
- **Key Results** — findings with specific numbers, effect sizes, p-values, focused on the research question.
- **Limitations** — acknowledged weaknesses.
- **BERDL Relevance** — organisms, genes, pathways, EC numbers, or data types that map to BERDL tables.
- **Notable Quotes** — verbatim, with section attribution.

If full text is unavailable (not in PMC, fetch fails), tag the paper **ABSTRACT ONLY** and fall back to its abstract summary from Step 3. Tag successfully read papers **FULL TEXT**.

For on-demand drill-down after the review is presented, re-fetch a single paper and produce an expanded extraction: add a **Detailed Analysis** section answering the user's specific question, a **Future Directions** section (authors' suggested follow-ups), and more extensive quotes.

## Step 6: Summarize Findings

Group results by theme. Match summary depth to the tier — quick scan uses themes + gaps only; standard/deep adds methods comparison, quantitative results, and evidence-quality indicators.

```markdown
## Literature Review: [Topic]

**Review depth**: [Quick scan | Standard review | Deep review]
**Papers found**: [N] | **Full text read**: [N] | **Abstract only**: [N] | **Cross-ref additions**: [N]
**Sources searched**: [list]

### Summary
[2-3 sentence overview of what the literature says]

### Key Findings by Theme

#### Theme 1: [e.g., "Pangenome methods"]
- **Author et al. (Year)** — [Key finding]. DOI: [doi] [FULL TEXT | ABSTRACT ONLY]

#### Theme 2: [e.g., "Core gene evolution"]
- ...

### Methods Comparison *(Standard + Deep tiers)*

| Study | Organism(s) | Method | Sample size | Key metric |
|---|---|---|---|---|
| Author (Year) | E. coli | Pangenome analysis (Roary) | 500 genomes | Core genes: 2,800 |

### Key Quantitative Results *(Standard + Deep tiers)*

| Finding | Value | Study | Evidence quality |
|---|---|---|---|
| Core genome size | 2,800 genes | Author (2024) | Large-scale, peer-reviewed |
| Accessory/total ratio | 0.45 | Author (2023) | Preprint, n=50 |

### Evidence Quality Notes *(Standard + Deep tiers)*
- Note which findings are peer-reviewed vs. preprint.
- Flag small sample sizes, single-organism studies, methodological limitations.
- Note if key claims are supported by multiple independent studies.

### Gaps in Current Knowledge
- [What hasn't been studied that BERDL could address]

### Gene Cross-Reference Findings *(if Step 4 performed)*
- [Gene-specific literature connections from text mining]
- [PMIDs confirmed by both keyword search and gene cross-reference]
- [New papers found only through cross-reference]

### Relevance to BERDL
- [Specific tables/queries that could extend these findings]
- [Which BERDL species overlap with the studies found]
```

## Step 7: Store References

A good `references.md` is reproducible: it records the date, the sources actually used, the exact query, the depth tier, and separates cited from merely-relevant references with full bibliographic detail (authors, year, title, journal, DOI, PMID).

```markdown
# References

## [Topic or Research Question]

Searched: [date], Sources: [PubMed, bioRxiv, arXiv, Google Scholar, gene cross-ref — only those used]
Query: "[search terms used]"
Review depth: [Quick scan | Standard review | Deep review]

### Cited References
1. Author A, Author B. (Year). "Title." *Journal*, Volume(Issue), Pages. DOI: [doi]. PMID: [pmid]

### Additional References (not cited but relevant)
1. ...
```

References belong with the project — let the relevant Pi command/tool persist them to the project's `references.md`. If no project context exists, offer to write it to the current working directory.

## Step 8: Connect to BERDL (optional)

If the review surfaces organisms, genes, or pathways present in BERDL, use **`berdl_discover`** and **`berdl_query`** to:

1. Note which BERDL tables contain relevant data.
2. Suggest specific queries to test literature findings at scale.
3. Identify discrepancies between published results and BERDL data.
4. Flag opportunities for novel analysis.

Concrete bridges:
- Paper mentions specific EC numbers → query `eggnog_mapper_annotations`.
- Paper studies specific species → look up in `gtdb_species_clade`.
- Paper reports gene essentiality → cross-reference with fitness data.

## Integration

- **From a hypothesis** (e.g. via `/synthesize`): check whether the hypothesis has been tested, find supporting/contradicting evidence, identify methods used in similar studies, discover additional variables.
- **To BERDL analysis**: literature findings inform `berdl_query` SELECTs (EC numbers, species, essentiality).
- **To submission** (`/submit`): the `references.md` produced here is checked during project submission as an advisory item.

## Error Handling

- **One source fails**: proceed with remaining sources; note which failed.
- **All sources fail**: report clearly; results will be less comprehensive (no full text, no snowballing).
- **Gene not found in cross-reference**: normal — note in summary and proceed with discovery results.
- **Full text unavailable**: tag the paper ABSTRACT ONLY and use its abstract summary.
