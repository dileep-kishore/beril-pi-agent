# Unified Theme (Layer A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Ship the color/glyph/semantic unified theme + footer polish (pure-visual; no data-flow change). Spec: `docs/superpowers/specs/2026-06-09-unified-theme-design.md`.

**Architecture:** `lib/ui/palette.ts` becomes the single role resolver (`roleStyle`, `phaseColor`, re-tuned domains); `lib/ui/glyphs.ts` the single mark table (new glyphs + a unicode/ascii tier). Every surface resolves through them. Two axes (domain frame / semantic body), three channels (glyph>word>color), colorblind-safe supports/refutes, 256 color floor.

**Tech stack:** TS (Pi extensions, `node --test` strip-only), `lib/ui` primitives, bun. Gate each wave on `bunx tsc --noEmit` + `bun run test` + scoped biome.

**Conventions:** keep hand-rolled `hexFg` (no `Bun.color`); `theme.fg` resets fg only; guard `context.isError` in renderResult; `visibleWidth` not `.length`; no new keys in `themes/beril.json`.

---

## WAVE A1 — foundations (MUST land first; A2/A3 import these). 3 disjoint files → parallel.

### Task 1: `themes/beril.json`
- [ ] In `vars`: change `"red": "#cc6666"` → `"red": "#e06c6c"`. Add `"info": "#56b4e9"`. Leave `colors` shape unchanged.
- [ ] Commit: `feat(theme): brighten error red for WCAG AA, add info var`

### Task 2: `lib/ui/palette.ts` — role resolver
**Files:** Modify `lib/ui/palette.ts`; Test `test/palette.test.ts` (create or extend).
- [ ] Re-tune `DOMAIN_HEX`: `analysis "#36c5b0"→"#3aa0c0"`, `governance "#7cba6f"→"#9cc79a"`, `destructive "#e8b84b"→"#d99a3c"`. Add `checkpoint: "#b08cff"` to the `Domain` union + map.
- [ ] Add role types + maps + resolver (append):

```ts
export type Role =
  | "supports" | "refutes" | "unresolved"
  | "confHigh" | "confMedium" | "confLow" | "info";

const ROLE_HEX: Record<Role, string> = {
  supports: "#2ec4b6",
  refutes: "#f0653a",
  unresolved: "#8a929c",
  confHigh: "#d8dee2",
  confMedium: "#8a929c",
  confLow: "#666c75",
  info: "#56b4e9",
};

/** Hand-pinned xterm-256 indices for the colorblind-critical roles so they never
 *  drift under quantization (the lipgloss CompleteColor pattern). */
const ROLE_256: Partial<Record<Role, number>> = {
  supports: 43,
  refutes: 203,
  info: 74,
};

/** ANSI fg for a role, truecolor or 256-pinned, fg-only reset. */
export function roleStyle(theme: ColorModeTheme, role: Role): (s: string) => string {
  const hex = ROLE_HEX[role];
  const pinned = ROLE_256[role];
  return (s: string) => {
    if (pinned != null && theme.getColorMode() === "256color") return `\x1b[38;5;${pinned}m${s}\x1b[39m`;
    return hexFg(theme, hex, s);
  };
}

/** Per-phase accent hex for the phase banner's leading glyph. */
export function phaseColor(phase: string): string {
  const map: Record<string, Domain> = {
    explore: "data", plan: "plan", analyze: "analysis", review: "literature", submit: "governance",
  };
  return domainHex(map[phase] ?? "neutral");
}
```
- [ ] Test (`test/palette.test.ts`): `roleStyle(stub("truecolor"),"refutes")("x")` contains `38;2;240;101;58`; `roleStyle(stub("256color"),"refutes")("x")` contains `38;5;203`; `roleStyle(stub("256color"),"supports")("x")` contains `38;5;43`. (stub = `{ getColorMode: () => mode }`.)
- [ ] `bunx tsc --noEmit` + `node --test test/palette.test.ts`; biome --write.
- [ ] Commit: `feat(ui): palette role resolver + re-tuned domains + phaseColor`

### Task 3: `lib/ui/glyphs.ts` — marks + ascii tier
**Files:** Modify `lib/ui/glyphs.ts`; Test `test/glyphs.test.ts` (create).
- [ ] Add to the unicode `GLYPH`: `warn:"△"`, `inProgress:"◐"`, `supports:"⊕"`, `refutes:"▽"`, `unresolved:"◌"`, `meterLow:"◔"`, `meterHalf:"◑"`, `meterFull:"●"`, `replicate:"↻"`, `blocked:"⊘"`, `checkpoint:"◈"`, `kindQuery:"▤"`, `kindNotebook:"▦"`, `kindFigure:"▣"`, `kindPaper:"¶"`. Change `folder:"📁"`→`folder:"⌂"`. Update the doc comments (`bullet`=separator only; `ok`/`bad`=operational axis only).
- [ ] Add an ascii tier + resolver:

```ts
export type GlyphTier = "unicode" | "ascii";

const ASCII: Record<keyof typeof GLYPH, string> = {
  ok: "[ok]", bad: "[x]", warn: "[!]", pending: "[ ]", inProgress: "[.]",
  add: "+", bullet: "-", arrow: "->", here: ">", project: "#", up: "^",
  folder: "~", gaugeFull: "#", gaugeEmpty: "-",
  supports: "(+)", refutes: "(v)", unresolved: "(?)",
  meterLow: ".", meterHalf: "o", meterFull: "O",
  replicate: "@", blocked: "(/)", checkpoint: "<>",
  kindQuery: "[q]", kindNotebook: "[nb]", kindFigure: "[fig]", kindPaper: "[doc]",
};

/** Active glyph tier: ascii when NO_COLOR or a non-UTF locale is detected, else unicode. */
export function glyphTier(): GlyphTier {
  if (process.env.BERIL_GLYPHS === "ascii") return "ascii";
  if (process.env.NO_COLOR) return "ascii";
  const enc = `${process.env.LC_ALL ?? process.env.LC_CTYPE ?? process.env.LANG ?? ""}`.toLowerCase();
  return enc && !enc.includes("utf") ? "ascii" : "unicode";
}

/** Resolve a glyph by key for the active tier. */
export function glyph(name: keyof typeof GLYPH): string {
  return glyphTier() === "ascii" ? ASCII[name] : GLYPH[name];
}
```
- [ ] Test (`test/glyphs.test.ts`): every `GLYPH` key has an `ASCII` entry (`Object.keys(GLYPH).every(k => k in ASCII)`); `glyph("ok")` returns the unicode `✓` by default. (No need to assert env-switching beyond a `BERIL_GLYPHS=ascii` set/restore.)
- [ ] `bunx tsc --noEmit` + test; biome --write.
- [ ] Commit: `feat(ui): new glyph marks + unicode/ascii glyph tier`

---

## WAVE A2 — cards (after A1). Task 4 is sole owner of science-cards.ts.

### Task 4: `lib/ui/science-cards.ts` — recolor through roles + redTeamCard
**Files:** Modify `lib/ui/science-cards.ts`; update `test/science-cards.test.ts`.
- [ ] Import `roleStyle` from `../palette.ts` and the new glyphs.
- [ ] `statusGlyph(theme, status)` → 6 rows, glyph + colored word:
  - `open` → `GLYPH.pending ○` + `theme.fg("muted", "open")`
  - `supported` → `GLYPH.supports ⊕` + `roleStyle(theme,"supports")("supported")`
  - `refuted` → `GLYPH.refutes ▽` + `roleStyle(theme,"refutes")("refuted")`
  - `needs-replication` → `GLYPH.replicate ↻` + `theme.fg("warning", "needs-replication")`
  - `blocked` → `GLYPH.blocked ⊘` + `theme.fg("error", "blocked")`
  - `needs-evidence` → `GLYPH.unresolved ◌` + `theme.fg("muted", "needs-evidence")`
- [ ] Confidence: delete `TIER_COLOR`; `confidenceFooter(theme, tier, caveat?)` → meter glyph + word + optional caveat, all dim-ish:
  `high`→`GLYPH.meterFull ●` + `theme.fg("text","confidence: high")`; `medium`→`GLYPH.meterHalf ◑` + `theme.fg("muted","confidence: medium")`; `low`→`GLYPH.meterLow ◔` + `theme.fg("dim","confidence: low")`. Caveat in `dim`.
- [ ] `evidenceCard`: section headers gain leading glyphs + role colors: `roleStyle(theme,"supports")(\`${GLYPH.supports} Supports (${n})\`)`, `roleStyle(theme,"refutes")(\`${GLYPH.refutes} Refutes (${n})\`)`, `theme.fg("muted", \`${GLYPH.unresolved} Unresolved (${n})\`)`. In `evidenceLines`, prefix each pointer with its kind glyph (`kindQuery/kindNotebook/kindFigure/kindPaper`) and weight `query`/`notebook` with `theme.fg("text",…)`, `figure`/`paper` with `theme.fg("dim",…)`. Replace the confidence line (was `TIER_COLOR`) with `confidenceFooter`.
- [ ] `feasibilityCard`: verdict map → `answerable`=`GLYPH.ok ✓`/success, `partial`=`GLYPH.warn △`/warning, `not-answerable`=`GLYPH.blocked ⊘`/error. (per-check exists/missing keeps `GLYPH.ok`/`GLYPH.bad`.)
- [ ] `claimLedgerCard`: build each row's cells with glyph+word — Status via a small `statusTag(status)` (glyph + word), Confidence via meter glyph + word, Supports `${GLYPH.supports} N`, Refutes `${GLYPH.refutes} N`, Stale `${GLYPH.warn} stale` (blank if not stale). If `markdownTable` mangles ANSI in cells, switch this card to a hand-drawn `linesCard` with aligned columns.
- [ ] `partialLine` → `theme.fg("muted", \`${GLYPH.inProgress} ${message}\`)` (was `warning`).
- [ ] Add `redTeamCard(theme, opts: { project: string; surviving: string[]; path: string })` → `linesCard` framed `accentStyle: roleStyle(theme,"refutes")`, title `\`${GLYPH.refutes} Red-team · ${project}\``, body = surviving disconfirming-check lines + a dim "full pass: <path>". (Explicitly NOT errorCard.)
- [ ] Update `test/science-cards.test.ts`: the existing evidenceCard/confidenceFooter assertions for the new glyphs/words; add a redTeamCard render smoke test.
- [ ] `bunx tsc --noEmit` + `node --test test/science-cards.test.ts`; biome --write.
- [ ] Commit: `feat(ui): recolor trust cards through role table + redTeamCard`

### Task 5: `lib/ui/checkpoint.ts`
- [ ] Import `domainStyle` from `./palette.ts` and `GLYPH`. Change `checkpointCard` to pass `accentStyle: domainStyle(theme,"checkpoint")` (drop `accent:"borderAccent"`) and title `\`${GLYPH.checkpoint} Checkpoint · ${d.title}\``.
- [ ] `bunx tsc --noEmit` + `bun run test` (checkpoint test); biome --write.
- [ ] Commit: `feat(ui): checkpoint card gets violet identity + ◈ glyph`

---

## WAVE A3 — chrome (after A1; Task 9 after Task 4). Disjoint files → parallel.

### Task 6: `lib/ui/footer.ts` — dual context threshold + connection chip + gap rule
**Files:** Modify `lib/ui/footer.ts`; READ `lib/ui/context-meter.ts` first (the `contextColor` it calls).
- [ ] **Dual threshold:** confirm `contextColor(percent, tokens)` in `context-meter.ts` implements warn `≥50% OR ≥150k`, escalate `≥70% OR ≥270k`, error `≥90% OR ≥500k`. If it's percent-only, port the dual rule there (it already receives `tokens`). Add a unit test for the boundaries in `test/context-meter.test.ts` (create/extend).
- [ ] **Connection chip:** extract `export function connectionChip(theme, connection, ready, reachable?)` → `ready` `${GLYPH.ok}`/success, reachable-but-not-ready `${GLYPH.warn}`/warning (NOT `GLYPH.bad`), down `${GLYPH.bad}`/error. Use it in `footerLines` (line 1). (beril's `FooterData` has `ready`; treat `connection && !ready` as reachable→`warn`, absent connection as down — keep simple, the env extension sets `ready`.)
- [ ] **Gap-rule right-justify** on line 2: render `where`+`context` left, `model` right, and fill the middle with `theme.fg("dim", "─".repeat(gap))` where `gap = max(1, width - visibleWidth(left) - visibleWidth(model) - 2)` (use `visibleWidth` from `@earendil-works/pi-tui`). Fall back to the current `sep.join` when `width` is too small for a rule.
- [ ] `cwd` line uses `GLYPH.folder` (auto `⌂`). 
- [ ] Update `test/*footer*` assertions for the connection chip + any layout change.
- [ ] `bunx tsc --noEmit` + `bun run test`; biome --write.
- [ ] Commit: `feat(ui): footer dual context threshold, connection chip, gap-rule right-justify`

### Task 7: shared step-rail (`lib/ui/step-rail.ts`) + HUD + welcome
**Files:** Create `lib/ui/step-rail.ts`; modify `lib/ui/workflow-hud.ts`, `lib/ui/welcome.ts`; test `test/step-rail.test.ts`.
- [ ] Create `step-rail.ts` exporting `stepRail(theme, state)` (move the logic shared by `workflow-hud.stepRail` and `welcome.arcLine`): `done → theme.fg("dim", \`${GLYPH.ok} ${step}\`)`, `current → theme.bold(roleStyle(theme,"info")(\`${GLYPH.here} ${step}\`))`, `future → theme.fg("muted", \`${GLYPH.pending} ${step}\`)`. (Uses `RESEARCH_STEPS`/`stepIndex` from `../research-steps.ts` and `roleStyle` from `./palette.ts`; `HudTheme = Pick<Theme,"fg"|"bold">` — pass a theme that also satisfies `ColorModeTheme` for roleStyle, i.e. real `Theme`.)
- [ ] `workflow-hud.ts`: delete the local `stepRail`, import the shared one.
- [ ] `welcome.ts`: delete `arcLine`, use the shared `stepRail`.
- [ ] Test `step-rail.test.ts`: for `state="active"` the rendered rail marks `analyze` current (contains `GLYPH.here`), `explore`/`plan` done (contains `GLYPH.ok`), `submit` future (contains `GLYPH.pending`).
- [ ] `bunx tsc --noEmit` + `bun run test`; biome --write.
- [ ] Commit: `feat(ui): shared step-rail (done ✓ / current ▸ info / future ○) for HUD + welcome`

### Task 8: `extensions/beril-env.ts` — phase glyph tint + connection △
**Files:** Modify `extensions/beril-env.ts`. READ it first (the phase-banner renderer + the connection `setStatus`).
- [ ] Phase banner: tint the leading `${GLYPH.here} ${phase}` via `hexFg(theme, phaseColor(phase), …)` (import `phaseColor`/`hexFg` from `../lib/ui/palette.ts`); keep the `customMessageBg` box and the rest of the banner unchanged.
- [ ] Connection `setStatus`: when reachable-but-not-ready, use `GLYPH.warn △` + warning (match the footer chip), not `GLYPH.bad`.
- [ ] `bunx tsc --noEmit` + `bun run test` (beril-env tests); biome --write.
- [ ] Commit: `feat(env): per-phase banner glyph tint + △ not-ready connection`

### Task 9: `extensions/beril-refute.ts` — render redTeamCard (AFTER Task 4)
**Files:** Modify `extensions/beril-refute.ts`.
- [ ] After writing `REFUTATION_N.md`, if `ctx.hasUI` render `redTeamCard` (import from `../lib/ui/science-cards.ts`) via the appropriate UI surface the extension uses for cards (mirror how another `beril-*` extension surfaces a non-tool card; if there's no card surface in a command, keep the `sendUserMessage` + the `ctx.ui.notify` but prefix the notify with `${GLYPH.refutes}` and frame the message as a red-team pass, NOT an error). Keep the existing file write + sendUserMessage.
- [ ] `bunx tsc --noEmit` + `bun run test`; biome --write.
- [ ] Commit: `feat(refute): surface the red-team pass as a ▽ card, not a plain notify`

### Task 10: glyph-literal cleanups
**Files:** Modify `extensions/beril-governance.ts`, `lib/research-steps.ts`.
- [ ] `beril-governance.ts`: replace the raw `▣` literal in the project status chip with `GLYPH.project` (import from `../lib/ui/glyphs.ts` if not already).
- [ ] `research-steps.ts`: in `stepBreadcrumb`, import `GLYPH` from `./ui/glyphs.ts` and replace raw `▸`/`·`/`✓` with `GLYPH.here`/`GLYPH.bullet`/`GLYPH.ok`.
- [ ] `bunx tsc --noEmit` + `bun run test`; biome --write.
- [ ] Commit: `refactor(ui): use GLYPH constants for project/breadcrumb literals`

---

## Final verification
- [ ] `bunx tsc --noEmit` clean; `bun run test` all green; scoped biome clean on changed files.
- [ ] `pi install -l .` loads.
- [ ] Self-review: every spec §6 surface is recolored; no `themes/beril.json` key added; supports/refutes never share a glyph/hue with operational ok/fail.

## Notes
- A1 tasks 1/2/3 are file-disjoint → parallel. A2 task 4 owns science-cards.ts (task 5 disjoint). A3 tasks 6/7/8/10 disjoint; task 9 needs task 4's `redTeamCard` (run after A2).
- Layer B/C (vendor `output-block`/`status-line`/`render-utils`, migrate cards, markdown role-split, live evidence wiring) is a separate spec/plan.
