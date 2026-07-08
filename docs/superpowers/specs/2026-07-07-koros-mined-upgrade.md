# KOROS-mined UI/UX + gating + provenance upgrade

Date: 2026-07-07 · Branch: `feat/ui-ux-upgrade`

## Motivation

Mined from a deep-dive of KOROS (kbaseincubator/koros — the sibling co-scientist
"discipline layer"), KING (its GUI harness), the workshop report (11 BER
scientists, "Toward Calibrated Trust"), and a 2025–2026 landscape sweep
(Google Co-Scientist, Kosmos, Sakana v2, RO-Crate, nanopublications).

Guiding constraint (KOROS's own two-arm finding): *mechanically enforcing
mechanizable gates adds ~nothing for capable agents* — the wins are
**system-level**: gate legibility, cumulative cross-project memory, data
validation as a capability, provenance interoperability, and honest
infra-vs-science separation. Enforcement stays light (confirm/record/override,
never silent walls), matching beril's existing philosophy. Everything is
free/keyless, stdlib-first, nothing third-party in a core path.

## Feature slate

| # | Feature | Source idea | Where |
|---|---|---|---|
| 1 | Typed gate registry + `/gates` + recorded verdicts/overrides | KOROS gate catalog (auto/judgment/human), D180 plain-language help, override-as-metric | `lib/gates.ts`, `beril lifecycle gate`, `beril-governance` |
| 2 | Data-validity check ("0 ≠ measured", numeric-as-string, pseudoreplication) | KOROS `data_validity_check.py` — their most consistently-earning gate | `beril validate`, `berdl_validate` tool |
| 3 | Coherence / record-currency check; blocks `reviewed→complete` (overridable) | KOROS coherence forcing gate (D100/D101) + KING record-health | `beril lifecycle coherence` |
| 4 | Content-addressed knowledge commons (finding/lesson/gap) + reuse-framed check | KOROS Agora (D106/D113–115) + KING D55 presentation calibration; negative-results memory | `beril commons`, `beril-commons.ts` |
| 5 | RO-Crate export | RO-Crate 1.1 / Workflow Run Crate — the pragmatic FAIR floor | `beril crate` |
| 6 | Content-addressed claim UIDs + claim-type tiering (data/literature/synthesis) | nanopub Trusty-URIs; Kosmos: synthesis claims empirically weakest (57.9% vs 85%) | `lib/science.ts`, `lib/claim-state.ts` |
| 7 | SYSERROR: infra errors never dressed as science | KING chrome contract (D66 conservative matcher) | `lib/syserror.ts` |
| 8 | Doctor with `{name, ok, detail, fix, optional}` + honest overall ok | KING doctor ("N silent failures → N named ones") | `beril doctor` |
| 9 | Figures card after notebook runs + `/figures` | #1 unaddressed workshop ask ("want to look at the plot") | `lib/figures.ts`, `beril-analysis` |

Deferred (recorded, not built now): depth-challenger (needs on-cluster env
probe), Elo idea tournament, editable plan cards, autonomy dial.

## Contracts

All new CLI verbs print exactly one JSON value on stdout (no BERDL/hub access →
no temp-file dance needed; only a future `validate --table` mode would follow
the `query_cmd` temp-file pattern).

### 1. `beril lifecycle gate <project> ...`

```
beril lifecycle gate <project> --record <gate-id> --verdict pass|fail --note "<why>" [--by <orcid>]
beril lifecycle gate <project> --override <gate-id> --reason "<why>" --by <orcid>
beril lifecycle gate <project> --list
```

Appends to a `gates:` list in `beril.yaml` (canonical key order gains `gates`
after `artifacts`): records `{gate, verdict, note, by?, at}`; overrides
`{gate, override: true, reason, by, at}`. `--override` REQUIRES `--by` (an
override is a human act). Trace rows `lifecycle.gate`. `--list` emits
`{"gates": [...]}`. Recording is append-only (a re-record supersedes by being
later in the list; readers take the last entry per gate id).

### 2. `beril lifecycle coherence <project>`

Filesystem-only record-currency check (never trusts agent bookkeeping):

```json
{"ok": false, "checks": [
  {"id": "report-present",  "ok": true,  "detail": "REPORT.md exists"},
  {"id": "claims-current",  "ok": false, "detail": "claims.json older than REPORT.md"},
  {"id": "record-current",  "ok": false, "detail": "provenance 2 artifact(s) behind (newest: figures/f2.png)"},
  {"id": "trace-present",   "ok": true,  "detail": "TRACE.jsonl has rows"}
], "record_behind": 2}
```

Checks: `report-present` (REPORT.md exists when status ∈ analysis/reviewed/
complete, else ok), `claims-current` (claims.json mtime ≥ REPORT.md mtime when
both exist), `record-current` (provenance.json/TRACE.jsonl newest mtime ≥
newest `notebooks/*.ipynb` + `figures/*` mtime; `record_behind` = count of
newer artifacts), `trace-present`. `ok` = all checks ok.

**Enforcement:** `lifecycle set <project> complete` (from `reviewed`) runs
coherence; on failure raises LifecycleError naming the failing checks, unless
`--override-coherence --reason "<why>" --by <orcid>` is passed, which records a
gate override (`gate: "coherence"`) and proceeds.

### 3. `beril validate --rows-json <file> [--group-col <col>] [--axis <col>]`

`--rows-json`: JSON array of flat row objects (what `berdl_query` returned).
Pure-Python profiling in `beril_cli/validate.py` (import-safe, tested):

- per-column: `null_frac` (None/NaN/empty-string/`na|n/a|none|unknown|missing`
  case-insensitive), `distinct`, inferred dtype
- `zero-sentinel`: exact-0 fraction ≥ 0.3 on a numeric column with otherwise
  nonzero spread → warn "0 may mean not-measured"
- `numeric-as-string`: ≥ 90% of a string column's non-null values castable to
  float → warn (lexicographic ordering inverts numeric comparisons)
- `tiny-variance`: numeric column with > 10 rows and stdev ≈ 0 → info
- `--axis <col>`: categorical scan → effective n (missing-like values excluded)
  vs raw n; warn when effective < 3 groups or any group n == 1
- `--group-col <col>`: pseudoreplication — warn when rows/distinct-groups ≥ 5
  ("N rows collapse to M independent groups; analyze at the group grain")

Output:

```json
{"n_rows": 120, "columns": [{"name": "ph", "dtype": "float", "null_frac": 0.02, "distinct": 88, "flags": ["zero-sentinel"]}],
 "findings": [{"check": "zero-sentinel", "severity": "warn", "column": "ph", "detail": "34% exact zeros — 0 may mean not-measured"}],
 "verdict": "warn"}
```

`verdict`: `pass` (no warn), `warn` (≥1 warn). Never `block` — this is a
judgment gate; the human decides, the tool informs.

### 4. `beril commons <verb>`

Store root: `$BERIL_COMMONS_DIR` or `~/.beril/agora/`. Layout:
`index.jsonl` (append-only manifest) + `objects/<sha256[:2]>/<sha256>`
(body bytes; knowledge bodies also inline in the index for queryability).

Record: `{"kind": "finding|lesson|gap", "body": "<text ≤ 2000 chars>",
"sha256": "<hex of body>", "by": "<orcid|''>", "project": "<id>",
"created": "<iso>", "visibility": "project", "tags": []}`.
Dedup: skip when sha256 already in index. Nothing with `visibility: private`
lands (the API just doesn't accept it).

```
beril commons land <project> --kind finding --text "..." [--tag t]   # one entry
beril commons land <project> --from-report                          # extract
beril commons query --q "<text>" [--k 5]
beril commons list [--project <id>] [--kind <k>]
```

`--from-report` extracts: findings = REPORT.md `## Findings`-section bullets
(fallback: claims.json rows' `claim` text with status `supported`); gaps =
REPORT.md `## Open questions`/`## Gaps` bullets; lessons = surviving checks
from the newest `REFUTATION_N.md` (lines under a `## Surviving` heading, plus
any line starting `- SURVIVES:`) — negative results become durable memory.
Output `{"landed": n, "skipped_duplicates": m, "by_kind": {...}}`.

`query`: stdlib tf-idf cosine over index bodies →
`{"verdict": "novel|related|overlap", "matches": [{"score": 0.42, "kind": "gap",
"project": "...", "body": "...", "created": "..."}]}`.
Verdict thresholds: top score < 0.15 → `novel`; < 0.5 → `related`; else
`overlap`. (Presentation reframing is TS-side, per KING D55.)

### 5. `beril crate <project>`

Writes `<project>/ro-crate-metadata.json` (RO-Crate 1.1 JSON-LD,
`@context: https://w3id.org/ro/crate/1.1/context`). Entities: root `Dataset`
(name = project_id, description from beril.yaml if present, datePublished =
now, author → `Person` entities with `@id: https://orcid.org/<orcid>` from
`authors`), one `File` entity per REPORT.md / `notebooks/*.ipynb` /
`figures/*` / claims.json / provenance.json that exists (with `sha256` and
`contentSize`), and one `CreateAction` per notebook (`instrument` = the
notebook File, `agent` = first author Person, `result` = the figure Files) so
runs validate against the Workflow Run Crate vocabulary. Merge-not-clobber is
NOT needed — the crate is a derived artifact, regenerate whole. Output
`{"crate": "<path>", "entities": n}`.

### 6. `beril doctor` (upgrade)

Keep existing checks; reshape each to
`{"name": ..., "ok": bool, "detail": ..., "fix": "<copy-pasteable command or ''>", "optional": bool}`
and add top-level `"ok"` = every non-optional step ok. Human-rendered output
keeps working; `--json` (add if absent) emits the structure.

### 7. TS: `lib/gates.ts`

```ts
export type GateType = "auto" | "judgment" | "human";
export interface GateDef {
  id: string;                    // "data-validity"
  edge: string;                  // "active→analysis"
  type: GateType;
  what: string;                  // plain language, no jargon
  needs: string;                 // "your move"
  whoDecides: string;            // "you" | "the record" | "a recorded judgment"
}
export const GATE_CATALOG: readonly GateDef[];
export function gatesForEdge(from: string, to: string): GateDef[];
export function formatGateReference(recorded?: GateRecord[]): string[]; // /gates body
export interface GateRecord { gate: string; verdict?: "pass" | "fail"; override?: boolean; note?: string; reason?: string; by?: string; at: string }
export function latestVerdicts(records: GateRecord[]): Map<string, GateRecord>;
```

Catalog (maps EXISTING enforcement to legible gates + the two new ones):

| edge | gate | type | enforced by |
|---|---|---|---|
| exploration→proposed | commons-check | auto (advisory) | `beril commons query` at start |
| exploration→proposed | feasibility | judgment | `berdl_feasibility` + recorded verdict |
| proposed→active | plan-approval | human | research-plan checkpoint |
| active→analysis | report-present | auto | lifecycle `_validate_analysis_gate` |
| active→analysis | claims-present | auto | lifecycle `_validate_analysis_gate` |
| active→analysis | data-validity | judgment | `berdl_validate` + recorded verdict |
| analysis→reviewed | independent-review | judgment | `/berdl-review` (advisory AI review) |
| analysis→reviewed | orcid-signoff | human | `promoteWithSignoff` (existing) |
| reviewed→complete | coherence | auto | `beril lifecycle coherence` (blocks, overridable) |
| reviewed→complete | commons-landed | judgment | `beril commons land --from-report` |

### 8. TS: `lib/syserror.ts`

```ts
export interface SysError { kind: "rate-limit" | "auth" | "billing" | "overloaded" | "connectivity"; detail: string }
export function classifySysError(text: string): SysError | null;
```

CONSERVATIVE (KING D66): match only structured tokens —
`rate_limit_error`, `overloaded_error`, `authentication_error`,
`invalid_api_key`, `insufficient_quota`, `credit balance is too low`,
`billing_error`, HTTP-error-shaped JSON (`"type":"error"` with the above), and
beril connectivity (`isConnectivityError` re-export path). A science sentence
containing "rate" / "429" / "credit" MUST stay null — locked by test.

### 9. TS: science.ts + claim-state.ts additions

```ts
export type ClaimType = "data" | "literature" | "synthesis";
export function claimTypeForEvidence(supports: EvidencePointer[]): ClaimType;
// ≥1 result pointer and 0 paper/web → "data"; 0 result and ≥1 paper/web →
// "literature"; both, or none at all → "synthesis".
export function synthesisBar(view: { confidence, supports, refutes, refutesSearched? }): boolean;
// true when a SYNTHESIS claim asserts high/medium without BOTH ≥2 distinct
// grounded sources AND (refutes.length > 0 || refutesSearched) — the Kosmos
// 57.9% rule; rendered as a flag alongside tierMismatch, does not change tiers.
```

claim-state rows gain `claim_uid: "sha256:<hex>"` = sha256 of
`normalize(claim) + "\n" + sorted(support locators).join("\n")` (normalize =
trim, collapse whitespace, lowercase). Stable across plan re-parses; changes
when the claim text or its evidence set changes (that's the point —
tamper-evidence). Existing positional `claim_id` stays for continuity. Rows
also gain `claim_type`.

### 10. TS: lib/figures.ts + cards

```ts
export function newFigures(projectDir: string, sinceMs: number): string[]; // figures/* mtime > since
export function openCommand(path: string): string[];                      // ["open", p] darwin, ["xdg-open", p] else
```

Cards (in `lib/ui/`, following science-cards.ts conventions — glyphs from
glyphs.ts, no emoji, ASCII fallback):
- `validationCard(result)` — verdict badge + per-finding lines
- `commonsCard(result)` — REUSE-FRAMED three-tier headline (KING D55): novel →
  "novel — reusable context, no duplicate"; related → "looks distinct — related
  prior work below"; overlap → "strong overlap — skim the top match, then build
  on it". Gaps rendered distinctly ("open gap — most actionable"). NEVER
  "don't redo".
- `figuresCard(paths)` — one OSC-8 file link per figure + "open with /figures"
- `sysErrorCard(err)` — visually distinct from science cards ("infrastructure,
  not science")
- gate reference rendering for `/gates`

## Extension wiring (phase 3)

- `beril-data`: `berdl_validate` tool `{rows_json?: string (JSON array), group_col?, axis?}`
  (writes rows to a temp file, calls `beril validate`), renders validationCard.
- `beril-governance`: `/gates` (catalog + `beril lifecycle gate --list` merge);
  `lifecycle_transition` tool passes through coherence failure text and, after
  an interactive confirm, retries with `--override-coherence`.
- New `extensions/beril-commons.ts`: `commons_check` tool (query + card),
  `commons_land` tool, `/commons [query|land]` command; after a successful
  `/submit`, hint to land.
- `beril-analysis`: `notebook_run` result hook → figuresCard when new figures
  exist; `/figures` opens the latest (via pi.exec open/xdg-open, confirm-free —
  read-only viewer launch).
- Error paths in beril-data/beril-review render sysErrorCard when
  `classifySysError` matches.
- `beril crate` invoked from `/submit` preflight (before upload) so every
  submission carries a crate.

## Testing

- Python: pytest units for validate profiling (fixtures with the exact traps:
  zero-sentinel, numeric-as-string lexicographic inversion, pseudoreplication),
  commons land/dedup/query/from-report extraction, crate JSON-LD shape,
  lifecycle gate record/override/list, coherence checks + the
  reviewed→complete block + override path, doctor schema.
- TS: node --test units for gates catalog/latestVerdicts, syserror
  (incl. the science-sentence-stays-null lock), claimType/synthesisBar/
  claim_uid stability, figures, card smoke tests (strip-safe TS only).
