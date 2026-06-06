---
name: pitfall-capture
description: Use when BERDL work hits an error, retry, or data surprise — a query failure (504/524/503, empty response, SQL syntax/semantic error), incorrect results (bad join key, string-vs-numeric mismatch, wrong table), a substantial retry/correction cycle, a slow or OOM query, a data surprise (missing data, unexpected NULLs, coverage gaps, schema drift vs. docs), or an environment issue (Spark session, imports, JupyterHub). Provides the judgment for deciding whether a gotcha is worth recording, checking it isn't a known duplicate, and drafting a clear, specific, human-reviewed pitfall entry for the project's pitfalls memory. Referenced by other BERDL skills (berdl-query, berdl-discover, suggest-research, submit) rather than invoked directly by the user.
---

# Pitfall Capture Protocol

Capture hard-won BERDL gotchas as durable, searchable knowledge so the same
mistake isn't paid for twice. This is mostly pure judgment: deciding *whether*
something is a real pitfall, *whether* it's already known, and *how* to phrase
it so a future reader (human or agent) avoids it. Pitfalls live in the active
project's memory; recording them is human-in-the-loop and append-only.

This skill is referenced by other BERDL skills, not invoked directly. Follow it
whenever an issue is encountered during BERDL work.

## When to Trigger

Activate when any of the following occur during BERDL work:

1. **Query failure** — an error (504, 524, 503, empty response) or SQL that
   fails with a syntax or semantic error.
2. **Incorrect results** — data is wrong due to a bad join key, a
   string-vs-numeric comparison, the wrong table, etc.
3. **Retry/correction cycle** — you had to substantially change approach after
   an initial attempt failed.
4. **Performance issue** — a query is unreasonably slow or causes OOM.
5. **Data surprise** — missing data, unexpected NULLs, coverage gaps, or a
   schema that differs from the documentation.
6. **Environment issue** — Spark session problems, import errors, or other
   notebook/JupyterHub quirks.

## Where Pitfalls Live

Pitfalls belong to the **active project's `memories/pitfalls.md`**, append-only.
This file is LIVE: unlike discoveries and performance notes — which `/synthesize`
stages as `## Discoveries` / `## Performance Notes` in REPORT.md and `/submit`
promotes into `memories/` only *after* the author approves — a pitfall is
recorded as soon as the user confirms it, without waiting on submission. The
project's own pitfalls memory is the source of truth; new pitfalls are never
written to any frozen central archive.

If a pitfall genuinely doesn't belong to any specific project (e.g. a global
BERDL gotcha hit during free exploration with no current project), prefer either
(a) attaching it to the most-relevant active project, or (b) asking the user
where it should live. Always include the project tag in the entry body so the
gotcha stays attributable and cross-project search stays consistent.

## Protocol

### Step 1 — Check for Duplicates

Iteration on the same project commonly hits the same gotcha twice, so check
before drafting. Search the project's `memories/pitfalls.md` (and any older
historical gotcha notes the project carries) for a matching entry. Use
`berdl_discover` if you need to re-confirm a schema or coverage fact while
judging whether two issues are really the same.

Dedup heuristics — treat as the *same* pitfall when entries share the **root
cause**, not merely the surface symptom:

- Same table + same failure mode (e.g. join on a mistyped/wrong-cardinality
  key) is a duplicate even if the columns differ.
- Same error class from the same cause (e.g. a 504 from an unbounded scan) is a
  duplicate even if the specific query differs.
- A string-vs-numeric comparison bug is one pitfall regardless of which
  identifier column triggered it.
- Different root causes that happen to produce the same error code (e.g. two
  unrelated reasons for empty results) are **distinct** pitfalls.

Outcomes:

- **Already documented** — tell the user it's a known pitfall, name the entry's
  section/title, and quote or summarize the guidance so they can apply it
  immediately. **Stop here.**
- **Documented but slightly off** — if an existing entry's framing has been
  refined by later understanding, or its fix has improved, proceed to Step 2 but
  draft a **correction/follow-up** rather than a new pitfall.
- **Not documented** — proceed to Step 2.

### Step 2 — Ask the User (human-in-the-loop)

Don't record unilaterally. Ask directly:

> "I ran into an issue: **[brief description of what went wrong]**. Do you think
> this could have been avoided if it were documented in the pitfalls guide? If
> so, I'll draft an entry for your review."

- **User says no / not worth it** — acknowledge and continue the original task.
- **User says yes** — proceed to Step 3.

### Step 3 — Draft the Entry

Two shapes, depending on whether this is new or a correction. Be **specific**:
include the exact table, the exact error, and the exact fix. Vague entries like
"queries can be slow" are useless. Always start the body with the project tag
`[project_id]` for cross-project search consistency.

**New pitfall:**

```markdown
### [Descriptive Title]

**[project_id]** Explanation of the issue — what goes wrong and why.

```sql
-- WRONG: description of the incorrect approach
<incorrect code>

-- CORRECT: description of the correct approach
<correct code>
```

**Solution**: one-sentence actionable fix.
```

**Correction or follow-up to an existing entry** (append-only — never edit a
prior entry directly):

```markdown
### Correction to "[earlier entry's title]" ({earlier date or marker})

**[project_id]** What we got wrong before, or what we now know that refines the
earlier guidance.

```sql
-- Updated approach (replaces the earlier "CORRECT" example):
<refined code>
```

**Updated solution**: one-sentence actionable fix that supersedes the earlier one.
```

The correction references the earlier entry by title (and date if helpful), but
the earlier entry stays unchanged. This preserves the audit trail of "what we
thought when, and how our understanding evolved" — valuable for future
readers/agents.

Adapt the templates — not every pitfall involves SQL. Some are about Python,
environment setup, or data interpretation (e.g. COG category coverage, GTDB
taxonomy granularity, AMR gene calling thresholds, MeSH term mapping). The code
block language and content should match the actual issue. If validating a
proposed fix against the live data is useful, use `berdl_query` (bounded SELECT)
before finalizing the entry.

### Step 4 — Present for Review

Show the user: (1) the full drafted entry, (2) the destination — the active
project's `memories/pitfalls.md` — and (3) whether it's a new entry or a
correction-to-existing.

Ask: "Here's the draft entry. Does this look accurate? Should I add it to the
project's pitfalls memory?" Wait for approval; revise and re-present on request.

### Step 5 — Record

On approval, append the entry to the active project's `memories/pitfalls.md`
(append-only). If the file doesn't exist yet, this entry is its first content —
start it with a brief one-line preamble (e.g. `# Pitfalls — <project name>`)
before the entry. Confirm it was added, then **resume the original task** —
pitfall capture must not derail the user's workflow.

## Important Notes

- **Don't interrupt flow unnecessarily.** If the issue is minor and you already
  know the fix, apply the fix first, then ask about documenting it. The user's
  primary task always comes first.
- **One pitfall at a time.** If multiple issues arise, handle each separately.
- **Be specific.** Exact table, exact error, exact fix — nothing vague.
- **Always include the project tag** `[project_id]` at the start of the body.
- **Append-only.** Never rewrite historical entries; add a "Correction to ..."
  follow-up instead, preserving the audit trail of evolving understanding.
- **Pitfalls record on confirmation, not on submit.** They are the one project
  memory that doesn't wait for `/submit`'s approval gate — so a known gotcha is
  available the moment it's understood.
