# Pi-native co-scientist: visual workflow + seamless research arc

**Date:** 2026-06-06 · **Branch:** `feat/pi-native-coscientist`
**Verified against:** Pi `0.78.1` (latest; pin is current) — pi-tui / pi-coding-agent
installed `.d.ts` + bundled `examples/`, this repo's current surface, and the
original BERIL repo (`main @ 940c3b0e`).

This plan is grounded in a 5-agent research sweep (TUI component API, verified
rendering examples, latest Pi docs, original-BERIL notebook/plan/cloud-skill
substrate, and the current package surface) plus a live BERDL connectivity test.
See `[[pi-native-audit]]`, `[[review-rearchitecture]]`, `[[workshop-ux-findings]]`.

---

## 1. Vision & principles

Make `beril-pi-agent` a **research co-scientist where the science is the
foreground**. Concretely:

1. **Spotlight the science, mute the plumbing.** Data, literature, research
   plans, notebook results, and findings render as rich, titled **cards**;
   routine `bash`/file edits/`code` recede (compact + muted, expand on demand).
2. **The workflow is always legible.** A persistent **workflow HUD** shows the
   connection, the active project, *where you are* in `explore → plan → analyze
   → review → submit`, and *what's next*.
3. **Approval is for science direction and destructive ops — not commands.** Pi
   already has no per-tool popups and `beril-safety` gates only irreversible
   ops. We add visually distinct **science checkpoints** at natural seams (after
   the plan; after the first result) and keep the destructive gate. We never
   prompt for routine bash.
4. **The research arc is seamless.** explore data (discover/peek/query) +
   literature/ideation → **generate a research plan** → **generate + execute
   analysis notebooks** → synthesize a report → review → submit. The two missing
   links — plan generation and notebook generation/execution — get built.

Design rule (unchanged): **skills = judgment**; **extensions = UI, commands,
tools, state, execution, rendering, safety**; **sub-agents = isolated reasoning**.

## 2. Verified baseline (what exists today)

- **8 extensions**: `beril-conduct` (system-prompt contract), `beril-data`
  (query/discover/peek/export), `beril-env` (env check + footer statuses),
  `beril-governance` (hash/lifecycle/user/submit + /synthesize //submit),
  `beril-hints` (tool_result advisories), `beril-literature` (lit_search/fetch +
  /literature-review), `beril-review` (in-process review subagent),
  `beril-safety` (destructive gate).
- **11 tools**, **7 commands**, **9 skills** (see research output for the full
  table). **Lifecycle**: `exploration → proposed → active → analysis → reviewed
  → complete` (+ demotes), in `beril_cli/lifecycle.py`.
- **Rendering today = plain text.** Zero `renderResult`/`renderCall`/
  `registerMessageRenderer`/`setHeader`/`setWidget`; `renderTable()` emits a
  monospace text block. The footer is 4 keyed `setStatus` strings; the
  breadcrumb (`research-steps.ts`) is one muted string.
- **No notebook generation or execution**; no plan-generation command. The
  lifecycle *reviews/hashes* notebooks but nothing *creates or runs* them.

## 3. Verified Pi capabilities & gotchas (the rendering toolkit)

From installed `.d.ts` + `examples/` (citations in the research artifact):

- **Per-tool rendering** on `registerTool`: `renderCall(args, theme, ctx) →
  Component` and `renderResult(result, {expanded, isPartial}, theme, ctx) →
  Component`. Best practice: **compact default, expand on demand**; return
  `new Text("", 0, 0)` to show nothing. Built-in tools (`read`/`bash`/`write`/
  `edit`/`grep`/`find`/`ls`) **can be re-registered** with a custom
  `renderResult` (proven: `examples/extensions/built-in-tool-renderer.ts`,
  `minimal-mode.ts`) — wrap `pi.getAllTools()`/original `execute`.
- **Custom message types**: `pi.registerMessageRenderer(customType, (message,
  {expanded}, theme) => Component)` + `pi.sendMessage({customType, content,
  display, details})`.
- **Chrome**: `ctx.ui.setWidget(key, string[] | (tui,theme)=>Component,
  {placement:"aboveEditor"|"belowEditor"})`, `setFooter((tui,theme,footerData)=>
  Component)` (footerData: `getGitBranch()`, `getExtensionStatuses()`,
  `onBranchChange()`), `setStatus(key, text?)`, `setWorkingMessage/Indicator/
  Visible`, and `setHeader((tui,theme)=>Component)` — **real but UNDOCUMENTED**;
  verify in installed `.d.ts` before relying on it.
- **Interactive decision UI**: `ctx.ui.custom<T>((tui,theme,kb,done)=>Component,
  {overlay:true, overlayOptions})`, and `ctx.ui.confirm/select/input` (with
  `{timeout, signal}`). **pi-tui has NO built-in borders/layout** — draw cards by
  hand with box-chars (`╭─╮│╰╯`) and `visibleWidth`-aware padding (pattern in
  `overlay-test.ts`).
- **pi-tui components**: `Text(text, px=1, py=1, bgFn?)`, `Box(px, py, bgFn?)`
  +`addChild`, **`Markdown(text, px, py, MarkdownTheme, defaultTextStyle?,
  opts?)`** (renders tables/headings/lists/code/quotes — our easiest path to
  formatted bodies), `Container`, `Spacer(n)`, `TruncatedText`, `Loader`,
  `SelectList`, `Image`. Helpers: `visibleWidth`, `truncateToWidth`,
  `wrapTextWithAnsi`; `truncateHead/truncateTail/formatSize` (pi-coding-agent).
- **Theme**: `theme.fg(token, s)`, `theme.bg(token, s)`, `theme.bold/italic`.
  Themes are JSON requiring **all 51 tokens** (spotlight: `accent`,
  `borderAccent`, `success`, `customMessageBg/Text/Label`; recede: `muted`,
  `dim`, `toolOutput`). **Doc fact:** *there is no built-in API to de-emphasize
  routine output* — you achieve it by returning compact Components + theme tokens.
- **`ctx.mode`** (`tui`/`rpc`/`json`/`print`) gates custom UI to TUI; `hasUI`
  gates dialogs. **No Jupyter/papermill in Pi** — notebook exec must shell to
  `jupyter nbconvert` via the `beril` CLI (the `.venv-berdl` has pyspark).
- **Sub-agents** via `createAgentSession` (already used by `beril-review`).

## 4. Workstreams

### WS0 — Connectivity fix ✅ (committed)
`fix(berdl): correct off-cluster detection and discover request UA` — gate
on/off-cluster on `berdl_notebook_utils` importability; curl UA for the
Cloudflare-fronted discover POST. Proven end-to-end (`SELECT 1` + discover).

### WS1 — Visual foundation: `lib/ui/` (pure + Components)
The reusable card vocabulary every other WS uses.
- `lib/ui/markdown-theme.ts` — `markdownTheme(theme): MarkdownTheme` mapping the
  10 `md*` tokens (+ bold/italic/code) onto `theme.fg(...)`.
- `lib/ui/card.ts` — pure `frameLines(theme, {title, accent, body: string[],
  width}) → string[]`: hand-drawn rounded border + title bar, `visibleWidth`-safe
  padding, body truncation with a “… N more” footer. Plus `cardComponent(theme,
  {title, accent, getBody}): Component` (a `render(width)` that frames either raw
  lines or a child `Markdown` rendered to inner width). Pure helpers are unit-
  tested (border math, truncation, ANSI-safe padding); the Component is smoke-
  tested via a fake theme.
- `lib/ui/table.ts` — `markdownTable(rows, {maxRows, maxColWidth}) → string`
  (GFM table the `Markdown` component renders; replaces ad-hoc `renderTable` for
  cards, keeping `render.ts` for plain contexts).
- Theme: extend `themes/beril.json` to a **complete 51-token** theme tuned for
  the spotlight/recede hierarchy (validate against Pi’s theme schema).

### WS2 — Science-forward tool rendering
Add `renderCall` (one-line dimmed summary so the *command* recedes) +
`renderResult` (a **card**, compact, expand-on-demand) to our tools:
- `berdl_query` → **Data card** (`🧫 N rows · limit L`, GFM table, truncation note).
- `berdl_peek` → **Table preview card** (schema: `col — type — comment` + samples).
- `berdl_discover` → **Collections card** (tenants → dbs → table counts).
- `lit_search`/`lit_fetch` → **Literature card** (formatted refs).
- `berdl_export`/`lakehouse_submit`/`notebook_hash`/`lifecycle_transition`/
  `beril_user` → compact status cards (destructive ones colored by `warning`).
Invariant: rendering reads `result.content`/`details`; it never changes the
returned payload (hash/`details` stay byte-identical — Invariant 2).

### WS3 — De-emphasize bash / code
- New `extensions/beril-quiet-tools.ts`: re-register built-in `bash`/`read`/
  `write`/`edit`/`grep`/`find`/`ls` wrapping the original `execute`, with a
  **muted, collapsed** `renderResult` (`✓ done (N lines)` in `dim`; full output
  only when `expanded`) — the proven `built-in-tool-renderer.ts` pattern. TUI-
  gated; in headless modes it’s a no-op (rendering only runs in TUI).
- Strengthen `CONDUCT_CONTRACT`: “run routine bash quietly; lead with the science
  artifact, not the command; don’t narrate plumbing.”
- The tuned theme (WS1) makes tool output recede globally.

### WS4 — Workflow HUD (where am I / what’s next)
- `lib/research-steps.ts`: add `nextAction(state): string` (e.g. `analysis →
  "review the report (/berdl-review) then /submit"`).
- `beril-env`: replace the 4 separate footer strings with a single **workflow
  widget** via `setWidget("beril-workflow", factory, {placement:"aboveEditor"})`
  rendering up to 3 lines: `BERDL ✓ ready · ▣ project` / `explore → plan →
  ▸analyze → review → submit` (done dim+✓, current accent, future muted) /
  `Next: …`. Keep `setStatus` connection as a compact fallback for non-widget
  contexts. Fed by the existing `beril:lifecycle`/`beril:submitted` bus events.
- Optional `setHeader` startup banner (project + “you are here”) — only if the
  installed `.d.ts` confirms the signature; otherwise skip (undocumented).

### WS5 — Notebook generation + execution (the seamless analysis link)
- **Python** `beril_cli/notebook_cmd.py` + `notebook` subcommand:
  - `scaffold <project> [--from-plan]` → read `RESEARCH_PLAN.md` analysis plan;
    emit numbered `notebooks/NN_*.ipynb` (via `nbformat`) with markdown headers +
    setup/`get_spark_session` + query/analysis/viz cell skeletons. JSON manifest.
  - `run <project> [notebook] [--timeout -1]` → execute via `jupyter nbconvert
    --to notebook --execute --inplace` in `.venv-berdl`; JSON `{executed, cells,
    errors}`; outputs saved in-place (the BERIL reproducibility requirement).
  - `list <project>` → notebooks + whether each carries saved outputs.
  - Deps: add `nbformat` + `jupyter`/`nbconvert` to the `.venv-berdl` bootstrap
    (pyspark already present). `notebook_cmd.py` is **new** (not a protected
    repro file); it does not touch `notebook_hash.py`.
- **TS** `extensions/beril-analysis.ts`: tools `notebook_scaffold`,
  `notebook_run` (streams progress via `onUpdate` + `setWorkingMessage`),
  `notebook_list` → render **notebook cards** (which exist, which executed,
  errors). Command `/analyze <project>`: list → run → surface the first
  result → checkpoint (“first result looks like X — continue / adjust / stop”).
  Execution is **not** flagged destructive (it writes only the project’s own
  notebooks); any cell that writes to the lakehouse still routes through the
  export/submit gate.
- **Skill** `skills/analysis-notebooks/SKILL.md` (judgment): notebook design —
  cell structure, Spark-vs-local, sequential numbering, figure conventions,
  reproducibility, pitfalls. Execution lives in the extension.

### WS6 — Research-plan generation (the explore→plan link)
- **Command** `/research-plan <project>` in a new `extensions/beril-plan.ts`:
  draft `RESEARCH_PLAN.md` from the question + discovered data + `references.md`
  using the verified template (Research Question, H0/H1, Literature Context,
  Query Strategy, Analysis Plan = numbered notebooks, Expected Outcomes, Revision
  History, Authors); render a **Research-plan card**; transition
  `exploration → proposed` via `lifecycle_transition`; then a **checkpoint**
  (approve→`active` / review-first (`/berdl-review --plan`) / iterate).
- **Skill** `skills/research-plan/SKILL.md` (judgment): what a strong plan
  contains, feasibility (“answerable with available data?”), scoping.
- Front-of-funnel: `/berdl-start` already data-forward; `suggest-research` covers
  ideation (journey 2). Plan generation closes the gap to journey 3.

### WS7 — Science checkpoints (approval on direction)
- Shared `lib/ui/checkpoint.ts` + a `request_checkpoint` affordance: render a
  decision **overlay** (`ctx.ui.custom`, hand-drawn) or fall back to
  `ctx.ui.select` headless-safe; return the chosen direction as a steer message
  the model acts on. Used by `/research-plan` (after the plan) and `/analyze`
  (after the first result). Few, high-signal, visually distinct. Destructive gate
  unchanged.

### WS8 — Skill→home mapping + docs
- `docs/superpowers/specs/2026-06-06-skill-home-mapping.md`: the decision table
  (judgment→skill, execution/UI→extension, isolated→subagent) for every current
  capability + the **unmigrated cloud skills**:
  - `berdl-ingest` / `berdl-ingest-remote` → **skill** (data in), **deferred**
    (needs ingest infra; `berdl-minio` covers small uploads now).
  - `remote-compute` (CTS batch) → **extension tool** (compute dispatcher),
    **deferred** (not the default analysis path).
  - `phenix` (structural biology) → **sub-agent**, **deferred** (niche).
  - `linkml-schema` → **extension tool / low-priority skill**, **deferred**
    (metadata curation, orthogonal to the 3 journeys).
- Update `README.md`, `PROJECT.md`, `phase-notes.md`; refresh memory.

## 5. Phased execution & verification gates

Subagent-driven TDD (the project’s established pattern): per phase implement →
spec-review → quality-review; controller owns verification + commits. **Gate at
every commit:** `bunx tsc --noEmit` clean · `bunx biome check .` clean · full
`node --test` green · `uv run --group test pytest -q` green · `pi install -l .`
loads. Order: **WS1 → WS2 → WS3 → WS4 → WS5 → WS6 → WS7 → WS8**, each verified
before the next.

## 6. Invariants & guardrails

- **Do NOT modify** the protected repro/safety files: `tools/notebook_hash.py`,
  `tools/lakehouse_upload.py`, `beril_cli/{lifecycle,hash_cmd,user_cmd,
  submit_cmd}.py`, `extensions/beril-safety.ts`, `lib/review-finalize.ts`. New
  notebook code is additive (`notebook_cmd.py`), never touches the canonical hash.
- **Standalone repo**: never depend on / modify the original BERIL repo.
- **Tool payloads stay byte-identical** under rendering (Invariant 2); rendering
  is display-only and `!isError`-gated where it post-processes (Invariant 5 —
  never bypass the safety gate).
- **Theme** must keep all 51 required tokens and validate against the schema.
- **Headless safety**: all custom UI is `ctx.mode === "tui"` / `hasUI` gated;
  `confirm` auto-denies headless; the conduct contract still applies headless.
- **Node strip-only tests**: no enums / parameter properties (erasable TS only).

## 7. Deferred / live-smoke (need a TUI + live model + BERDL)
- Visual fidelity of cards/HUD/checkpoints in a real terminal.
- A real notebook run against Spark (scaffold → execute → outputs → /synthesize).
- `setHeader` banner (only if `.d.ts` confirms) and full HUD reflow at narrow widths.
- The unmigrated cloud skills (WS8 documents the decision; implementation deferred).
