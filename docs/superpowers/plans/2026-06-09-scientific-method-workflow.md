# Scientific-Method Workflow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make beril encode the scientific method and lead with calibrated trust by upgrading each seam of the existing linear arc — terminal-native, no knowledge-layer (OpenViking/KG) work.

**Architecture:** A tiny shared vocabulary module (`lib/science.ts`) + prose upgrades to the judgment skills + a few new extension tools/cards + a `/berdl-refute` red-team command that reuses the existing read-only Opus review subagent. Scientific judgment stays in `skills/*`; execution/UI in `extensions/*` + `lib/*`; the Python notebook hash, Spark/MinIO, and the safety gate are untouched.

**Tech Stack:** TypeScript (Pi extensions, `node --test` strip-only — no enums/parameter properties), Pi `registerTool`/`registerCommand`, `lib/ui` card primitives (`linesCard`/`markdownCard`/`textCard`, `domainStyle`, `GLYPH`, `markdownTable`), markdown SKILL.md files, Python `beril` CLI (pytest) where a probe needs Spark.

**Conventions to honor (every task):**
- New card `renderResult` must branch `if (context?.isError) return errorCard(theme, toolErrorText(result));` first.
- New tools follow the `registerTool` pattern in `extensions/beril-data.ts` (wrap CLI/helper → `content` text + `details` → render a card).
- TS tests live in `test/*.test.ts`; run with `bun run test`. TS check: `bun run check` (tsc + biome). Python: `uv run --group test pytest tests/ -q`.
- Conventional commits; commit after each task's checks pass.

---

## File Structure

**Create:**
- `lib/science.ts` — shared `ClaimStatus`/`ConfidenceTier`/`EvidencePointer` types + `tierForEvidence()`.
- `test/science.test.ts` — tests for `tierForEvidence`.
- `extensions/beril-refute.ts` — the `/berdl-refute` red-team command (mirrors `beril-review.ts`).
- `test/beril-refute.test.ts` — arg parsing + injected-subagent wiring.

**Modify:**
- `lib/conduct.ts` — one directive + the claim-status vocabulary.
- `lib/review-rubric.ts` — anti-overexcitement + empty-refutes lint (project), competing-hypotheses (plan), and the new `REFUTATION_RUBRIC`.
- `lib/ui/science-cards.ts` — `confidenceFooter()`, `evidenceCard()`, `feasibilityCard()`, `claimLedgerCard()`.
- `lib/lit.ts` — `fetchAbstract()` + `buildEfetchParams()`.
- `extensions/beril-literature.ts` — `lit_stance` tool + verify-on-write resolver in `/literature-review`.
- `extensions/beril-data.ts` — `berdl_feasibility` tool.
- `extensions/beril-governance.ts` — `claim_ledger` tool.
- `skills/research-plan/SKILL.md` — competing hypotheses, falsification, confidence prior.
- `skills/synthesize/SKILL.md` — confidence tier, supports/refutes + verbatim quotes, evidence tally, assumptions ledger.
- `skills/analysis-notebooks/SKILL.md` — refute-first ordering.
- `skills/berdl-review/SKILL.md` — mirror the rubric additions.
- `skills/suggest-research/SKILL.md` — competing-hypotheses criterion.

---

## WAVE 1 — prose + rubric + vocabulary (file-disjoint; parallelizable)

### Task 1: Shared science vocabulary (`lib/science.ts`)

**Files:**
- Create: `lib/science.ts`
- Test: `test/science.test.ts`

- [ ] **Step 1: Write the failing test** (`test/science.test.ts`)

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { type EvidencePointer, tierForEvidence } from "../lib/science.ts";

const ptr = (kind: EvidencePointer["kind"]): EvidencePointer => ({
  kind,
  locator: "x",
  exact: "y",
  relevance: "z",
});

test("no supporting artifacts → low", () => {
  assert.equal(tierForEvidence([]), "low");
});

test("literature-only → low", () => {
  assert.equal(tierForEvidence([ptr("paper")]), "low");
});

test("a single re-runnable result → medium", () => {
  assert.equal(tierForEvidence([ptr("notebook")]), "medium");
  assert.equal(tierForEvidence([ptr("query")]), "medium");
});

test("one result + a resolving paper → medium", () => {
  assert.equal(tierForEvidence([ptr("query"), ptr("paper")]), "medium");
});

test("two independent artifact-backed results → high", () => {
  assert.equal(tierForEvidence([ptr("notebook"), ptr("query")]), "high");
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `bun run test 2>&1 | grep -A2 science` — Expected: FAIL (cannot find module `../lib/science.ts`).

- [ ] **Step 3: Implement `lib/science.ts`**

```ts
/**
 * Shared scientific-method vocabulary used across skills, cards, and the
 * refutation pass. Confidence is COMPUTED from the strongest artifact behind a
 * claim — never a verbalized number — so claims cannot sound more certain than
 * the evidence supports. The names mirror the (future, out-of-scope) KG
 * StatementCard fields so a later emitter is a thin mapping, not a redesign.
 */

/** Per-CLAIM status — a separate axis from the project LIFECYCLE states. */
export type ClaimStatus =
  | "open"
  | "supported"
  | "refuted"
  | "needs-replication"
  | "blocked"
  | "needs-evidence";

export const CLAIM_STATUSES: readonly ClaimStatus[] = [
  "open",
  "supported",
  "refuted",
  "needs-replication",
  "blocked",
  "needs-evidence",
] as const;

/** Computed confidence in a claim, keyed to artifact strength. */
export type ConfidenceTier = "high" | "medium" | "low";

/** A typed, re-openable pointer to the artifact behind a claim. */
export interface EvidencePointer {
  kind: "query" | "notebook" | "figure" | "paper";
  /** notebook path (+ optional `#cell-N`), figure path, query hash, or PMID/DOI. */
  locator: string;
  /** The exact, verbatim source sentence/number this claim rests on. */
  exact: string;
  /** One-line why-this-matters. */
  relevance: string;
}

/** A re-runnable data/code result (vs literature, which alone stays `low`). */
function isResult(p: EvidencePointer): boolean {
  return p.kind === "query" || p.kind === "notebook";
}

/**
 * Map supporting evidence → a confidence tier (pure, deterministic).
 * - high   — ≥2 independent artifact-backed results.
 * - medium — exactly one re-runnable result (a paper may accompany it).
 * - low    — literature-only, or nothing (caller treats empty as needs-evidence).
 */
export function tierForEvidence(supports: EvidencePointer[]): ConfidenceTier {
  const results = supports.filter(isResult).length;
  if (results >= 2) return "high";
  if (results === 1) return "medium";
  return "low";
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `bun run test 2>&1 | grep -E "science|pass|fail"` — Expected: science tests PASS.

- [ ] **Step 5: Check + commit**

```bash
bun run check && git add lib/science.ts test/science.test.ts && \
git commit -m "feat(science): shared claim-status + confidence-tier vocabulary"
```

### Task 2: Conduct contract directive + vocabulary (`lib/conduct.ts`)

**Files:** Modify `lib/conduct.ts`

- [ ] **Step 1: Edit** — insert this bullet immediately after the `**Signal your confidence.**` bullet (after line 18):

```
- **Back every claim with an artifact, and hunt the counter-evidence.** State each empirical finding with a re-runnable reference (a notebook cell, a \`berdl_query\`, or a PMID) and the exact source sentence or number it rests on; never a figure from memory. Surface *refuting* evidence in its own slot, not buried in prose — and when you looked and found none, say "none found — searched X." Tag each claim's status as one of \`open / supported / refuted / needs-replication / blocked / needs-evidence\` (a per-claim judgement, separate from the project's lifecycle state). "needs-evidence" is an honest, encouraged outcome — far better than a confident guess.
```

- [ ] **Step 2: Check + commit**

```bash
bun run check && git add lib/conduct.ts && \
git commit -m "feat(conduct): mandate artifact-backed claims + a refutes slot + status vocab"
```

### Task 3: Research-plan skill — rivals, falsification, prior

**Files:** Modify `skills/research-plan/SKILL.md`

- [ ] **Step 1:** In the `## Template` markdown block, replace the `## Hypothesis` section (the `- **H0**` / `- **H1**` lines) with:

```markdown
## Hypothesis
- **H0**: {Null hypothesis}
- **H1**: {Alternative hypothesis}

### Competing Hypotheses
Frame 2–3 rivals the available BERDL data could *distinguish* — not strawmen:
- **H2**: {alternative mechanism}. Favoured if the data shows {outcome}.
- **H3**: {alternative}. Favoured if {outcome}.
**Discrimination strategy**: {the specific query/figure result that would tell H1, H2, H3 apart.}

### Falsification test
- **What would refute H1?** {the single result — effect below a threshold, a pattern's absence, a sign flip — that would make you reject H1.}

### Confidence prior
- Before any data: **HIGH / MEDIUM / LOW** — {why; cite literature for HIGH}. (Compared against the posterior at synthesis; a large gap is itself a finding.)
```

- [ ] **Step 2:** In the `## What a strong plan contains` list, change the hypotheses bullet to read:

```markdown
- A sharp, answerable **research question** and explicit **hypotheses** (H0/H1), **2–3 competing hypotheses** with a discrimination strategy, and a **falsification test** for H1 — the agent drafts these *before* asking the scientist's preference, so the design isn't wed to one story.
```

- [ ] **Step 3: Commit**

```bash
git add skills/research-plan/SKILL.md && \
git commit -m "feat(research-plan): competing hypotheses, falsification test, confidence prior"
```

### Task 4: Synthesize skill — tiers, supports/refutes, tally, assumptions

**Files:** Modify `skills/synthesize/SKILL.md`

- [ ] **Step 1:** In `### Pass 1 — Read data and draft findings`, after the `**Draft findings** addressing:` numbered list, insert:

```markdown
**Score and ground each finding (calibrated trust):**
- **Confidence tier** — `high` (≥2 independent artifact-backed results), `medium` (one re-runnable query/notebook result), or `low` (literature-only / no artifact → mark the claim `needs-evidence`). Confidence comes from the *artifacts*, not from how sure you feel.
- **Scope-bound** the claim: "in these N samples / under filter X", not a universal.
- **Provenance** — cite the re-runnable artifact (`*(Notebook: file.ipynb)*`, the query, or `PMID`) AND quote the **exact source sentence or number** behind the claim. Never state a number you cannot trace to a query or notebook output.
- **Status** — tag each finding `open / supported / refuted / needs-replication / blocked / needs-evidence`.
```

- [ ] **Step 2:** Replace the end of `### Pass 2 — Literature cross-reference and synthesis` (the comparison table block) by appending after it:

```markdown
**Weigh supporting vs refuting evidence.** Classify each analysis result and literature source as **strong-support** / **weak-support** / **neutral** / **refuting** for H1, and record the tally in the Interpretation section:
- (strong > refuting) and signal not swamped → **H1 supported, with caveats**.
- (refuting ≥ strong) → **H0 not rejected**.
- balanced → **mixed evidence** (say so plainly; do not pick a side the data doesn't support).
For every Key Finding, **actively look for disconfirming evidence**: a `berdl_query` phrased to break it and a paper that disagrees. Show the refuting slot even when empty ("none found — searched X").
```

- [ ] **Step 3:** In `## REPORT.md structure`, add these two bullets (after the `**Key Findings**` bullet and before `**Discoveries**`):

```markdown
- **Confidence & Caveats** *(not optional)* — for each Key Finding, one line: "Finding: {statement} (**{tier}**: {why}. Caveats: {limitation}. Status: {open|supported|refuted|needs-replication|blocked|needs-evidence})."
- **Supporting vs Refuting** — per Key Finding, a short `Supports:` / `Refutes:` split, each item a re-openable pointer (notebook cell / query / PMID) + the verbatim source line. If you found no refuting evidence, write "Refutes: none found — searched {what}." Do not omit the Refutes line.
```

- [ ] **Step 4:** In `## REPORT.md structure`, add after the `**Interpretation**` block:

```markdown
- **Assumptions & Caveats** — list the key assumptions from the research plan and state which **held** vs **broke** (compare against the plan's confidence prior). Example: "Assumption: AlphaEarth embeddings >70% dense. **BROKE** — only 9.6% covered; switched to manual classification."
```

- [ ] **Step 5:** In the final `**Suggest next steps**` list, change item 1 to:

```markdown
1. Walk the user through the Key Findings and Interpretation, **leading with the findings tagged lowest-confidence or `needs-evidence`**, and offering to open the data, the notebook cell, or the refuting check behind any of them. Offer `/berdl-refute <project>` to actively stress-test the headline findings.
```

- [ ] **Step 6: Commit**

```bash
git add skills/synthesize/SKILL.md && \
git commit -m "feat(synthesize): confidence tiers, supports/refutes + verbatim provenance, evidence tally, assumptions ledger"
```

### Task 5: Review rubric — anti-overexcitement, empty-refutes, competing hypotheses

**Files:** Modify `lib/review-rubric.ts`, `skills/berdl-review/SKILL.md`

- [ ] **Step 1:** In `PROJECT_REVIEW_RUBRIC`, in the `## Rubric — assess and report on` list, add this bullet after the **Findings assessment** bullet:

```
- **Confidence calibration (anti-overexcitement)** — Does each Key Finding state a confidence tier + caveat + status? Flag any **tone-evidence mismatch** (confident language over a small effect / thin sample / single run), unsupported superlatives, and research-plan assumptions that were violated but not caveated. **Empty-refutes lint**: if a finding's Interpretation or Limitations text names a confounder, alternative explanation, or contradiction but its "Refutes" slot is empty, flag it as "possible refutation not lifted — re-synthesize." A non-significant or refuted finding honestly reported is a strength, not a weakness.
```

- [ ] **Step 2:** In `PROJECT_REVIEW_RUBRIC`'s `## Output format` markdown skeleton, add a `## Confidence calibration` section heading between `## Findings assessment` and `## Suggestions`:

```
## Confidence calibration
{Tone-vs-evidence mismatches, missing/again-thin confidence tiers, un-caveated broken assumptions, empty-refutes flags.}
```

- [ ] **Step 3:** In `PLAN_REVIEW_RUBRIC`'s `## Rubric — cover` numbered list, add item 7:

```
7. **Competing hypotheses & falsification** — Does the plan frame 2–3 rival explanations with a discrimination strategy, and a falsification test for H1, or is it wed to a single story? If single-minded, suggest: "Consider H2: {alternative}; what data would favour H1 over H2?" A plan that cannot state what result would refute its hypothesis is not yet testable.
```

- [ ] **Step 4:** Mirror Steps 1 and 3 into `skills/berdl-review/SKILL.md` (its "Project review rubric" and "Plan review rubric" sections) in the same wording, so the human-facing skill and the runtime rubric stay in sync.

- [ ] **Step 5: Check + commit**

```bash
bun run check && git add lib/review-rubric.ts skills/berdl-review/SKILL.md && \
git commit -m "feat(review): confidence-calibration + empty-refutes lint + competing-hypotheses plan check"
```

---

## WAVE 2 — the mechanisms

### Task 6: `REFUTATION_RUBRIC` + `/berdl-refute`

**Files:**
- Modify: `lib/review-rubric.ts` (append `REFUTATION_RUBRIC`)
- Create: `extensions/beril-refute.ts`
- Test: `test/beril-refute.test.ts`

- [ ] **Step 1: Append `REFUTATION_RUBRIC` to `lib/review-rubric.ts`**

```ts
/**
 * System prompt for the active-refutation pass. Unlike the review rubrics (which
 * judge a finished report), this one is adversarial: per Key Finding it tries to
 * BREAK the claim, using read-only data discovery and the literature, and reports
 * what it attempted so the *absence* of disconfirmation is visible. Runs on the
 * strongest model (weak models have high false-positive error on falsification).
 * The caller writes the output verbatim to REFUTATION_N.md; no lifecycle change.
 */
export const REFUTATION_RUBRIC = `You are a skeptical scientific red-team for BERDL (BER Data Lakehouse) analysis projects. Your job is to actively try to REFUTE the report's headline findings — not to praise them. Refuting evidence is rare and easy to miss, so you must hunt for it deliberately.

You have read-only tools (read, grep, find, ls); do not write, edit, or create files. Read REPORT.md and the notebooks before judging — never from assumption.

## For each Key Finding in REPORT.md

1. **State the claim** and the artifact it rests on (notebook/query/figure).
2. **Design one disconfirming check** — the single BERDL query or analysis whose result would most undermine the claim (a confound to rule out, a held-out subset, an alternative grouping, a sign you'd expect if a rival hypothesis were true). Describe it concretely (the tables/columns/filters) so the author can run it. Where you can reason it out from the notebooks/data already present, state what the result implies.
3. **Find one contradiction in the literature** — name a specific paper/PMID (or search terms to find it) whose result disagrees with or qualifies the claim. If none, say "no contradicting literature found — searched {terms}".
4. **Verdict** — does the finding survive scrutiny? One of: holds / holds-with-caveats / needs-replication / undermined / unverifiable. Be explicit when the honest answer is "couldn't find disconfirming evidence" — that is a real, reportable outcome, not a pass.

## Output format

Output a single markdown document — text only, no file writes. Begin with a YAML frontmatter block, then one section per finding. Do NOT add a hash footer.

\`\`\`markdown
---
reviewer: BERIL Refutation Pass
date: YYYY-MM-DD
project: {project_id}
---

# Refutation Pass: {Project Title}

## {Finding 1, short}
- **Claim / artifact**: ...
- **Disconfirming check**: ... (tables/columns/filters; implied result if derivable)
- **Contradicting literature**: ... (PMID or search terms; or "none found — searched ...")
- **Verdict**: holds | holds-with-caveats | needs-replication | undermined | unverifiable — {why}
\`\`\`

Use today's date in YYYY-MM-DD; \`project\` must match the project directory name. Be specific and adversarial; do not manufacture refutations, but do not pull punches either.`;
```

- [ ] **Step 2: Write the failing test** (`test/beril-refute.test.ts`)

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRefuteArgs } from "../extensions/beril-refute.ts";

test("parses project", () => {
  assert.deepEqual(parseRefuteArgs("amr_atlas"), { project: "amr_atlas", model: undefined });
});

test("parses --model", () => {
  assert.deepEqual(parseRefuteArgs("amr_atlas --model claude-opus-4-8"), {
    project: "amr_atlas",
    model: "claude-opus-4-8",
  });
});

test("missing project → undefined", () => {
  assert.equal(parseRefuteArgs("   "), undefined);
});
```

- [ ] **Step 3: Run it, verify it fails**

Run: `bun run test 2>&1 | grep -A2 refute` — Expected: FAIL (cannot find module).

- [ ] **Step 4: Implement `extensions/beril-refute.ts`** (mirrors `beril-review.ts`; reuses `runReviewSubagent`, no lifecycle change, no footer)

```ts
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { runReviewSubagent } from "../lib/review-agent.ts";
import { nextReviewPath } from "../lib/review-finalize.ts";
import { REFUTATION_RUBRIC } from "../lib/review-rubric.ts";

type ReviewSubagent = typeof runReviewSubagent;

export interface RefuteArgs {
  project: string;
  model?: string;
}

/** Parse `<project> [--model <id>]`. */
export function parseRefuteArgs(raw: string): RefuteArgs | undefined {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  let project: string | undefined;
  let model: string | undefined;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === "--model") model = parts[++i];
    else if (!project) project = parts[i];
  }
  return project ? { project, model } : undefined;
}

/**
 * `/berdl-refute <project> [--model <id>]` — run an isolated, read-only red-team
 * subagent (Opus 4.8, overridable) that actively tries to disconfirm the report's
 * findings, then write a numbered REFUTATION_N.md. Does NOT change lifecycle.
 */
export default function berilRefute(pi: ExtensionAPI) {
  pi.registerCommand("berdl-refute", {
    description: "Actively try to refute a project's headline findings (red-team pass), then write REFUTATION_N.md.",
    async handler(args: string, ctx: ExtensionCommandContext) {
      const parsed = parseRefuteArgs(args);
      if (!parsed) {
        if (ctx.hasUI) ctx.ui.notify("Usage: /berdl-refute <project> [--model <id>]", "warning");
        return;
      }
      if (!ctx.isIdle()) {
        if (ctx.hasUI) ctx.ui.notify("Agent is busy — wait for the current turn to finish.", "warning");
        return;
      }
      const projectDir = join(ctx.cwd, "projects", parsed.project);
      if (!existsSync(join(projectDir, "REPORT.md"))) {
        if (ctx.hasUI) ctx.ui.notify(`REPORT.md not found — run /synthesize first for "${parsed.project}".`, "error");
        return;
      }
      const task = `Red-team the report for project "${parsed.project}" at ${projectDir} against the rubric. Try to refute its Key Findings. Output the complete refutation markdown.`;
      const subagent = (ctx as { __reviewSubagent?: ReviewSubagent }).__reviewSubagent ?? runReviewSubagent;
      const text = await subagent(ctx, { projectDir, rubric: REFUTATION_RUBRIC, task, modelOverride: parsed.model });
      if (!text.trim()) {
        if (ctx.hasUI) ctx.ui.notify("Refutation pass returned no output — nothing written.", "error");
        return;
      }
      const path = nextReviewPath(projectDir, "REFUTATION");
      await writeFile(path, text, "utf8");
      if (ctx.hasUI) ctx.ui.notify(`Refutation pass written: ${path}`, "info");
      pi.sendUserMessage(
        `A refutation pass for "${parsed.project}" is at ${path}. Lift each surviving disconfirming check / contradiction into REPORT.md's Refutes slots and re-tag finding status (follow the synthesize skill).`,
      );
    },
  });
}
```

- [ ] **Step 5:** Verify `nextReviewPath(projectDir, prefix)` accepts an arbitrary prefix (it does — `beril-review.ts` calls it with `"PLAN_REVIEW"`/`"REVIEW"`). Confirm the extension is auto-loaded: check `package.json`/`pi` package config lists `extensions/*.ts` by glob (the other `beril-*.ts` load automatically); if extensions are listed explicitly anywhere, add `beril-refute`.

Run: `grep -rn "beril-review" package.json pi.json .pi 2>/dev/null` — if it appears in an explicit list, add `beril-refute` beside it.

- [ ] **Step 6: Run tests + check**

Run: `bun run test 2>&1 | grep -E "refute|fail"` then `bun run check` — Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add lib/review-rubric.ts extensions/beril-refute.ts test/beril-refute.test.ts && \
git commit -m "feat(refute): /berdl-refute active red-team pass on the Opus subagent"
```

### Task 7: `confidenceFooter` + `evidenceCard` (`lib/ui/science-cards.ts`)

**Files:** Modify `lib/ui/science-cards.ts`; Test `test/science-cards.test.ts` (create if absent)

- [ ] **Step 1: Add imports** at the top of `science-cards.ts` (extend the existing `lib/science.ts`-less file):

```ts
import type { ClaimStatus, ConfidenceTier, EvidencePointer } from "../science.ts";
```

- [ ] **Step 2: Add a status→glyph map + the card builders** (append near the other builders):

```ts
/** Map a claim status to a glyph + theme colour key. */
function statusGlyph(theme: Theme, status: ClaimStatus): string {
  const m: Record<ClaimStatus, [string, string]> = {
    supported: [GLYPH.ok, "success"],
    refuted: [GLYPH.bad, "error"],
    "needs-replication": [GLYPH.pending, "warning"],
    blocked: [GLYPH.bad, "muted"],
    "needs-evidence": [GLYPH.pending, "warning"],
    open: [GLYPH.bullet, "muted"],
  };
  const [g, color] = m[status];
  return theme.fg(color, `${g} ${status}`);
}

const TIER_COLOR: Record<ConfidenceTier, string> = { high: "success", medium: "warning", low: "muted" };

/** A quiet, dim confidence/caveat footer line to append under a result card body. */
export function confidenceFooter(theme: Theme, tier: ConfidenceTier, caveat?: string): string {
  const c = theme.fg(TIER_COLOR[tier], `confidence: ${tier}`);
  return theme.fg("dim", `${GLYPH.bullet} `) + c + (caveat ? theme.fg("dim", ` — ${caveat}`) : "");
}

export interface EvidenceView {
  claim: string;
  status: ClaimStatus;
  confidence: ConfidenceTier;
  supports: EvidencePointer[];
  refutes: EvidencePointer[];
  unresolved?: string[];
  /** What was searched when refutes is empty (so "none found" is auditable). */
  refutesSearched?: string;
}

function evidenceLines(theme: Theme, items: EvidencePointer[]): string[] {
  return items.map(
    (p) =>
      `  ${theme.fg("dim", `[${p.kind}]`)} ${theme.fg("text", p.locator)} ${theme.fg("muted", `— ${p.relevance}`)}`,
  );
}

/** A claim with its supporting AND refuting evidence, each a re-openable pointer. */
export function evidenceCard(theme: Theme, v: EvidenceView): Component {
  const lines: string[] = [
    `${statusGlyph(theme, v.status)}  ${theme.fg(TIER_COLOR[v.confidence], `confidence: ${v.confidence}`)}`,
    theme.fg("text", v.claim),
    "",
    theme.fg("success", `Supports (${v.supports.length})`),
    ...(v.supports.length ? evidenceLines(theme, v.supports) : [theme.fg("muted", "  (none)")]),
    "",
    theme.fg("error", `Refutes (${v.refutes.length})`),
    ...(v.refutes.length
      ? evidenceLines(theme, v.refutes)
      : [theme.fg("muted", `  none found${v.refutesSearched ? ` — searched ${v.refutesSearched}` : ""}`)]),
  ];
  if (v.unresolved?.length) {
    lines.push("", theme.fg("warning", "Unresolved"));
    for (const u of v.unresolved) lines.push(`  ${theme.fg("dim", GLYPH.bullet)} ${theme.fg("text", u)}`);
  }
  return linesCard(theme, {
    title: `Evidence ${GLYPH.bullet} ${v.status}`,
    accentStyle: domainStyle(theme, "analysis"),
    lines,
    maxBodyLines: 40,
  });
}
```

- [ ] **Step 3: Write a render smoke test** (`test/science-cards.test.ts`)

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { confidenceFooter, evidenceCard } from "../lib/ui/science-cards.ts";

// Minimal theme stub: fg(color, s) => s (identity), enough for the pure builders.
const theme: any = { fg: (_c: string, s: string) => s };

test("evidenceCard renders with empty refutes (shows 'none found')", () => {
  const card = evidenceCard(theme, {
    claim: "core genes under stronger purifying selection",
    status: "supported",
    confidence: "high",
    supports: [{ kind: "notebook", locator: "02.ipynb", exact: "dN/dS=0.08", relevance: "main result" }],
    refutes: [],
    refutesSearched: "accessory-gene dN/dS",
  });
  assert.ok(card);
});

test("confidenceFooter is a string with the tier", () => {
  assert.match(confidenceFooter(theme, "medium", "n=37"), /confidence: medium/);
});
```

- [ ] **Step 4: Run + check**

Run: `bun run test 2>&1 | grep -E "science-cards|fail"` then `bun run check` — Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add lib/ui/science-cards.ts test/science-cards.test.ts && \
git commit -m "feat(ui): evidenceCard (supports/refutes) + confidence footer"
```

### Task 8: `berdl_feasibility` tool + `feasibilityCard`

**Files:** Modify `lib/ui/science-cards.ts` (add `feasibilityCard`), `extensions/beril-data.ts` (add tool). Test: `test/beril-data.test.ts` (extend).

- [ ] **Step 1: Add `feasibilityCard` to `science-cards.ts`**

```ts
export interface FeasibilityView {
  verdict: "answerable" | "partial" | "not-answerable";
  question: string;
  blockers: string[];
  opportunities: string[];
  checked: { table: string; column?: string; coverage?: number; exists: boolean }[];
}

export function feasibilityCard(theme: Theme, v: FeasibilityView): Component {
  const vc: Record<FeasibilityView["verdict"], [string, string]> = {
    answerable: [GLYPH.ok, "success"],
    partial: [GLYPH.pending, "warning"],
    "not-answerable": [GLYPH.bad, "error"],
  };
  const [g, color] = vc[v.verdict];
  const lines: string[] = [`${theme.fg(color, `${g} ${v.verdict}`)}  ${theme.fg("muted", v.question)}`, ""];
  for (const c of v.checked) {
    const cov = c.coverage != null ? ` ${theme.fg("dim", `${Math.round(c.coverage * 100)}% non-null`)}` : "";
    const mark = c.exists ? theme.fg("success", GLYPH.ok) : theme.fg("error", GLYPH.bad);
    lines.push(`  ${mark} ${theme.fg("text", c.table + (c.column ? `.${c.column}` : ""))}${cov}`);
  }
  if (v.blockers.length) {
    lines.push("", theme.fg("error", "Blockers"));
    for (const b of v.blockers) lines.push(`  ${theme.fg("dim", GLYPH.bullet)} ${theme.fg("text", b)}`);
  }
  if (v.opportunities.length) {
    lines.push("", theme.fg("success", "Opportunities"));
    for (const o of v.opportunities) lines.push(`  ${theme.fg("dim", GLYPH.arrow)} ${theme.fg("text", o)}`);
  }
  return linesCard(theme, {
    title: `Feasibility ${GLYPH.bullet} ${v.verdict}`,
    accentStyle: domainStyle(theme, "data"),
    lines,
    maxBodyLines: 30,
  });
}
```

- [ ] **Step 2: Add the `berdl_feasibility` tool** in `extensions/beril-data.ts` (inside `berilData`, after `berdl_peek`). It probes cheaply by reusing the existing `query` CLI (DESCRIBE for existence; a bounded non-null count for coverage). The agent supplies its own structured judgement; the tool returns the probe facts + the agent-declared verdict so the *judgement* (which lives in the skill) and the *probe* (here) stay separate.

```ts
  pi.registerTool({
    name: "berdl_feasibility",
    label: "Check data feasibility",
    description:
      "Before planning, check whether a research question is answerable with the available BERDL data. Pass the question, the candidate tables, and (optionally) the key columns each must have. Runs CHEAP probes only — column existence via DESCRIBE and a bounded non-null coverage count — never a full scan. Returns a per-check breakdown so you can render an honest 'answerable / partial / not-answerable' verdict and name the limiting tables BEFORE writing a plan.",
    parameters: Type.Object({
      question: Type.String({ description: "The research question, 1-2 sentences." }),
      checks: Type.Array(
        Type.Object({
          table: Type.String({ description: "Fully-qualified table, e.g. kbase.ke_pangenome.genome." }),
          column: Type.Optional(Type.String({ description: "A key column whose presence/coverage gates the question." })),
        }),
        { description: "The tables (and optional key columns) the question depends on." },
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      await requireReady(pi);
      const checked: { table: string; column?: string; coverage?: number; exists: boolean }[] = [];
      for (const c of params.checks) {
        const table = c.table.trim();
        if (!isPlausibleTable(table)) {
          checked.push({ table, column: c.column, exists: false });
          continue;
        }
        let cols: QueryPayload;
        try {
          cols = await berilExec<QueryPayload>(pi, ["query", "--query", describeSql(table), "--limit", "500"]);
        } catch {
          checked.push({ table, column: c.column, exists: false });
          continue;
        }
        const names = new Set(cols.rows.map((r) => String((r.col_name ?? r.column ?? r.name ?? "")).toLowerCase()));
        if (!c.column) {
          checked.push({ table, exists: cols.rows.length > 0 });
          continue;
        }
        const exists = names.has(c.column.toLowerCase());
        let coverage: number | undefined;
        if (exists) {
          // Bounded coverage: non-null fraction over a capped sample (no full scan).
          const sql = `SELECT avg(CASE WHEN \`${c.column}\` IS NOT NULL THEN 1.0 ELSE 0.0 END) AS cov FROM (SELECT \`${c.column}\` FROM ${table} LIMIT 5000)`;
          try {
            const cov = await berilExec<QueryPayload>(pi, ["query", "--query", sql, "--limit", "1"]);
            const raw = cov.rows[0]?.cov;
            const num = typeof raw === "number" ? raw : Number(raw);
            if (Number.isFinite(num)) coverage = num;
          } catch {
            // coverage stays undefined; existence already recorded
          }
        }
        checked.push({ table, column: c.column, exists, coverage });
      }
      const text = checked
        .map((c) => `${c.exists ? "ok" : "MISSING"} ${c.table}${c.column ? `.${c.column}` : ""}${c.coverage != null ? ` (${Math.round(c.coverage * 100)}% non-null)` : ""}`)
        .join("\n");
      return { content: [{ type: "text", text: text || "(no checks)" }], details: { question: params.question, checked } };
    },
    renderCall(args, theme) {
      return callLine(theme, `feasibility · ${args.checks?.length ?? 0} check(s)`);
    },
    renderResult(result, { isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      if (isPartial) return partialLine(theme, "Probing data feasibility…");
      const d = result.details as { question: string; checked: { table: string; column?: string; coverage?: number; exists: boolean }[] };
      const missing = d.checked.filter((c) => !c.exists);
      const sparse = d.checked.filter((c) => c.exists && c.coverage != null && c.coverage < 0.5);
      const verdict = missing.length ? "not-answerable" : sparse.length ? "partial" : "answerable";
      return feasibilityCard(theme, {
        verdict,
        question: d.question,
        blockers: [
          ...missing.map((c) => `${c.table}${c.column ? `.${c.column}` : ""} is absent`),
          ...sparse.map((c) => `${c.table}.${c.column} is ${Math.round((c.coverage as number) * 100)}% non-null (sparse)`),
        ],
        opportunities: [],
        checked: d.checked,
      });
    },
  });
```

Add `feasibilityCard` to the existing `science-cards.ts` import block in `beril-data.ts`.

- [ ] **Step 3:** Wire the skill — in `skills/research-plan/SKILL.md` `## Feasibility first` section, add: "Use the `berdl_feasibility` tool with the candidate tables and their key columns; a `not-answerable` verdict means stop and reshape the question — name the limiting table and propose the closest answerable question before drafting the plan." And in `extensions/beril-plan.ts`, where it routes to the skill, add a sentence instructing the agent to call `berdl_feasibility` after clarifying and before drafting.

- [ ] **Step 4: Test** — add to `test/beril-data.test.ts` a check that the verdict logic maps a missing column → `not-answerable` and a sparse column → `partial` (extract the small verdict helper if needed, or assert via the render path with a stub theme). Run `bun run test` + `bun run check`.

- [ ] **Step 5: Commit**

```bash
git add lib/ui/science-cards.ts extensions/beril-data.ts extensions/beril-plan.ts skills/research-plan/SKILL.md test/beril-data.test.ts && \
git commit -m "feat(data): berdl_feasibility gate + feasibilityCard"
```

### Task 9: Literature — abstracts + stance + verify-on-write

**Files:** Modify `lib/lit.ts`, `extensions/beril-literature.ts`. Test: `test/lit.test.ts` / `test/beril-literature.test.ts`.

- [ ] **Step 1: Add `buildEfetchParams` + `fetchAbstract` to `lib/lit.ts`** (reuses the paced `getJson`-style gate; efetch returns text, so add a text fetch helper):

```ts
/** Build query params for the E-utilities efetch endpoint (abstract text). */
export function buildEfetchParams(pmid: string) {
  return { db: "pubmed", id: pmid, rettype: "abstract", retmode: "text" };
}

async function getText(url: string, signal?: AbortSignal): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    await acquireSlot();
    const res = await fetch(url, { signal: signal ?? AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    if (res.ok) return await res.text();
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < litConfig.maxRetries) {
      const retryAfter = Number(res.headers?.get?.("retry-after"));
      const delay =
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : litConfig.baseBackoffMs * 2 ** attempt;
      await sleep(delay);
      continue;
    }
    throw new Error(`NCBI request failed: ${res.status} ${res.statusText}`);
  }
}

/** Fetch the abstract text for a PMID (empty string if none). */
export async function fetchAbstract(pmid: string, signal?: AbortSignal): Promise<string> {
  return (await getText(toUrl("efetch.fcgi", buildEfetchParams(pmid)), signal)).trim();
}
```

- [ ] **Step 2: Add `resolveCitation` (verify-on-write) to `extensions/beril-literature.ts`** — a PMID that fails to fetch is flagged probable fabrication:

```ts
export interface CitationCheck {
  pmid: string;
  ok: boolean;
  title?: string;
  reason?: string;
}

/** Resolve a PMID via lit_fetch before it may be written; flag unresolvable ones. */
export async function resolveCitation(
  pmid: string,
  signal?: AbortSignal,
  fetcher: (p: string, s?: AbortSignal) => Promise<LitRecord> = fetchArticle,
): Promise<CitationCheck> {
  try {
    const rec = await fetcher(pmid, signal);
    if (!rec.title) return { pmid, ok: false, reason: "resolved but no title — probable fabrication" };
    return { pmid, ok: true, title: rec.title };
  } catch {
    return { pmid, ok: false, reason: "did not resolve at PubMed — probable fabrication" };
  }
}
```

- [ ] **Step 3: Add a `lit_stance` tool** in `berilLiterature` — zero-shot stance vs a hypothesis using the in-process `complete()` pattern (reuse the `expandQueries` auth/fallback shape). Returns `{ stance, confidence, exact_quote, qualifiers }` per top paper; renders via `litCard` plus a stance line. (Implement with the `__completer` seam so tests don't hit the network; on no-model fall back to returning the abstracts with `stance: "NEI"`.)

```ts
  pi.registerTool({
    name: "lit_stance",
    label: "Assess literature stance",
    description:
      "For a hypothesis, fetch top-N PubMed abstracts and assess each paper's stance: supports / refutes / NEI (not enough info). Returns the stance, a confidence, and the verbatim sentence behind it — so literature becomes first-class supporting OR refuting evidence. 'NEI' / 'insufficient evidence in the retrieved set' is an honest, encouraged outcome.",
    parameters: Type.Object({
      hypothesis: Type.String({ description: "The hypothesis to assess papers against." }),
      max: Type.Optional(Type.Integer({ description: "Papers to assess (default 5).", default: 5 })),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const max = params.max ?? 5;
      const records = await searchPubmed(params.hypothesis, max, signal);
      const assessed = [];
      for (const r of records) {
        const abstract = r.pmid ? await fetchAbstract(r.pmid, signal).catch(() => "") : "";
        assessed.push({ record: r, abstract });
      }
      // The model assigns stance; on no model/auth, return NEI honestly.
      const stances = await assessStances(
        ctx as Pick<ExtensionCommandContext, "model" | "modelRegistry" | "signal">,
        params.hypothesis,
        assessed,
        (ctx as { __completer?: Completer }).__completer,
      );
      const text = stances
        .map((s) => `${s.stance.toUpperCase()} (${s.confidence}) — ${s.record.title ?? s.record.pmid}`)
        .join("\n");
      return { content: [{ type: "text", text: text || "(no papers)" }], details: { stances } };
    },
    renderCall(args, theme) {
      return callLine(theme, `lit stance · ${args.hypothesis.slice(0, 50)}`);
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      if (isPartial) return partialLine(theme, "Assessing literature stance…");
      const { stances } = result.details as { stances: { record: LitRecord; stance: string }[] };
      return litCard(theme, stances.map((s) => s.record), expanded);
    },
  });
```

Implement `assessStances(ctx, hypothesis, assessed, deps)` as an in-process `complete()` call returning per-paper `{ record, stance: "supports"|"refutes"|"NEI", confidence, exact_quote, qualifiers }`, JSON-parsed, falling back to `stance:"NEI"` for every paper when no model/auth (mirror `expandQueries` exactly). Keep it in `beril-literature.ts`.

- [ ] **Step 4:** Wire verify-on-write into `/literature-review`: after `dedupe`, resolve each record's PMID via `resolveCitation` (paced; reuse `Promise.all` with the existing gate), and **drop or flag** unresolved PMIDs out of `references.md`, noting them in the `sendUserMessage`.

- [ ] **Step 5: Tests** (`test/beril-literature.test.ts`): `resolveCitation` returns `ok:false` when the fetcher throws and when it returns no title; `buildEfetchParams` shape; `assessStances` returns all-NEI with a no-model stub `__completer`. Run `bun run test` + `bun run check`.

- [ ] **Step 6: Commit**

```bash
git add lib/lit.ts extensions/beril-literature.ts test/lit.test.ts test/beril-literature.test.ts && \
git commit -m "feat(lit): abstracts + zero-shot stance + verify-on-write citations"
```

---

## WAVE 3 — flow polish

### Task 10: Clarifying-questions step before planning

**Files:** Modify `extensions/beril-plan.ts`, `skills/research-plan/SKILL.md`

- [ ] **Step 1:** In `skills/research-plan/SKILL.md`, before `## Feasibility first`, add a `## Clarify first (information-gain gated)` section: ask 2–3 grounded multiple-choice questions (the question in 1–2 sentences; which tables; what a successful answer looks like) **only when** resolving the ambiguity would change the query or the result; otherwise auto-resolve and **state the assumption** in the plan's context block. Reference the existing `request_checkpoint` tool for putting choices to the scientist.
- [ ] **Step 2:** In `extensions/beril-plan.ts`, in the message that routes to the skill, add: "First ask up to 3 grounded clarifying questions (only if they would change the analysis), then call `berdl_feasibility`, then draft the plan." Keep it one sentence; do not add a new tool.
- [ ] **Step 3: Check + commit**

```bash
bun run check && git add extensions/beril-plan.ts skills/research-plan/SKILL.md && \
git commit -m "feat(plan): info-gain-gated clarifying questions before planning"
```

### Task 11: Refute-first notebook ordering

**Files:** Modify `skills/analysis-notebooks/SKILL.md`

- [ ] **Step 1:** Add a `## Test the discriminating / falsifying result first` section: the first analysis notebook should run the query/figure that would *distinguish the competing hypotheses* or *refute H1*, before confirmatory cells; and record "did this seek data that would refute the hypothesis, or only affirm it?". Each result carries its confidence tier + scope bound.
- [ ] **Step 2: Commit**

```bash
git add skills/analysis-notebooks/SKILL.md && \
git commit -m "feat(analysis): run the discriminating/falsifying test before confirmatory cells"
```

### Task 12: `claim_ledger` read-only card

**Files:** Modify `lib/ui/science-cards.ts` (add `claimLedgerCard`), `extensions/beril-governance.ts` (add `claim_ledger` tool)

- [ ] **Step 1: Add `claimLedgerCard`** to `science-cards.ts` — a `Status | Confidence | Supports | Refutes | Stale?` table built from rows the tool parses out of `RESEARCH_PLAN.md`/`REPORT.md`. Use `markdownTable`:

```ts
export interface ClaimRow {
  hypothesis: string;
  status: ClaimStatus;
  confidence: ConfidenceTier;
  supports: number;
  refutes: number;
  stale?: boolean;
}

export function claimLedgerCard(theme: Theme, rows: ClaimRow[]): Component {
  const accentStyle = domainStyle(theme, "governance");
  if (!rows.length) {
    return linesCard(theme, {
      title: "Claim ledger",
      accentStyle,
      lines: [theme.fg("muted", "(no hypotheses/findings parsed yet)")],
    });
  }
  const table = rows.map((r) => ({
    Hypothesis: r.hypothesis,
    Status: r.status,
    Confidence: r.confidence,
    Supports: r.supports,
    Refutes: r.refutes,
    Stale: r.stale ? "yes" : "",
  }));
  return markdownCard(theme, {
    title: `Claim ledger ${GLYPH.bullet} ${rows.length}`,
    accentStyle,
    markdown: markdownTable(table as unknown as Record<string, unknown>[], { maxRows: 60 }),
  });
}
```

- [ ] **Step 2:** Add a read-only `claim_ledger` tool in `extensions/beril-governance.ts` that reads `projects/<project>/RESEARCH_PLAN.md` + `REPORT.md`, parses the `Hn` hypotheses and the per-finding `Supports:`/`Refutes:`/`(**tier**...Status: ...)` lines (the conventions Tasks 3–4 established), and renders `claimLedgerCard`. It **persists nothing**. Guard `context.isError`.
- [ ] **Step 3: Test** (`test/beril-governance.test.ts`): the parser turns a small fixture REPORT.md with one finding (one Supports pointer, empty Refutes, `medium`/`needs-evidence`) into one `ClaimRow`. Run `bun run test` + `bun run check`.
- [ ] **Step 4: Commit**

```bash
git add lib/ui/science-cards.ts extensions/beril-governance.ts test/beril-governance.test.ts && \
git commit -m "feat(governance): read-only claim_ledger card parsed from plan/report"
```

### Task 13: suggest-research competing-hypotheses criterion

**Files:** Modify `skills/suggest-research/SKILL.md`

- [ ] **Step 1:** In its candidate-scoring rubric, add a medium-weight **Competing hypotheses / resolvability** criterion: "Does the suggested project identify competing explanations and have the data to *discriminate* between them — i.e. is it resolvable, not just additive?"
- [ ] **Step 2: Commit**

```bash
git add skills/suggest-research/SKILL.md && \
git commit -m "feat(suggest-research): score candidates on resolvability (competing hypotheses)"
```

---

## Final verification

- [ ] `bun run check` — tsc + biome clean.
- [ ] `bun run test` — all TS tests pass.
- [ ] `uv run --group test pytest tests/ -q` — Python unaffected/green.
- [ ] `pi install -l .` loads the package (new `beril-refute` extension registers; `/berdl-refute` appears).
- [ ] Manual smoke (1 project): `/research-plan` asks clarifying Qs + runs feasibility + drafts rivals/falsification; `/synthesize` produces confidence tiers + Supports/Refutes + assumptions ledger; `/berdl-refute` writes REFUTATION_1.md; `/berdl-review` flags an over-confident finding; `claim_ledger` renders.

## Notes on parallel execution

- Wave 1 Tasks 1–5 touch disjoint files (`lib/science.ts`, `lib/conduct.ts`, `research-plan`, `synthesize`, `review-rubric`+`berdl-review`) → safe to run as parallel subagents.
- Wave 2 Tasks 7 and 8 both edit `lib/ui/science-cards.ts` → one owner for that file (run 7 then 8, or merge into one subagent). Tasks 6 and 9 are file-disjoint from each other and from 7/8.
- Wave 3 Task 12 edits `science-cards.ts` again → sequence after Wave 2's card work.
