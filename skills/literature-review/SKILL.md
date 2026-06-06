---
name: literature-review
description: Use when the user wants to find papers, review existing research on a topic, check what is known about an organism/gene/pathway, support or refute a hypothesis with citations, or build a references list. Covers biological/biomedical literature (microbiology, genomics, AMR, metabolic pathways) with MeSH/GTDB/COG-aware query construction, BERDL-relevance ranking, depth tiers (quick/standard/deep), citation snowballing, full-text reading, gene-paper cross-referencing, and structured synthesis. Provides the scientific judgment; run /literature-review and use the lit_search and lit_fetch tools for execution.
---

# Literature Review

Search, read, and synthesize biological literature relevant to BERDL research — reviews that go beyond abstract-level summaries. This skill holds the scientific **judgment**: query strategy, relevance ranking, depth tiers, gene-paper cross-referencing, and synthesis templates. Execution (searching, fetching, persisting state) is delegated to Pi tools and commands:

- **`/literature-review <topic>`** — runs the end-to-end review: expands the topic into focused PubMed queries, searches, deduplicates, and writes `references.md` to the project (or cwd). Use this for the standard fan-out flow.
- **`lit_search`** — PubMed discovery for one query (`query`, optional `max`); returns normalized citation records (PMID, title, journal, year, authors).
- **`lit_fetch`** — retrieves a single article's metadata by `pmid`.
- **`berdl_query`** — bounded SELECT against BERDL, used here for gene-paper cross-referencing (`kescience_paperblast`) and for bridging findings back to BERDL tables.
- **`berdl_discover`** — find BERDL tables/columns relevant to organisms/genes/pathways the review surfaces.

Your role is to decide **what** to search, **how** to rank it, **how deep** to go, and **how to synthesize** — then let the tools fetch.

> **Tool reality (don't over-promise):** the Pi literature tools cover **PubMed metadata** via NCBI E-utilities. They do not themselves pull bioRxiv/arXiv/Scholar or extract full-text PDFs. The judgment below still spans multiple sources and full text — when a source or full text is outside the tools' reach, get it through the built-in **WebSearch**/**WebFetch** tools (see Fallback) and say so in the output. Never fabricate citations, DOIs, or PMIDs.

## Step 1: Understand the Research Question

Clarify scope before searching. Ask if unclear:

- Specific organism, gene, pathway, or phenotype?
- Time frame — recent papers only, or comprehensive?
- Does it involve specific genes/proteins/enzymes? (enables gene-paper cross-referencing in Step 4)

### Select a Depth Tier

| Tier | Papers | Full text? | Citation snowball? | Gene cross-ref? | When to use |
|---|---|---|---|---|---|
| **Quick scan** | 5-10 | No | No | No | Ad-hoc questions, quick checks |
| **Standard review** | 20-30 | Top ~10 | Yes | If genes involved | Default for project work |
| **Deep review** | 50+ | Top ~20 | Yes | Yes | Systematic/comprehensive, grant writing |

Default to **quick scan** for ad-hoc questions and **standard review** for project-based work. Use **deep review** only when explicitly requested or when the question demands comprehensive coverage. If a hypothesis is supplied (e.g. from `/synthesize`), it provides the search context.

## Step 2: Construct Search Queries

Build biology-aware queries *before* calling `lit_search` — the quality of the review is set here, not in the fetch. (`/literature-review` will auto-expand a bare topic into a few queries; the tables below are how you steer it, or how you build queries by hand for `lit_search`.)

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

Use **`lit_search`** (one call per query) — or **`/literature-review`** for the batched fan-out. Source priority where coverage exists: **PubMed → bioRxiv → arXiv → Google Scholar**. Start focused; **broaden if fewer than 5** results, **narrow if more than 100**. Deduplicate by DOI (primary) or PMID, and track which sources each paper appeared in. (For non-PubMed sources, drive **WebSearch** with a site-scoped query — see Fallback.)

### Rank by BERDL Relevance

- **HIGH**: BERDL organism overlap; pangenome / comparative genomics; metabolic pathway analyses; environmental genomics with BERDL taxonomic overlap.
- **MEDIUM**: methodology papers, reviews, related organisms or pathways.
- **LOW**: tangential topics, distant organisms.

Sort **HIGH → MEDIUM → LOW**, newest first within each tier. For each kept paper, hold: title, first author + year, PMID/DOI, source(s) it appeared in, relevance tier, and a 2-3 sentence abstract summary focused on the research question.

### Citation Snowball *(Standard + Deep tiers — skip for quick scan)*

For the top ~10 papers, pull in related/cited papers (e.g. PubMed "related articles" or forward/backward citations) and re-rank them by the same HIGH/MEDIUM/LOW criteria, deduplicating again. Snowballing is what separates a real review from a single keyword search.

## Step 4: Gene-Paper Cross-Reference *(Deep tier, or whenever specific genes/proteins are involved)*

When the question names specific genes, proteins, enzymes, or pathways, cross-reference against BERDL's text-mined gene-paper literature (`kescience_paperblast`) using **`berdl_query`** (bounded SELECT). First identify the relevant identifiers: gene names (e.g. rpoB, dnaA), protein accessions (NP_*, WP_*), EC numbers, or pathway IDs.

Useful lookups (bounded SELECT, `LIMIT` ~20-100):

- **Gene lookup** — `kescience_paperblast.gene` on `desc LIKE '%[name]%'` or `geneId = '[accession]'`.
- **Gene-paper links** — `kescience_paperblast.genepaper` filtered by `geneId`, ordered by `CAST(year AS INT) DESC`.
- **Snippets** — `kescience_paperblast.snippet` filtered by `geneId` (text-mined evidence sentences; truncate when surfacing).
- **Curated** — join `curatedgene` and `curatedpaper` on `db` and `protId`.
- **GeneRIF** — `kescience_paperblast.generif` filtered by `geneId`.

**Pitfalls (non-derivable — do not skip):**
- `year` is stored as a **string** — always `CAST(year AS INT)` for ordering/comparison.
- Gene IDs span multiple namespaces (RefSeq NP_*, UniProt WP_*, VIMSS) — use the `seqtoduplicate` table to cross-reference across namespaces.

Confirm live schemas with **`berdl_discover`** rather than assuming columns. Categorize results against the Step 3 set:
- **Confirmed** — PMIDs found by both keyword search and gene cross-reference (strengthens relevance).
- **New from cross-ref** — PMIDs absent from discovery; add to results.
- **Discovery-only** — papers without gene associations; still relevant for broader context.

If the cross-reference finds nothing (gene not in the database), that is normal — note it and proceed with discovery results.

## Step 5: Deep Reading of Key Papers *(Standard + Deep tiers)*

Read the top papers in full — **Standard: top ~10; Deep: top ~20** — focusing on Methods, Results, and Discussion. Use **`lit_fetch`** to pull a paper's record by PMID; for full text, use **WebFetch** on the PMC/DOI URL (open-access PMC articles and DOI landing pages) since the literature tools return metadata rather than full-text PDFs.

For each paper, extract:

- **Methods** — study design, key techniques, sample size, organisms used (1-3 bullets).
- **Key Results** — findings with specific numbers, effect sizes, p-values, focused on the research question (3-5 bullets).
- **Limitations** — acknowledged weaknesses (1-3 bullets).
- **BERDL Relevance** — organisms, genes, pathways, EC numbers, or data types that map to BERDL tables.
- **Notable Quotes** — verbatim, with section attribution.

If full text is unavailable (not open-access in PMC, fetch fails), tag the paper **ABSTRACT ONLY** and fall back to its abstract summary from Step 3. Tag successfully read papers **FULL TEXT**. Carry full-text reading as structured extractions (not raw text) into the synthesis.

**On-demand drill-down** — after the review is presented, if the user wants deeper analysis of one paper, re-fetch it and produce an expanded extraction: add a **Detailed Analysis** section answering the user's specific question, a **Future Directions** section (authors' suggested follow-ups), and more extensive quotes.

## Step 6: Summarize Findings

Group results by theme. Match summary depth to the tier — **quick scan** uses themes + gaps only; **standard/deep** adds the methods comparison, quantitative results, and evidence-quality sections.

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

A good `references.md` is **reproducible**: it records the date, the sources actually used, the exact query, the depth tier, and separates cited from merely-relevant references with full bibliographic detail (authors, year, title, journal, DOI, PMID).

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

`/literature-review` writes `references.md` (to the project, or cwd) as part of its run — let the command persist it rather than hand-writing the file. When you've enriched the set with full-text reading, snowballing, or gene cross-references, layer that detail into the file it produced. If no project context exists, it lands in the current working directory.

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

- **From a hypothesis** (e.g. via `/synthesize`): check whether the hypothesis has already been tested, find supporting/contradicting evidence, identify methods used in similar studies, discover additional variables to consider.
- **To BERDL analysis**: literature findings inform `berdl_query` SELECTs (EC numbers, species, essentiality).
- **To submission** (`/submit`): the `references.md` produced here is checked during project submission as an advisory item.

## Error Handling & Fallback

Discovery and cross-referencing are **optimizations**, not hard requirements — degrade gracefully:

| Failure | Recovery |
|---|---|
| One source/query fails | Proceed with remaining queries; note which failed in the output. |
| PubMed (`lit_search`) unavailable | Drive **WebSearch**: `site:pubmed.ncbi.nlm.nih.gov [query]`; **WebFetch** DOI/PMC pages for details. |
| Non-PubMed source (bioRxiv/arXiv/Scholar) | Use **WebSearch** with a site-scoped query; note coverage is less comprehensive. |
| Full text unavailable | Tag the paper **ABSTRACT ONLY** and use its abstract summary. |
| Gene not found in cross-reference | Normal — note in summary, proceed with discovery results. |
| All discovery fails | Report clearly; results will be less comprehensive (no full text, no snowballing). |

When you fall back, **state it in the output** so the user knows the review's coverage and provenance.
