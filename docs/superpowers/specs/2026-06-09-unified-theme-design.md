# Unified Theme — Design Spec (Layer A: color, glyphs, semantics, footer polish)

**Date:** 2026-06-09
**Branch:** `feat/scientific-method`
**Status:** Approved (option **C, phased**). This spec is **Layer A** — pure-visual, no behavioral/data-flow change. Layer B/C (vendor oh-my-pi rendering primitives) is a separate follow-up spec.

## 1. Problem

beril's color meaning is scattered across three places that quietly collide:
`theme.fg` generic tokens, `lib/ui/palette.ts` `DOMAIN_HEX` (whose hexes are *literally the
same* as status hexes — governance==success-green, destructive==warning-amber,
analysis==accent-teal), and ad-hoc per-card glyph/color maps. The new calibrated-trust
cards make it worse: `supports=green / refutes=red` (the deuteranopia trap, and refutes
reads like a crash), confidence high/med/low reusing the lifecycle green/yellow/gray, no
distinct identity for evidence/checkpoint/red-team, and `✗` overloaded for failure *and*
refuted/blocked/not-answerable. A study of oh-my-pi (the polished Pi distribution) confirms
the fix: one role table, one glyph table, redundant glyph+word+color channels, and
disciplined dimming.

## 2. Goal

One coherent **semantic-token** system spanning cards, the HUD, the statusline/footer, the
welcome panel, phase banners, and checkpoints — including the calibrated-trust surfaces —
that is **colorblind-safe** and degrades **truecolor → 256**.

**Principle (from oh-my-pi):** ONE resolver, TWO orthogonal axes, THREE redundant channels.
- `lib/ui/palette.ts` = single source of truth for **semantic roles**; `lib/ui/glyphs.ts` = single source for **marks**.
- Axis A = **domain accent on the card FRAME** ("what kind of artifact"); Axis B = **semantic state in the BODY** via glyph+word+color ("how it stands"). They must never fight.
- Every state carries **glyph → word → color** in that priority order, so meaning survives `NO_COLOR`, grayscale, and CVD. Color only accelerates scanning.

## 3. Non-Goals (Layer A)

- No `output-block`/`status-line`/`render-utils` vendoring, no `card.ts` refactor, no markdown
  role-split, no collapse affordance — that is **Layer B/C** (`2026-06-09-unified-theme-rendering-design.md`, to be written).
- No new data flow: the dead `evidenceCard`/`confidenceFooter` are **recolored** here but their
  *live wiring* (a tool that emits `EvidenceView`) is deferred to Layer B/C. `/berdl-refute` gets a
  render surface (`redTeamCard`) because it already produces output.

## 4. Decisions (the five, settled)

1. **Brand accent stays teal** (`accent` unchanged). Add an `info` role = sky-blue `#56b4e9` used for the HUD/welcome **current step ("you are here")** and links/`/berdl-start`.
2. **Per-phase color**: tint **only the phase-banner leading glyph**; the HUD rail stays monochrome (glyph+bold). The `▸`+phase word already disambiguates.
3. **Supports glyph = `⊕`** (distinct from operational `✓`); refutes = `▽`.
4. **256 is the color floor.** Drop the 16-color tier (simpler `palette.ts`); `getColorMode()` only distinguishes truecolor vs 256 anyway.
5. **Recolor the trust cards now; defer live evidence wiring** to Layer B/C (see Non-Goals).

## 5. Invariants (unchanged from the codebase)

- Pi's theme `colors` map is **closed** (`additionalProperties:false`) — non-standard hues stay in
  `palette.ts` as raw hex→ANSI (the validated workaround; oh-my-pi escapes the same constraint the
  same way). Do **not** add domain/role keys to `themes/beril.json`.
- Keep the hand-rolled `hexFg` (no `Bun.color` runtime dependency).
- `theme.fg` resets foreground only (`\x1b[39m`) — preserve; when wrapping a colored span in
  `dim`, dim the before/after parts separately so the inner reset doesn't punch a hole.
- Every `renderResult` guards the Pi error contract (`context.isError` → `errorCard`).
- Width math uses `visibleWidth`, never `.length`.

## 6. Design

### 6.1 `themes/beril.json`
- `vars`: brighten `red` `#cc6666 → #e06c6c` (clears WCAG AA ~4.8:1 on the dark card; the old red was 3.1:1). Flows to `error`/`toolDiffRemoved`.
- `vars`: add `info: "#56b4e9"`. (Used by the palette `info` role; optionally repoint `mdLink` to it — left as-is for brand.)
- `colors` shape unchanged (key count, `additionalProperties:false`-safe).

### 6.2 `lib/ui/palette.ts` — the single role resolver
- **Re-tune `DOMAIN_HEX`** off the status hexes: `analysis #36c5b0 → #3aa0c0`, `governance #7cba6f → #9cc79a`, `destructive #e8b84b → #d99a3c`. Keep data `#36c5d0`, literature `#5f87ff`, plan `#b08cff`. Add `checkpoint` = plan violet `#b08cff`.
- **Add `ROLE_HEX`** for non-theme semantic hues: `supports #2ec4b6`, `refutes #f0653a`, `unresolved #8a929c`, `confHigh #d8dee2`, `confMedium #8a929c`, `confLow #666c75`, `info #56b4e9`.
- **`roleStyle(theme, role) → (s)=>string`** — truecolor→256 via the existing `hexFg`. Carry a hand-picked ANSI-256 index per colorblind-critical role so `supports`(43)/`refutes`(203) never drift under quantization (a small `ROLE_256` override map consulted in 256 mode).
- **`phaseColor(phase) → hex`**: explore=data cyan, plan=plan violet, analyze=analysis `#3aa0c0`, review=info blue, submit=governance `#9cc79a`.
- Keep `domainStyle` (reads the re-tuned hexes).

### 6.3 `lib/ui/glyphs.ts` — marks + an ASCII tier
- **Add:** `warn △`, `inProgress ◐`, `supports ⊕`, `refutes ▽`, `unresolved ◌`, `meterLow ◔`, `meterHalf ◑`, `meterFull ●`, `replicate ↻`, `blocked ⊘`, `checkpoint ◈`, `kindQuery ▤`, `kindNotebook ▦`, `kindFigure ▣`, `kindPaper ¶`.
- **Change** `folder 📁 → ⌂` (the lone emoji is a width/alignment risk).
- **Re-doc** `bullet ·` = separator only; `ok ✓`/`bad ✗` = operational axis only.
- **Glyph tiers (oh-my-pi pattern, small):** export `GLYPHS = { unicode: {...}, ascii: {...} }` and a resolver `glyph(name)` selecting the tier from a setting/env probe (`NO_COLOR`/`TERM`/an opt-in). `GLYPH` stays as the unicode default so existing call sites keep working. ASCII fallbacks: `ok→[ok]`, `bad→[x]`, `warn→[!]`, `pending→[ ]`, `supports→(+)`, `refutes→(v)`, `unresolved→(?)`, meters→`.`/`o`/`O`, `here→>`, `bullet→-`, `arrow→->`, `checkpoint→<>`, `blocked→(/)`, `replicate→@`, `folder→~`.

### 6.4 `lib/ui/science-cards.ts` — recolor through the role table
- **`statusGlyph`** → 6-row map with new glyphs+roles: `open ○`/neutral, `supported ⊕`/supports, `refuted ▽`/refutes, `needs-replication ↻`/caution, `blocked ⊘`/fail, `needs-evidence ◌`/neutral. supports/refutes via `roleStyle`, not `theme.fg`.
- **Confidence** → drop `TIER_COLOR`; `confidenceFooter` becomes a **brightness ramp + meter glyph**: high `● confHigh`, medium `◑ confMedium`, low `◔ confLow`, always with the word.
- **`evidenceCard`** → section headers get leading glyphs: `⊕ Supports (n)` (roleStyle supports), `▽ Refutes (n)` (roleStyle refutes, **not** `theme.fg('error')`), `◌ Unresolved (n)` (neutral). Pointer kinds: `query/notebook` at `text` weight + their kind glyph; `figure/paper` at `dim` (mirrors `tierForEvidence`).
- **`feasibilityCard`** → `answerable ✓`/success, `partial △`/caution, `not-answerable ⊘`/fail (the per-check exists/missing keeps `✓`/`✗`).
- **`claimLedgerCard`** → render Status as `statusGlyph` glyph+word, Confidence as meter glyph + word, Supports `⊕ N`, Refutes `▽ N`, Stale `△ stale` (not bare `yes`). (If the markdown table strips cell ANSI, fall back to a hand-drawn `linesCard`.)
- **`partialLine`** → `muted` + `◐` (was `warning` yellow).
- **Add `redTeamCard(theme, surviving[])`** framed `roleStyle('refutes')` vermilion with a `▽ Red-team` title — explicitly **not** `errorCard`'s `✗`/red.

### 6.5 `lib/ui/checkpoint.ts`
Replace `accent:'borderAccent'` with `accentStyle: domainStyle(theme,'checkpoint')` (violet) and a `◈` title prefix — the steering seam gets its own identity.

### 6.6 `lib/ui/footer.ts` (the oh-my-pi statusline techniques that belong in Layer A)
- **Dual context threshold** (port oh-my-pi's `context-thresholds`): warn at `≥50% OR ≥150k`, escalate `≥70% OR ≥270k`, error `≥90% OR ≥500k` — the absolute floor warns correctly on large-context models. (beril already threshold-colors ctx%; widen to the dual rule.)
- **Connection chip**: `ready ✓`/success, `reachable-but-not-ready △`/caution (**stops sharing the failure `✗`**), `down ✗`/fail. Factor a `connectionChip(theme,state)` reused by `welcome.ts`.
- **Right-justify by a tinted gap rule**: fill the middle between the left group and the right-aligned model with `─`.repeat(gap) in `dim` (or `info`), not spaces — reads as an intentional divider. (Mechanism from oh-my-pi's gap-as-rule.)
- **Leading-ellipsis** project truncation (`…${name.slice(-n)}`) when narrow; keep the tail.
- `cwd`/folder uses `⌂`. Current-step/"here" uses `info`.

### 6.7 `lib/ui/workflow-hud.ts` + `lib/ui/welcome.ts`
Extract a shared **step-rail** helper: `done ✓ dim / current ▸ bold info / future ○ muted`, used by both the HUD rail and the welcome arc so they read identically. `welcome` reuses `connectionChip`.

### 6.8 `extensions/beril-env.ts`
- Phase banner: tint the **leading `▸`+phase glyph** via `phaseColor(phase)`; keep the `customMessageBg` box.
- Connection `setStatus`: not-ready uses `caution + △` to match the footer.

### 6.9 `extensions/beril-refute.ts`
Render `redTeamCard` (or at minimum a `▽`-marked info notify) instead of the plain notify, so the adversarial pass reads as rigorous science, not a tool failure. (`ctx.hasUI` guard already present.)

### 6.10 Glyph-literal cleanups
`extensions/beril-governance.ts`: raw `▣` → `GLYPH.project`. `lib/research-steps.ts` `stepBreadcrumb`: raw `▸`/`·`/`✓` → `GLYPH.here`/`bullet`/`ok` — one rail vocabulary that can't drift.

## 7. Colorblind strategy

Three enforced channels, priority **glyph → word → color**: every state prints a shape-distinct
glyph and a literal word; color is third, never load-bearing. The deuteranopia pair
(supports/refutes) moves off red/green to **Okabe-Ito teal `#2ec4b6` / vermilion `#f0653a`**
(1.54× luminance gap → separable in grayscale) with `⊕`/`▽`. The operational `ok`/`fail` axis
keeps green/red (it's `✓`/`✗`-redundant and conventional), but `refuted`/`blocked`/`not-answerable`
are pulled **off** the failure-`✗` onto `▽`/`⊘`. Confidence is **brightness-only** (no hue).
Verification: a render path with `roleStyle`/`theme.fg` stubbed to identity (ANSI stripped) must
keep every state unambiguous.

## 8. Testing

- `lib/ui` builders render without throwing on populated + empty inputs and with a stubbed
  identity theme (the existing `science-cards.test.ts` pattern), incl. the recolored cards + `redTeamCard`.
- `palette.ts`: `roleStyle` emits the expected ANSI in truecolor vs 256; the colorblind-critical
  256 overrides (supports 43 / refutes 203) are asserted.
- `glyphs.ts`: ascii tier covers every unicode key; the resolver picks the tier.
- footer dual-threshold logic: unit test the level boundaries.
- Update the snapshot/assertion fallout from the glyph/semantic changes (folder, partialLine,
  statusGlyph) — expect broad-but-surgical test edits.
- Gate: `tsc --noEmit` + `bun run test` + scoped biome (the repo-wide `biome check .` red is
  pre-existing data-file noise).

## 9. Risks

- Re-tuning domain hexes shifts every card frame's look — coordinate with UX sign-off.
- New glyphs depend on terminal font coverage; the ascii tier is the mitigation, but verify the
  unicode set renders on target terminals (all BMP, no nerd-font).
- Changing `GLYPH.folder` and `ok/bad` semantics touches several tests — surgical but broad.
- The gap-rule footer is a bottom line in beril (not the editor top border as in oh-my-pi), so it
  reads as a divider rather than a box continuation — still intentional, confirm it looks right live.

## 10. Sequencing (waves)

- **Wave A1 — foundations (parallel, disjoint):** `themes/beril.json`, `lib/ui/palette.ts` (roles + roleStyle + phaseColor + re-tuned domains), `lib/ui/glyphs.ts` (marks + ascii tier).
- **Wave A2 — cards (sole owner of science-cards.ts):** recolor statusGlyph/confidence/evidence/feasibility/claim-ledger/partialLine + `redTeamCard`; `checkpoint.ts`.
- **Wave A3 — chrome (parallel, disjoint):** `footer.ts` (dual threshold + connectionChip + gap rule), `workflow-hud.ts`+`welcome.ts` (shared step-rail), `beril-env.ts` (phase glyph + connection), `beril-refute.ts` (redTeamCard), `beril-governance.ts`+`research-steps.ts` (glyph literals).

Each wave committed after `tsc` + `bun run test` pass. Layer B/C follows in its own spec/PR.
