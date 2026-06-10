# Unified Theme — Design Spec (Layer B/C: rendering primitives & card migration)

**Date:** 2026-06-09
**Branch:** `feat/scientific-method`
**Status:** Approved (option C, phase 2). Builds on Layer A (`2026-06-09-unified-theme-design.md`).

## 1. Problem

Layer A unified beril's *colors and glyphs*. The *structure* is still ad-hoc: each science
card hand-assembles a `linesCard`/`markdownCard` with its own header text, no labeled
section dividers, no state-driven border, and no collapse affordance. oh-my-pi's polish comes
from the opposite discipline — **two shared primitives + zero magic numbers**: every result is
one header builder over one state-bordered card body, with centralized truncation/collapse
limits. This spec brings that structure to beril by **re-implementing the patterns on beril's
existing `card.ts`** (NOT importing oh-my-pi's fork — beril targets published Pi 0.78.1).

## 2. Goal

- One **card header** builder and one **state-bordered card** with **labeled sections** and a
  **collapse affordance**, reused by every card.
- A **two-tier loudness** model: live/error cards pop (accent/error border); settled results
  recede (`borderMuted`). This is beril's "quiet plumbing" goal, done structurally.
- Centralized **limits** (no magic numbers) for truncation/collapse.
- Markdown `md*` role correctness.
- Give the (Layer-A-recolored but dead) `evidenceCard` a **live read-only home**.

## 3. Principles & invariants

- **Re-implement, don't import.** Build on beril's existing pi-tui primitives (`visibleWidth`,
  `truncateToWidth`, `wrapTextWithAnsi`, `Markdown`, `Component`) + beril's own `padTo`. No
  dependency on oh-my-pi packages or unverified pi-tui exports.
- **Additive & backward-compatible.** Extend `card.ts` (new optional `state`/`sections`/`headerMeta`);
  keep `frameCard`/`linesCard`/`markdownCard`/`textCard` working so existing callers/tests don't break.
- Keep Layer-A invariants: closed `themes/beril.json`, hand-rolled `hexFg`, `\x1b[39m` fg-only
  reset, `context.isError → errorCard`, `visibleWidth` not `.length`, glyph+word+color redundancy.
- Sanitize on every render path (tabs→spaces, truncate by cells) — oh-my-pi's `AGENTS.md` rule.

## 4. Design

### 4.1 `lib/ui/render-utils.ts` (NEW — pure helpers)
```ts
export const PREVIEW_LIMITS = { collapsedLines: 3, expandedLines: 12, collapsedItems: 8 } as const;
export const TRUNCATE = { title: 60, content: 80, line: 110, short: 40 } as const;
export type CardState = "running" | "pending" | "success" | "error" | "warning" | "settled";
export function statusIcon(theme, state): string;            // glyph+color per state (reuses GLYPH+roles)
export function badge(theme, label, role?): string;          // "[label]" colored
export function moreItems(n: number, noun: string): string;  // "… 7 more lines" (pluralized)
export function expandHint(theme, expanded: boolean, hasMore: boolean): string; // dim "[Ctrl+O: Expand]" or ""
export function capPreviewLines(lines: string[], limit: number): string[];      // head+tail windowing w/ "… N more"
export function sanitizeLine(s: string): string;             // tabs→spaces
```
No magic numbers anywhere else — every card reads these.

### 4.2 `lib/ui/card.ts` (EXTEND — backward-compatible)
- Add to `CardOptions`: `state?: CardState` (→ default border color when no `accent`/`accentStyle`:
  running/pending→`accent`, error→`error`, warning→`warning`, success/settled→`borderMuted`),
  `sections?: { label?: string; lines: string[] }[]` (render `├─ label ─┤` tee dividers between
  sections via the frame's accent paint), `headerMeta?: string` (dim text right-aligned into the
  top bar, after the title). Existing `body` path unchanged.
- Add `framedBlock(theme, build: (innerWidth:number)=>CardOptions): Component` convenience (mirrors
  oh-my-pi) returning the cached card Component.
- `frameCard` stays pure + width-exact; section dividers are width-exact too.

### 4.3 `lib/ui/status-line-header.ts` (NEW — the one header builder)
```ts
export function cardHeader(theme, o: { icon?: string; title: string; summary?: string; badge?: string; meta?: string[] }): string;
// → `${icon} ${bold(title)}${summary?`: ${muted(summary)}`:""} ${badge??""} ${dim(meta.join(" · "))}`
// flattenForHeader() strips CR/LF so a header can never break the frame.
```
Cards pass `header: cardHeader(...)` as their `title` (the frame insets it).

### 4.4 Migrate `science-cards.ts` (keep builder signatures; change internals)
- **evidenceCard** → `sections: [{label:"Supports", lines}, {label:"Refutes", lines}, {label:"Unresolved", lines}]` with the Layer-A role colors/glyphs; header carries `meta: ["⊕ n", "▽ n"]`; `state` from status (refuted→error, supported→success, else settled).
- **feasibilityCard** → checks as the body, `Blockers`/`Opportunities` as labeled sections; `state` = answerable→success, partial→warning, not-answerable→error.
- **queryCard / peekCard / litCard / notebookRunCard / discoverCard** → `state:"settled"` (`borderMuted`) so routine results recede; failed notebookRun → `state:"error"`. Header via `cardHeader`. Collapse long bodies with `PREVIEW_LIMITS` + `expandHint` (cards already receive `expanded`).
- **claimLedgerCard** → keep the Layer-A hand-drawn aligned table; add the `cardHeader` + `state`.
- **hashCard / scaffoldCard / lifecycleCard / userCard / destructiveResultCard** → header + appropriate `state` (destructive→warning).
- Update `test/science-cards.test.ts` for the new structure (sections render, state borders, headers present).

### 4.5 `lib/ui/markdown-theme.ts` (role correctness)
- READ it; ensure it supplies the FULL `ThemeStyler` and distinct `md*` roles (`mdLink`≠`mdLinkUrl`,
  `mdCode`≠`mdCodeBlockBorder`). beril uses pi-tui's `Markdown` (spacing is the renderer's job, not
  ours), so this is just verifying/tightening the role mapping — small.

### 4.6 Live evidence tool (the deferred Layer-A bit)
- Add a read-only `evidence` tool (in `extensions/beril-governance.ts`, alongside `claim_ledger`):
  params `{ project, finding? }`; parse the target finding's `Supports:`/`Refutes:`/`Unresolved`
  pointers + its confidence/status from `REPORT.md` (reuse the `lib/claim-ledger.ts` parsing
  conventions — extract a shared `parseEvidence(reportMd, finding)` into `lib/claim-ledger.ts`);
  render `evidenceCard`. Persists nothing; guards `context.isError`. + test.

## 5. Testing

- `render-utils`: pure-function tests (moreItems pluralization, expandHint suppression, capPreviewLines head+tail, sanitizeLine tabs).
- `card.ts`: a `sections` card is width-exact and shows `├─ label ─┤`; `state` sets the border; backward-compat (no-section card identical to before).
- `status-line-header`: composes icon/title/summary/badge/meta; flattens newlines.
- `science-cards`: each migrated card renders (populated + empty), sections present, state border applied, `context.isError`-guarded; the `evidence` tool parser yields the right pointers from a fixture.
- Gate each wave: `tsc --noEmit` + `bun run test` + scoped biome.

## 6. Risks

- `card.ts` is imported everywhere — the extension must be strictly additive; run the full suite after.
- Section dividers must stay width-exact or the TUI errors — unit-test widths.
- Migrating cards will churn `science-cards.test.ts` — expect broad-but-surgical test edits.
- The `evidence` tool parsing depends on the REPORT.md conventions from the scientific-method
  skills; keep it lenient (missing finding → empty card, never throw).

## 7. Sequencing (waves)

- **B1 — primitives (additive, parallel-disjoint):** `render-utils.ts` (new), `status-line-header.ts` (new), `card.ts` (extend: state/sections/headerMeta/framedBlock). + their tests.
- **B2 — migrate cards (sole owner of science-cards.ts):** rebuild every card on header+sections+state+collapse; update `science-cards.test.ts`.
- **B3 — markdown + live evidence + loudness:** `markdown-theme.ts` role check; the `evidence` tool + `parseEvidence` in `claim-ledger.ts`; confirm two-tier loudness across cards.

Each wave committed after `tsc` + `bun run test` pass.
