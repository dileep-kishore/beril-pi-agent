# Review dossier — the KOROS-mined co-scientist upgrade

**Audience:** an independent reviewing agent (Codex) with no prior context on
this repo. **Purpose:** (1) understand what was built and why, (2) find defects,
gaps, and mis-calibrations, and (3) propose *new* functionality that makes the
co-scientist more useful. **Branch under review:** `feat/ui-ux-upgrade`
(4 commits atop `5626775`); 41 files, +3529/−88; green at 505 node tests,
303 pytest, `tsc` + biome clean.

Read this top-to-bottom once; then use the "Where to look" and "Review
assignment" sections to drive the actual audit. Everything here is claims *about*
the code — verify against the code, do not trust the prose.

---

## 1. What this product is

`beril-pi-agent` (`@earendil-works/pi-coding-agent`) is a **terminal/TUI research
co-scientist** for the BERDL scientific data lakehouse. It is not a web app and
not a chatbot: it carries a researcher through the full arc — *explore data →
review literature → write a plan → generate + run analysis notebooks →
synthesize a report → review → submit* — rendering every tool result as a titled
"science card," checking in at natural seams, and gating irreversible actions
behind confirmation, reproducibility hashing, and an ORCID identity check. **The
human stays the verifier-of-record; the agent leads with the artifact, not the
command.**

### Architecture: one core split — judgment vs execution vs substrate

- **Skills (`skills/*/SKILL.md`) = scientific judgment.** Pure markdown, invoked
  as `/skill:<name>` or auto-selected by the model. Query patterns, research
  protocols, rubrics, biological interpretation. No execution mechanics.
- **Extensions (`extensions/*.ts`) = the Pi surface.** TypeScript. LLM-callable
  tools, slash-commands, widgets/HUD, custom renderers, event hooks, state, and
  safety gates. They shell out to the bundled `beril` CLI via `lib/beril-exec.ts`
  (`berilExec(pi, [...])` wraps `pi.exec("beril", ...)` and parses one JSON value
  from stdout). They do **not** reimplement lakehouse access in TypeScript.
- **`beril` CLI (`beril_cli/`, Python) = execution substrate.** The proven code
  that does the real work and owns reproducibility. `beril.yaml` is the
  authoritative lifecycle/approval state; `provenance.json` + `TRACE.jsonl` are
  inspectable, non-authoritative audit context. `lib/` (TypeScript) holds the
  shared logic the extensions import; it keeps only fast-path UI caches.

### The lifecycle

Projects move `exploration → proposed → active → analysis → reviewed → complete`
(with legal demotes `reviewed → analysis`, `complete → analysis`), enforced by
`beril_cli/lifecycle.py` (pure transitions) + `lifecycle_cmd.py` (persistence).
Confidence is **computed, never verbalized** (`lib/science.ts`): high = ≥2
independent re-runnable results, medium = exactly 1, low = literature-only. A
second axis, *groundedness*, counts distinct re-runnable sources; a written
confidence that outruns groundedness is a `tierMismatch` flag.

### Two cross-cutting invariants (pre-existing, must not be weakened)

1. **Safety is fail-closed.** Destructive tools (`berdl_export` overwrite,
   `lakehouse_submit`, bash `mc rm`/`rm -rf`, bash touching `.env`/`~/.ssh`) are
   defined in `lib/destructive.ts` and gated centrally by `beril-safety`
   (`tool_call` hook): **blocked** on an untrusted Pi project, **blocked**
   headless (`--print`/`--mode json`/`--mode rpc`), else confirm interactively.
2. **Confidence is calibrated, not asserted.** Claims must never sound more
   certain than their artifacts support; every claim carries a verbatim source
   pointer and, when found, refuting evidence.

### Hard platform constraints (these bite)

- **Pinned Pi has a MINIMAL API** (0.79 line). Verify against
  `docs/superpowers/specs/pi-api-reference.md`; do not design against a newer
  `oh-my-pi` HEAD. No MCP, no built-in subagents (subagents are
  `createAgentSession()` in-process, or a `pi --mode json` subprocess).
- **`node --test` strips types, does not compile.** No `enum`, no constructor
  parameter properties, no namespaces in `lib/`/`extensions/`. String-literal
  unions instead of enums.
- **`renderResult` is called on FAILURE** with `details = {}` and
  `context.isError = true`. Every custom `renderResult` must branch on that.
- **Headless auto-denies `confirm`** → any interactive gate is fail-closed.
- **Text-presentation glyphs only** (`lib/ui/glyphs.ts`); ASCII fallback under
  `NO_COLOR`/non-UTF. No emoji, no Nerd Font.
- **BERDL is currently unreachable in dev** (remote disabled). Anything touching
  Spark can only be unit-tested here; it must be verified on-cluster later.

---

## 2. Ideology & philosophy (why the design is shaped this way)

This upgrade was mined from **KOROS** (`kbaseincubator/koros`, a sibling
co-scientist "discipline layer"), **KING** (its GUI harness), a **demo-workshop
report** (11 BER scientists, "Toward Calibrated Trust"), and a **2025–2026
co-scientist landscape sweep** (Google Co-Scientist, Kosmos/Edison, Sakana v2,
FutureHouse Robin, RO-Crate, nanopublications). The design commitments:

1. **The scientist stays in command.** The workshop's headline finding was that
   *the agent's analytical power is rarely the limiter — the hard problem is the
   human maintaining a mental model, judging what to trust, and knowing when to
   verify.* Every feature is judged by whether it helps the human stay in
   command, not by whether it automates more.

2. **Verification is the path of least resistance.** Trust cues, gates, and
   checks must appear *at the moment they matter* and be cheap to act on. A gate
   that is legible and one keystroke away beats a wall.

3. **Gates are legible and typed, never silent.** Discipline lives on the
   lifecycle *edges*. Each gate is `auto` (re-derived live — a recorded verdict
   never clears it; you fix the inputs), `judgment` (a recorded verdict with a
   note clears it), or `human` (only the scientist's ORCID sign-off; the agent
   may request, never grant). Overrides are recorded and attributed.

4. **Calibrate presentation, not just the ranker** (KING D55). A raw overlap
   score reads as "give up," which is wrong. Anti-redundancy is framed as
   *reuse/build-on*, never "don't redo"; open gaps are surfaced as the most
   actionable prior knowledge.

5. **Honest absence.** "Couldn't measure" ≠ "measured zero." An infra outage is
   never dressed as a scientific result ("the data can't answer this").
   Capabilities degrade honestly rather than failing silently.

6. **Cumulative, reusable science.** Findings, negative results (surviving
   refutations), and open gaps become durable, content-addressed, cross-project
   memory — so the co-scientist builds on prior work instead of starting from
   amnesia each session.

7. **Free + keyless by default; nothing third-party in a core path.** Fit and
   robustness first, then minimal code, then no required paid API. Don't put a
   third-party package in tool access, the safety gate, or reproducibility.

**The load-bearing caution (from KOROS's own two-arm experiments):**
*mechanically enforcing mechanizable gates adds ~nothing for a capable agent* —
the real wins are **system-level**: new capability (data validation, cumulative
memory), legibility (typed gates, inline figures), and honest calibration. This
upgrade deliberately weighted *new capability + new legibility* over *more
enforcement*. A reviewer should hold new proposals to the same bar: does this add
capability/legibility/memory, or is it enforcement a strong model already honors?

---

## 3. The nine features (spec → implementation)

The binding contract spec is
`docs/superpowers/specs/2026-07-07-koros-mined-upgrade.md` (read it — this section
summarizes; the spec is authoritative on JSON shapes and thresholds).

### 3.1 Data-validity gate — `beril validate` / `berdl_validate`
- **Idea (KOROS `data_validity_check.py`, their most consistently-earning gate):**
  profile the rows feeding an analysis for silent conclusion-inverters.
- **Python:** `beril_cli/validate.py` (pure profiling) + `validate_cmd.py`.
  Checks: `zero-sentinel` (≥30% exact-0 on an otherwise-spread numeric column →
  "0 may mean not-measured"), `numeric-as-string` (≥90% of a string column
  castable to float → lexicographic ordering inverts comparisons),
  `tiny-variance` (info), `--axis` categorical coverage (effective vs raw group
  n), `--group-col` pseudoreplication (rows/distinct-groups ≥ 5).
  Output `{n_rows, columns[{name,dtype,null_frac,distinct,flags}],
  findings[{check,severity,column,detail}], verdict: pass|warn}`. Never blocks —
  it is a *judgment* gate.
- **TS:** `berdl_validate` tool in `extensions/beril-data.ts` (accepts `sql` to
  sample or `rows_json`), `validationCard` in `lib/ui/koros-cards.ts`.
- **Skill:** `skills/data-validity/SKILL.md`.

### 3.2 Knowledge commons — `beril commons` / `beril-commons.ts`
- **Idea (KOROS Agora D106/D113–115 + negative-results capture):** a durable,
  content-addressed, cross-project store of `finding`/`lesson`/`gap`.
- **Python:** `beril_cli/commons.py` (store: `index.jsonl` +
  `objects/<sha[:2]>/<sha>`, dedup by sha256, stdlib tf-idf cosine query) +
  `commons_cmd.py`. Store root `$BERIL_COMMONS_DIR` or `~/.beril/agora`.
  `land --from-report` extracts findings, open gaps, and *surviving refutations*
  (durable negative results). Query verdict thresholds: top score <0.15 →
  `novel`, <0.5 → `related`, else `overlap`.
- **TS:** `commons_check` + `commons_land` tools and `/commons` in the new
  `extensions/beril-commons.ts`; `commonsCard` (reuse-framed) in koros-cards.
  Findings auto-land at `/submit`.
- **Skill:** `skills/commons-check/SKILL.md`.

### 3.3 RO-Crate export — `beril crate`
- **Idea:** the pragmatic FAIR floor (RO-Crate 1.1 / Workflow Run Crate).
- **Python:** `beril_cli/crate_cmd.py` emits `<project>/ro-crate-metadata.json`
  (JSON-LD; root `Dataset`, ORCID `Person` authors, `File` entities with
  sha256 + contentSize, a `CreateAction` per notebook). `/submit` regenerates it.

### 3.4 Typed gate registry — `lib/gates.ts` + `gate_record` + `/gates`
- **Idea (KOROS gate catalog + D180 plain-language help):** legible, typed gates.
- **TS:** `GATE_CATALOG` (auto/judgment/human, plain-language `what`/`needs`/
  `whoDecides`), `latestVerdicts`, `formatGateReference`; `gateReferenceCard`.
  `gate_record` tool writes a verdict; `/gates` merges catalog + recorded ledger.
- **Python:** `beril lifecycle gate <project> --record|--override|--list`,
  append-only `gates:` list in `beril.yaml`.
- **Skill:** `skills/lifecycle-gates/SKILL.md`.

### 3.5 Coherence gate — `beril lifecycle coherence`
- **Idea (KOROS coherence forcing gate D100/D101 + KING record-health):** a
  filesystem-only record-currency check that never trusts the agent's own
  bookkeeping.
- **Python:** compares provenance/trace/claims mtimes against the newest
  notebook/figure mtime; `{ok, checks[{id,ok,detail}], record_behind}`. Enforced
  on `set reviewed→complete`: blocks unless
  `--override-coherence --reason ... --by <orcid>` (records a coherence override,
  then proceeds).
- **TS:** `lifecycle_transition` catches the block and offers an
  interactive-only, ORCID-attributed override (fail-closed headless).

### 3.6 Claim types + synthesis bar + claim UIDs — `lib/science.ts`, `claim-state.ts`
- **Idea (Kosmos: synthesis is the empirically weakest layer, 57.9% vs 85% data;
  nanopub Trusty-URIs):** type claims and hold synthesis higher; content-address
  claims for tamper-evidence + dedup.
- **TS:** `ClaimType` (data/literature/synthesis), `claimTypeForEvidence`,
  `synthesisBar`; rows gain `claim_uid` (sha256 over normalized claim + sorted
  support locators) and `claim_type` — additive to the existing ledger.

### 3.7 Infra-vs-science separation — `lib/syserror.ts`
- **Idea (KING chrome D66 conservative matcher):** never render plumbing as
  science.
- **TS:** `classifySysError` matches only structured tokens
  (`rate_limit_error`, `overloaded_error`, `authentication_error`,
  billing/quota phrases, gRPC `UNAVAILABLE`/`RETRIES_EXCEEDED`). `errorCard`
  (science-cards.ts) diverts a match to a neutral `sysErrorCard`. A science
  sentence mentioning "rate"/"429"/"credit" MUST stay a normal error (locked by
  `test/syserror.test.ts`).

### 3.8 Inline figures — `lib/figures.ts`, `lib/ui/figure-image.ts`, `/figures`
- **Idea:** the workshop's #1 unaddressed ask ("I just want to look at the plot").
- **TS:** `newFigures(projectDir, sinceMs)` finds figures written during a run;
  `notebook_run` renders them inline via pi-tui `Image` (Kitty/iTerm2) with an
  OSC-8 link fallback (`figuresCard`); `/figures` opens the newest in the OS
  viewer (`openCommand`).

### 3.9 Doctor reshape — `beril doctor`
- **Idea (KING doctor "N silent failures → N named ones"):** every check
  `{name, ok, detail, fix, optional}` with an honest top-level `ok` (all
  non-optional green). `--json` added; human rendering preserved.

**Deferred (recorded, not built):** depth/Stage-2 challenger (needs on-cluster
env probe), Elo idea-tournament, editable plan cards, autonomy dial.

---

## 4. Where to look (file map for the audit)

**New Python (`beril_cli/`):** `validate.py`, `validate_cmd.py`, `commons.py`,
`commons_cmd.py`, `crate_cmd.py`; modified `lifecycle.py` (one line),
`lifecycle_cmd.py` (gate + coherence), `doctor.py` (reshape), `cli.py` (argparse).
Tests: `tests/test_cli_{validate,commons,crate,lifecycle_gate,doctor}.py`.

**New TS (`lib/`):** `gates.ts`, `syserror.ts`, `figures.ts`,
`ui/koros-cards.ts`, `ui/figure-image.ts`; modified `science.ts`,
`claim-state.ts`, `capabilities.ts`, `ui/science-cards.ts` (the sysError divert).
Tests: `test/{gates,syserror,claim-type,claim-uid,figures,koros-cards,beril-commons}.test.ts`.

**Extensions:** new `beril-commons.ts`; modified `beril-data.ts`
(berdl_validate), `beril-governance.ts` (gate_record, /gates, coherence
override, crate + commons land at /submit), `beril-analysis.ts` (figures,
/figures).

**Skills/prompts:** `skills/{commons-check,data-validity,lifecycle-gates}/SKILL.md`;
`prompts/berdl-start.md` (commons + validity woven in).

**Docs:** the spec (`specs/2026-07-07-koros-mined-upgrade.md`), `CLAUDE.md`
(extension list + invariants + surprise notes).

**Commands:** `bun run check` (tsc + biome), `bun run test` (node --test),
`uv run --group test pytest tests/ -q`. Note: biome excludes `beril_cli`,
`scripts`, `tools`, `tests`, `skills`, `prompts` — the Python side lints
separately (`uvx ruff check beril_cli/`).

---

## 5. Known limitations & open questions (be skeptical here)

These are candidly flagged for scrutiny — confirm, refute, or deepen each.

1. **Trust tiers are unbenchmarked.** `tierForEvidence`/`groundednessForEvidence`/
   `synthesisBar` encode plausible rules but have never been validated against
   ground-truth errors. Do the thresholds (≥2 results = high, ≥90% castable =
   numeric-string, ≥30% zeros = sentinel, rows/groups ≥5 = pseudoreplication)
   hold up, or are they arbitrary? Any false-positive/false-negative traps?
2. **Commons query is stdlib tf-idf.** No semantic embedding (keyless
   constraint). Will `novel/related/overlap` mislabel paraphrased overlaps as
   novel? Are the 0.15/0.5 thresholds defensible? Is tf-idf the right floor, or
   is there a cheap keyless improvement (char n-grams, BM25)?
3. **`commons land --from-report` extraction is regex/heading-based.** How
   brittle is it to REPORT.md formatting drift? Does it silently drop findings?
4. **Coherence is mtime-based.** mtime is a weak signal (touch, checkout, clone
   all perturb it). Is there a false-block or false-pass risk? Should it use
   content hashes instead of/in addition to mtime?
5. **`berdl_validate` samples ≤1000 rows via `sql`.** A trap present only in the
   tail (rare sentinel, one miscast row) can be missed. Is the sample honest
   about what it did NOT see?
6. **RO-Crate is a minimal subset.** Does it validate against the RO-Crate 1.1
   spec / Workflow Run Crate profile? Missing required entities?
7. **Claim `claim_uid` normalization** collapses whitespace + lowercases. Does
   that over-collapse distinct claims, or under-collapse trivially-reworded ones?
8. **Figures inline rendering** assumes a graphics-capable terminal; the fallback
   is a link. Untested against real Kitty/iTerm2 here (no display). Any failure
   mode that throws instead of degrading?
9. **The commons is single-user, local.** No multi-user isolation, no
   provenance-on-memory-entry defense against poisoned memory (a named 2025
   attack class). Acceptable for now?
10. **Gate enforcement is partial.** Only `active→analysis` (report/claims
    present) and `reviewed→complete` (coherence) actually block in the CLI; the
    other catalog gates (data-validity, feasibility, independent-review,
    commons-landed, plan-approval) are legible + recordable but not
    machine-enforced. Is that the right line (per the "enforcement adds little"
    caution), or a gap?

---

## 6. Review assignment (what we want from Codex)

Proceed autonomously — **do not ask questions or wait for confirmation.** Make
all findings concrete (file:line), and separate *defects* from *proposals*.

**Part A — Correctness & robustness audit.** For each of the nine features:
find bugs, edge cases, silent-failure paths, and contract mismatches between the
TS tool layer and the Python CLI (arg spellings, JSON shapes, exit codes). Pay
special attention to: the coherence block/override path (can `reviewed→complete`
be reached with a stale record without an attributed override? can the override
be reached headlessly?); the sysError matcher (false positives on science text,
false negatives on real infra errors); commons dedup + extraction; validate
threshold correctness; fail-closed behavior of every new interactive gate; and
whether any new `renderResult` mishandles the error case. Confirm the two
cross-cutting invariants (§1) are not weakened anywhere.

**Part B — Calibration & UX critique.** Judge the design against the philosophy
(§2) and the workshop findings. Are the trust/validity/commons framings actually
*reuse-first* and *calibrated*, or do they still read as walls/scolds? Is
anything alert-fatiguing? Is the "enforcement adds little" caution respected, or
did we add ceremony? Where does the human still lack the mental model?

**Part C — New functionality (the priority).** Propose concrete, buildable
additions that make the co-scientist more useful, ranked by
leverage-to-cost. Hold each to the bar in §2: does it add *capability*,
*legibility*, or *cumulative memory* — not just more enforcement? Prefer
free/keyless, terminal-native, nothing third-party in a core path. For each
proposal give: the idea, the user-research or landscape justification, the
concrete surface (which extension/tool/CLI verb/card/hook), a rough contract,
and the risk. Explicitly consider the deferred items (depth/Stage-2 challenger,
Elo idea-tournament, editable plan cards, autonomy dial) and anything the
landscape systems (Google Co-Scientist, Kosmos, Sakana, Robin) do that a keyless
TUI could adopt cheaply. Also consider: verification-as-one-action (re-run the
cell behind a claim and diff the number), a decision-narrative surface ("why did
you choose X over Y"), proficiency-adaptive verbosity, figure-sanity review,
and durable negative-results retrieval before re-running an idea.

**Deliverable:** a written report with (A) a ranked defect list (severity +
file:line + repro), (B) calibration/UX findings, and (C) a ranked proposal
backlog with enough detail to implement. Do not modify code unless explicitly
asked in a follow-up; this pass is analysis + design.
