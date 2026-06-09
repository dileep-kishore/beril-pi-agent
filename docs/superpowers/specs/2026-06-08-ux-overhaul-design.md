<!--
Design spec for the beril-pi-agent UX/UI overhaul. Verified against Pi 0.78.1
(dist/*.d.ts + examples/extensions/*.ts). Companion to the existing
2026-06-06-co-scientist-ux-design.md. Approved decisions captured from a
brainstorming session (intro=boxed panel, statusline=rich segmented,
colors=per-domain accents, scope=starter+polish).
-->

# beril-pi-agent — UX/UI Overhaul Design (2026-06-08)

## Goal

Make the terminal co-scientist *look* and *read* as good as it reasons: a
branded intro, a real statusline, per-domain colour so cards differentiate, and
— the trigger for this work — **stop showing tool outputs as raw JSON**.

## Approved decisions

| Axis | Decision |
|---|---|
| Intro screen | **Boxed welcome panel** via `setHeader`, cleared on first input |
| Statusline | **Rich segmented** `setFooter`: connection · project · phase · ctx% · model, with context-usage colour thresholds |
| Colours | **Per-domain accents** on the dark-teal base (data/lit/plan/analysis/governance/destructive) |
| Scope | **Starter set + polish**: render fixes + intro + footer + colours + HUD dedup, *plus* a pinned phase/checkpoint banner, one keyboard shortcut, and OSC-8 clickable refs |

## Pi API constraints (verified 0.78.1)

- `setHeader((tui,theme)=>Component)` and `setFooter((tui,theme,footerData)=>Component)` are **TUI-only** (no-op in rpc/json/print). Gate `ctx.mode === "tui"`. `render(width)` returns `string[]`. Footer must return a single width-clamped line array.
- `footerData`: `getGitBranch()`, `getExtensionStatuses()`, `onBranchChange(cb)→unsub`. Tokens via `ctx.sessionManager.getBranch()` (assistant `usage`); model via `ctx.model?.id`; context via `ctx.getContextUsage()` → `{tokens, contextWindow, percent}`.
- Theme `colors` is `additionalProperties:false` — **cannot add new `ThemeColor` keys**. `Theme.fg` only accepts the fixed key set; there is no arbitrary-hex method. Per-domain hues are therefore beril-owned, applied by a local `palette.ts` that emits truecolor / 256-downgrade ANSI (gated on `theme.getColorMode()`), fed into the card via a new `accentStyle` override.
- `registerMessageRenderer(type, (msg,{expanded},theme)=>Component)` + `pi.sendMessage({customType,content,display,details})` for inline pinned banners (`Box` with `customMessageBg`).
- `registerShortcut(keyId, {description, handler})` — must pick a free `KeyId`.
- Live footer/HUD updates: hold the `tui` handle from the factory and call `tui.requestRender()` on state change.

## Architecture — new pure modules (lib/ui/, each unit-tested)

1. **`palette.ts`** — `DOMAIN_HEX` map + `hexFg(theme, hex, text)` (truecolor or nearest-256 by `getColorMode()`) + `domainStyle(theme, domain)→(s)=>string`. Pure; tests assert escape shape + 256 downgrade. Domains → hexes: `data`#36c5d0, `literature`#5f87ff, `plan`#b08cff, `analysis`#36c5b0, `governance`#7cba6f, `destructive`#e8b84b, `error`#cc6666, `neutral` (muted).
2. **`context-meter.ts`** — `contextColor(percent, tokens)` → `"success"|"warning"|"error"` via oh-my-pi dual %/abs thresholds (≥50% or ≥150k → warning; ≥90% or ≥500k → error). Pure.
3. **`footer.ts`** — `footerLine(theme, data, width)` → `string`. Segments joined by a dim `·`, model right-aligned, width-truncated (`visibleWidth`/`truncateToWidth`). Pure.
4. **`welcome.ts`** — `welcomePanel(theme, state, width)` → `string[]` (reuses `frameCard`); `TIPS` + `pickTip(index)`. Pure. Two-column-ish rows: connection, researcher, the arc (current step accented), start nudge, tip.
5. **`discover.ts`** — `discoverLines(theme, snapshot)` → `string[]`: inventory = tenants as headers + collections (`name` + dimmed `description`); scoped = database header + tables (`name` + `row_count?` + dimmed `description`). Schema: `tenants[].collections[].{id,name,description,tables[]}`. Pure; replaces `discoverCard`'s JSON fence.
6. **`links.ts`** — `hyperlink(text, url)` → OSC-8 sequence, gated on a terminal-support check (env `TERM`/`NO_COLOR`); pass-through when unsupported. Pure.
7. **`glyphs.ts`** — one status-glyph legend (`ok ✓`, `bad ✗`, `pending ○`, `add +`, `bullet ·`, `arrow →`, `here ▸`, `project ▣`) so cards/HUD/footer stop diverging.

## Architecture — edits

- **`card.ts`** — add optional `accentStyle?: (s:string)=>string` threaded through `CardOptions`/`CardComponentSpec`/`frameCard`/`linesCard`/`markdownCard`; when present it styles the border + title (replacing `theme.fg(accent,…)`). Backward compatible.
- **`science-cards.ts`** — each builder passes its domain `accentStyle`; new `exportCard` (labeled `path · format · mode · rows · bytes`) and `envCard` (location · ready · checks · next steps); `discoverCard` → `discoverLines`; glyph unification; PMIDs/table refs wrapped in `hyperlink`.
- **`workflow-hud.ts`** — drop the connection/project head line (now owned by the footer); HUD becomes the **phase rail + next-action hint** only.
- **`extensions/beril-env.ts`** — the wiring hub: fetch researcher identity (`beril user --json`) for the panel; `setHeader` (welcome panel) on `session_start` when `mode==="tui"` && reason ∈ {startup,new}, cleared on first `input` and on shutdown; `setFooter` (footerLine) in TUI with `onBranchChange→requestRender`; keep `setStatus` connection chip as the RPC fallback; emit a `beril-phase` banner on lifecycle change; register the shortcut.
- **`extensions/beril-data.ts`** — `berdl_discover`/`berdl_export` tool `content` becomes a short markdown summary (full object stays in `details`), so the model stops echoing JSON; renderResult uses the new cards.
- **`extensions/beril-checkpoint.ts`** / **governance** — register the pinned banner renderer; emit on checkpoint + phase change.
- **`lib/conduct.ts`** — add: "Outputs already render as cards — never paste raw JSON or re-print a tool's table; refer to the card."

## JSON → formatted: the four fixes

1. `berdl_discover` card: structured tenant/db/table list (no JSON fence).
2. `berdl_export` card: labeled manifest fields (no `JSON.stringify`).
3. `berdl_env_check`: add the missing renderResult card.
4. Tool `content` (what the model reads): markdown/prose summary, not raw JSON, for discover/export (+ conduct reinforcement) so the assistant stops echoing JSON.

## Testing

New `node:test` files mirroring `test/card.test.ts` (pass-through fake theme): `palette`, `context-meter`, `footer`, `welcome`, `discover`, `links`, `glyphs`. Extend `science-cards.test.ts` for `exportCard`/`envCard`/discover. Gate every TUI-only surface so headless (`mode!=="tui"`) is a no-op. `npm run check` (tsc + biome) + `npm test` must pass.

## Out of scope (follow-ups)

Light-theme variant + runtime toggle; full oh-my-pi segment registry/presets; nerd-font symbol presets; below-editor checklist HUD; animated gradient logo.
