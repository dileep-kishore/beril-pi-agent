# Unified Theme (Layer B/C) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps `- [ ]`.

**Goal:** bring oh-my-pi's card *structure* to beril — one header builder + a state-bordered card with labeled sections + centralized collapse limits + two-tier loudness + a live evidence tool — re-implemented on beril's `card.ts` (no fork dependency). Spec: `docs/superpowers/specs/2026-06-09-unified-theme-rendering-design.md`.

**Architecture:** additive extension of `lib/ui/card.ts` (`state`/`sections`/`headerMeta`/`framedBlock`), two new pure modules (`render-utils.ts`, `status-line-header.ts`), then migrate `science-cards.ts` cards onto them and add a read-only `evidence` tool.

**Tech:** TS strip-only, bun, existing pi-tui primitives (`visibleWidth`/`truncateToWidth`/`wrapTextWithAnsi`). Gate each wave: `bunx tsc --noEmit` + `bun run test` + scoped biome.

**Invariants:** additive/backward-compatible (all of `test/card.test.ts` MUST stay green); width-exact frames; `hexFg` kept; `\x1b[39m` fg-only; `context.isError → errorCard`; `visibleWidth` not `.length`. NOTE: `markdown-theme.ts` is already role-correct — no change.

---

## WAVE B1 — primitives (3 disjoint files → parallel)

### Task 1: `lib/ui/render-utils.ts` (NEW, pure) + `test/render-utils.test.ts`
- [ ] Create `lib/ui/render-utils.ts`:
```ts
import type { Theme } from "@earendil-works/pi-coding-agent";
import { GLYPH } from "./glyphs.ts";

export const PREVIEW_LIMITS = { collapsedLines: 3, expandedLines: 12, collapsedItems: 8 } as const;
export const TRUNCATE = { title: 60, content: 80, line: 110, short: 40 } as const;

/** Card lifecycle/result state → border + icon semantics. */
export type CardState = "running" | "pending" | "success" | "error" | "warning" | "settled";

type IconTheme = Pick<Theme, "fg">;

/** A colored status glyph for a card state (operational axis; reuses GLYPH). */
export function statusIcon(theme: IconTheme, state: CardState): string {
  switch (state) {
    case "success": return theme.fg("success", GLYPH.ok);
    case "error": return theme.fg("error", GLYPH.bad);
    case "warning": return theme.fg("warning", GLYPH.warn);
    case "running": return theme.fg("accent", GLYPH.inProgress);
    case "pending": return theme.fg("muted", GLYPH.pending);
    default: return theme.fg("dim", GLYPH.bullet);
  }
}

/** A colored `[label]` badge. */
export function badge(theme: IconTheme, label: string, color: Parameters<Theme["fg"]>[0] = "muted"): string {
  return theme.fg(color, `[${label}]`);
}

/** "… 7 more lines" (pluralized). */
export function moreItems(remaining: number, noun: string): string {
  return `… ${remaining} more ${noun}${remaining === 1 ? "" : "s"}`;
}

/** Dim "[Ctrl+O: Expand]" hint, suppressed when expanded or nothing more. */
export function expandHint(theme: IconTheme, expanded: boolean, hasMore: boolean): string {
  return !expanded && hasMore ? theme.fg("dim", "[Ctrl+O: Expand]") : "";
}

/** Head+tail window: keep the first ceil(limit/2) and last floor(limit/2) with a middle "… N more lines". */
export function capPreviewLines(lines: string[], limit: number): string[] {
  if (lines.length <= limit) return lines;
  const head = Math.ceil(limit / 2);
  const tail = Math.floor(limit / 2);
  return [...lines.slice(0, head), moreItems(lines.length - head - tail, "line"), ...lines.slice(lines.length - tail)];
}

/** Tabs → 2 spaces (terminal-safe), per oh-my-pi's sanitization rule. */
export function sanitizeLine(s: string): string {
  return s.replace(/\t/g, "  ");
}
```
- [ ] `test/render-utils.test.ts`: `moreItems(1,"line")`==="… 1 more line"; `moreItems(3,"row")`==="… 3 more rows"; `expandHint(stub,false,true)` non-empty, `expandHint(stub,true,true)`===""; `capPreviewLines([1..10].map(String),4).length`===5 and includes a "more lines" row; `sanitizeLine("a\tb")`==="a  b". (stub theme `{ fg:(_c,s)=>s }`.)
- [ ] `bunx tsc --noEmit`; `node --test test/render-utils.test.ts`; biome --write.
- [ ] Commit: `feat(ui): render-utils — collapse limits, status icon, badge, expand hint`

### Task 2: `lib/ui/status-line-header.ts` (NEW) + `test/status-line-header.test.ts`
- [ ] Create `lib/ui/status-line-header.ts`:
```ts
import type { Theme } from "@earendil-works/pi-coding-agent";
import { GLYPH } from "./glyphs.ts";

type HeaderTheme = Pick<Theme, "fg" | "bold">;

/** Strip CR/LF so a header can never break the card frame it sits in. */
function flatten(s: string): string {
  return s.replace(/[\r\n]+/g, " ").trim();
}

export interface HeaderParts {
  icon?: string;       // already-colored glyph (e.g. statusIcon(...))
  title: string;
  summary?: string;    // muted, after a colon
  badge?: string;      // already-colored [badge]
  meta?: string[];     // dim, joined by " · "
}

/** The one card header: `{icon} {bold title}: {muted summary} {badge} {dim · meta}`. */
export function cardHeader(theme: HeaderTheme, p: HeaderParts): string {
  const parts: string[] = [];
  if (p.icon) parts.push(p.icon);
  parts.push(theme.bold(flatten(p.title)));
  let head = parts.join(" ");
  if (p.summary) head += theme.fg("muted", `: ${flatten(p.summary)}`);
  if (p.badge) head += ` ${p.badge}`;
  if (p.meta?.length) head += ` ${theme.fg("dim", `${GLYPH.bullet} ${p.meta.map(flatten).join(` ${GLYPH.bullet} `)}`)}`;
  return head;
}
```
- [ ] `test/status-line-header.test.ts` (stub `{ fg:(_c,s)=>s, bold:(s)=>s }`): contains the title; with `summary` contains `": sum"`; with `meta:["a","b"]` contains `a · b`; a title with `"\n"` is flattened (no newline in output).
- [ ] `bunx tsc --noEmit`; `node --test`; biome --write.
- [ ] Commit: `feat(ui): cardHeader — one header builder (icon/title/summary/badge/meta)`

### Task 3: extend `lib/ui/card.ts` (state / sections / headerMeta / framedBlock)
**Files:** Modify `lib/ui/card.ts`; extend `test/card.test.ts` (do NOT change existing cases — they must pass).
- [ ] Import `type CardState` from `./render-utils.ts`. Add to `CardOptions` (all optional): `state?: CardState`, `sections?: { label?: string; lines: string[] }[]`, `headerMeta?: string`.
- [ ] **state → border:** when neither `accent` nor `accentStyle` is given AND `state` is set, paint with `theme.fg(stateAccent[state], …)` where `stateAccent = { running:"borderAccent", pending:"borderAccent", error:"error", warning:"warning", success:"borderMuted", settled:"borderMuted" }`. When `state` is absent, behavior is exactly as today (`accent ?? "borderAccent"`).
- [ ] **headerMeta:** if set, render it dim immediately after the title on the top bar — `╭─ {title}  {dim meta} ─…─╮` — recomputing the filler dashes from `visibleWidth(title)+visibleWidth(meta)` so the line stays exactly `w` columns. (Reuse the existing truncate-title logic; truncate meta too if needed.)
- [ ] **sections:** when `sections` is provided (instead of / in addition to `body`), render each section as: an optional divider row `├─ {label} ─…─┤` (width-exact `w` columns, painted by the same `paint`) when `label` is present and it's not the very first row, followed by the section's `lines` (padded like body lines). A section with no label and not-first emits a plain `├{─×(w-2)}┤` divider. Implement a pure `sectionDivider(paint, label, w)` returning a string of `visibleWidth === w`.
- [ ] **`framedBlock(theme, build)`:** add `export function framedBlock(theme: Theme, build: (innerWidth: number) => CardOptions): Component` that calls `cardComponent` with `getBody`/sections from `build`. (Convenience; optional for callers.)
- [ ] Extend `test/card.test.ts` (ADD cases, keep all 7 existing): a `sections:[{label:"A",lines:["x"]},{label:"B",lines:["y"]}]` card is width-exact at widths [20,40,80] and some line contains `┤`; a `state:"error"` card (no accent) is width-exact; a `headerMeta:"3 rows"` card is width-exact and the top line includes `3 rows`.
- [ ] `bunx tsc --noEmit`; `node --test test/card.test.ts`; biome --write.
- [ ] Commit: `feat(ui): card.ts — state borders, labeled sections, header meta, framedBlock`

---

## WAVE B2 — migrate cards (sole owner of science-cards.ts; AFTER B1)

### Task 4: rebuild `science-cards.ts` cards on header + sections + state
**Files:** Modify `lib/ui/science-cards.ts`; update `test/science-cards.test.ts`.
- [ ] Import `cardHeader` (`./status-line-header.ts`), `statusIcon`/`badge`/`PREVIEW_LIMITS`/`expandHint`/`moreItems`/`type CardState` (`./render-utils.ts`).
- [ ] **evidenceCard:** render as `sections` — `{label:"Supports", lines}`, `{label:"Refutes", lines}`, `{label:"Unresolved", lines}` (keep the Layer-A role glyphs/colors inside each); title via `cardHeader({ icon: statusIcon(theme, evState), title:"Evidence", summary: v.status, meta:[`${GLYPH.supports} ${v.supports.length}`, `${GLYPH.refutes} ${v.refutes.length}`] })`; `state` = refuted→"error", supported→"success", else "settled".
- [ ] **feasibilityCard:** body = the per-check lines; add `sections` for `Blockers` and `Opportunities` when non-empty; `state` = answerable→"success", partial→"warning", not-answerable→"error"; title via `cardHeader`.
- [ ] **queryCard / peekCard / litCard / discoverCard:** add `state:"settled"` (recede via borderMuted) + `cardHeader`. Keep the existing markdown/table bodies. Collapse via `PREVIEW_LIMITS`/`expandHint` where a body can be long (respect the `expanded` flag they already receive).
- [ ] **notebookRunCard:** `state` = `r.ok ? "success" : "error"`; header carries `meta:[`${executed.length} run`]`.
- [ ] **claimLedgerCard:** keep the Layer-A hand-drawn aligned table; add `cardHeader` title + `state:"settled"`.
- [ ] **destructiveResultCard:** `state:"warning"`. **hashCard / scaffoldCard / lifecycleCard / userCard:** add `cardHeader` + a sensible `state` (settled).
- [ ] Keep ALL builder export signatures unchanged (extensions call them) and keep `context.isError → errorCard` in every `renderResult` (unchanged in the extensions).
- [ ] Update `test/science-cards.test.ts`: assert sections render for evidenceCard (a `┤` divider + Supports/Refutes labels), state borders applied, headers present. Keep empty-slot cases.
- [ ] `bunx tsc --noEmit`; `node --test test/science-cards.test.ts`; biome --write.
- [ ] Commit: `feat(ui): migrate science cards to header + sections + state borders (two-tier loudness)`

---

## WAVE B3 — live evidence tool (AFTER B2)

### Task 5: `evidence` tool + `parseEvidence`
**Files:** Modify `lib/claim-ledger.ts` (add `parseEvidence`), `extensions/beril-governance.ts` (add tool); test `test/claim-ledger.test.ts`.
- [ ] In `lib/claim-ledger.ts`, add `export function parseEvidence(reportMd: string, finding?: string): EvidenceView | null` (import `EvidenceView`/`EvidencePointer` types — define them in `lib/science.ts` if not already exported there; the card's `EvidenceView` currently lives in science-cards.ts, so MOVE `EvidenceView`/`EvidencePointer` to `lib/science.ts` and re-export from science-cards.ts to avoid a UI import in the pure parser). Parse the first finding whose text matches `finding` (case-insensitive substring), else the first finding: `claim` = finding text; `status`/`confidence` from the Confidence&Caveats line; `supports`/`refutes`/`unresolved` = the bullet lines under each head parsed into `EvidencePointer` (kind from a `[query]`/`[notebook]`/`[figure]`/`[paper]` tag or a `PMID:` marker, else "query"; `locator` = a path/PMID/hash token if present else the bullet; `exact` = the bullet text; `relevance` = ""). Lenient; return `null` if no findings. Never throw.
- [ ] In `extensions/beril-governance.ts`, add a read-only `evidence` tool: params `{ project: string; finding?: string }`; read `projects/<project>/REPORT.md` (tolerate missing → "" → null view); call `parseEvidence`; `renderResult` guards `context.isError` then renders `evidenceCard(theme, view)` (or a muted "no evidence parsed" linesCard when null). Persists nothing.
- [ ] `test/claim-ledger.test.ts`: `parseEvidence` on a fixture REPORT.md with one finding (one `[notebook]` support, `Refutes: none found`, `(**medium**: … Status: needs-evidence)`) returns a view with `supports.length===1` (kind "notebook"), `refutes.length===0`, `status:"needs-evidence"`, `confidence:"medium"`; empty input → null.
- [ ] `bunx tsc --noEmit`; `node --test`; biome --write.
- [ ] Commit: `feat(governance): live read-only evidence tool (parseEvidence + evidenceCard)`

---

## Final verification
- [ ] `bunx tsc --noEmit` clean; `bun run test` all green; scoped biome clean; `pi install -l .` loads.
- [ ] Self-review: every card has a `cardHeader` + a `state`; routine results use `borderMuted` (recede), errors/refutations pop; no magic numbers (all via `PREVIEW_LIMITS`/`TRUNCATE`); `test/card.test.ts` original 7 still pass.

## Notes
- B1 tasks 1/2/3 file-disjoint → parallel. B2 owns science-cards.ts (after B1). B3 after B2 (it moves `EvidenceView` and renders the migrated `evidenceCard`).
- `markdown-theme.ts` is already role-correct (verified) — no task.
