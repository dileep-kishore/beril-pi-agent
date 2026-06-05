# beril-pi-agent — Pi-Native Optimization Plan (Phases 1–4)

Make `beril-pi-agent` more Pi-native by removing a dual-runtime hop in the
literature slice, composing the built-in footer for always-visible state,
enriching tool results, and decoupling cross-extension state via events — all
as thin vertical slices that keep `tsc --noEmit` + `biome check` + `node --test`
green and never disturb the two reproducibility hashes or the central safety gate.

This plan covers ONLY the highest-value / lowest-risk top of the ranking. The
high-risk and prerequisite-blocked items (byte-identical hash port, TS Spark/MinIO,
the confirm-with-facts overlay, the `beril verify` hash-diff card, Vertex
`registerProvider`) are explicitly **out of scope** at the end, with rationale.

---

## Ground rules (verified against the installed package & repo)

**Toolchain (from `docs/superpowers/plans/phase-notes.md` + `package.json`):**
- Node runs `.ts` in **strip-only** mode → NO parameter properties, NO `enum`,
  NO `namespace`. Use `import type` for type-only symbols and `.ts` import
  extensions. For string-enum tool params use `StringEnum` from
  `@earendil-works/pi-ai` (already used in `extensions/beril-data.ts:1`).
- Typecheck: `bunx tsc --noEmit`. Lint/format: `biome check .`.
- Tests: `node --test 'test/**/*.test.ts'` (the quoted glob form — the bare
  directory form fails). Tests use `node:test` + `node:assert/strict` and a
  hand-rolled `harness(pi)` object (see `test/beril-literature.test.ts:8-19`).
- Tool params are built with `Type` from `typebox`.

**Verified Pi primitives + modeling examples (paths under
`/Users/g8k/npm-global/lib/node_modules/@earendil-works/pi-coding-agent`):**
- In-process completion: `import { complete, getModel } from "@earendil-works/pi-ai"`;
  model fallback at `examples/extensions/summarize.ts:1` (imports) and
  `:163-178` (getModel → `ctx.modelRegistry.getApiKeyAndHeaders` → bail if no
  auth), `:188-201` (`complete(model,{messages},{apiKey,headers})` then
  text-join). `complete` signature: `pi-ai/dist/stream.d.ts:5`.
- `setStatus(key, text|undefined)` on `ExtensionUIContext`:
  `dist/core/extensions/types.d.ts:78-79`; multi-key composition modeled by
  `examples/extensions/status-line.ts:11-25`. Built-in footer renders **all**
  keys (sorted by key, space-joined, width-truncated):
  `dist/modes/interactive/components/footer.js:197-206`.
- `tool_result` hook: `on("tool_result", …)` at
  `dist/core/extensions/types.d.ts:817`; `CustomToolResultEvent` has
  `content: (TextContent|ImageContent)[]`, `details: unknown`, `isError`
  (`types.d.ts:671-675`); `ToolResultEventResult { content?; details?; isError? }`
  (`:733-737`) — omitted fields keep the original (no deep merge).
- `pi.events` shared `EventBus`: `dist/core/extensions/types.d.ts:943`; one
  shared instance per session (`dist/core/extensions/loader.js:330,333`);
  `emit`/`on` modeled by `examples/extensions/event-bus.ts:21-34`.
  `requestRender` push: `examples/extensions/custom-footer.ts:25`.
- `renderResult` (Phase 2 stretch, gated): `types.d.ts:363`; details-reading
  pattern at `examples/extensions/structured-output.ts:46-60`; Markdown card via
  `new Markdown(text,1,1,getMarkdownTheme())` (`summarize.ts:1`, imports
  `Markdown` from `@earendil-works/pi-tui` and `getMarkdownTheme` from
  `@earendil-works/pi-coding-agent`).

**Invariants that must not break (referenced per phase):**
1. Self-containment — no dependency on / change to the original BERIL repo.
2. Reproducibility — the two sha256 primitives stay byte-identical
   (`notebook_hash.py` canonical-JSON sha256; raw `sha256sum` over the review
   `report.md`). ORCID/approval/marker invariants preserved. **No TS rehashing.**
3. TS strip-only — no parameter properties/enum/namespace; `import type`; `.ts`
   import extensions.
4. No MCP.
5. Central safety gate (`extensions/beril-safety.ts` `tool_call` hook →
   confirm/block; headless = auto-deny) stays authoritative and untouched.

---

## Phase 1 — Literature slice: drop the Python hop + the `pi` subprocess hop

**Why first:** highest-value / lowest-risk Python→TS removal. Two changes that
remove an entire runtime hop each. Both confined to one extension + one lib file;
no hashing, no safety gate, no footer chrome. Ranked #1 (`litclient-to-ts`) and
#3 (`inproc-complete-query-expansion`).

### Phase 1a — Port the PubMed E-utilities client to `lib/lit.ts`

**Goal.** Replace `pi.exec("beril", ["lit", "search"|"fetch", …])` (a Python
subprocess hop into `beril_cli/lit_cmd.py` → `lit_client.py`, requiring the
`httpx` dependency) with an in-process TS HTTP client using Node's global
`fetch`. The `lit_search`/`lit_fetch` tool contract (returned record shape) is
unchanged; only the source of the records moves from a subprocess to in-process.

**Pi primitive + model.** Plain `fetch` (Node global, no new dependency); mirror
the pure normalizer/param-builder split that `beril_cli/lit_client.py:21-63`
already proves is testable (`normalize_pubmed_summary`, `build_esearch_params`,
`build_esummary_params`, `search_pubmed`/`fetch_article`). Keep the exact NCBI
E-utilities endpoints: `esearch.fcgi` → idlist → `esummary.fcgi`
(`lit_client.py:48-76`).

**Files.**
- Create `lib/lit.ts` — exports `interface LitRecord`, pure
  `normalizePubmedSummary(raw)`, pure `buildEsearchParams`/`buildEsummaryParams`,
  and thin async `searchPubmed(query, max)` / `fetchArticle(pmid)`. Port the
  field mapping verbatim from `lit_client.py:21-32` (pmid/title/journal/year/
  authors; `year = pubdate.split()[0]`). Base URL `https://eutils.ncbi.nlm.nih.gov/entrez/eutils`.
- Modify `extensions/beril-literature.ts` — replace the `LitRecord` interface
  (lines 8-14) with `import type { LitRecord } from "../lib/lit.ts"`; in
  `lit_search.execute` and `lit_fetch.execute` call `searchPubmed`/`fetchArticle`
  instead of `berilExec(pi, ["lit", …])`; `/literature-review` fan-out
  (line 101) calls `searchPubmed(q, 20).catch(() => [])`.
- Modify `pyproject.toml` — remove the now-unused `httpx` dependency **only if**
  no other Python path imports it (verify first: `lit_cmd.py:12` and
  `lit_client.py:11` are the importers; `beril lit` becomes dead). Mark
  `beril_cli/lit_cmd.py` + `lit_client.py` as deletion candidates but **do not
  delete** unless the corresponding Python tests are removed in the same change
  (mirror the verdict guard on `lib/jsonl.ts`).

**TDD.**
- Write `test/lit.test.ts` first. Assert: (1) `normalizePubmedSummary` maps a raw
  esummary record (with `uid`, `title`, `fulljournalname`, `pubdate "2023 Jan"`,
  `authors:[{name}]`) to `{pmid,title,journal,year:"2023",authors:[…]}`;
  (2) `buildEsearchParams("x", 5)` → `{db:"pubmed",term:"x",retmax:5,retmode:"json"}`;
  (3) `searchPubmed` with `globalThis.fetch` stubbed to return the esearch
  idlist then the esummary `result` map yields normalized records in idlist
  order (skipping ids missing from `result`); (4) empty idlist → `[]`. Stub
  `fetch` by saving/restoring `globalThis.fetch` in the test (no network).
- Run `node --test 'test/**/*.test.ts'` → red, then implement `lib/lit.ts` → green.
- Update `test/beril-literature.test.ts`: `lit_search`/`lit_fetch` no longer
  route through `pi.exec("beril", …)`. Inject a fake `fetch` (or have the tools
  accept an injectable client — simplest: stub `globalThis.fetch` in those
  tests). Keep the existing assertions on `details.records[0].pmid`.

**Verify / acceptance.** `bunx tsc --noEmit` clean; `biome check .` clean;
`node --test 'test/**/*.test.ts'` green (lit + literature tests). Manual:
`/literature-review microbial AMR` writes `references.md` with PMIDs and no
longer spawns a Python `beril lit` subprocess.

**Invariants preserved.** Inv 2: untouched — literature touches no sha256/
beril.yaml/review-footer/ORCID path. Inv 1: `fetch` is a Node global, no new
dependency, no original-BERIL coupling. Inv 3: pure functions + `import type`,
no enum/namespace. Inv 4/5: N/A — no MCP, no tool_call gate interaction.
Before/after hop count for `lit_search`/`lit_fetch`: **2→1** (Python subprocess
removed; one in-process HTTP call remains).

### Phase 1b — Replace the `pi --mode json` subprocess in `expandQueries` with in-process `complete()`

**Goal.** `expandQueries` (`extensions/beril-literature.ts:17-28`) currently
spawns a child `pi --mode json --no-session` process and parses its JSONL event
stream to expand a topic into focused queries. Replace that subprocess + the
fragile event-shape parsing with an in-process `complete()` call.

**Pi primitive + model.** `complete` + `getModel` from `@earendil-works/pi-ai`,
**with the mandatory model fallback** from `summarize.ts:163-178`: prefer
`ctx.model`; when undefined (the verdict CONFIRMED `/literature-review` is
reachable headless — RPC mode and the repo's own json-mode tests have no model),
fall back to `getModel("anthropic", <default id>)` + `ctx.modelRegistry.getApiKeyAndHeaders(model)`;
if still no model/auth, return `[topic]` (preserve today's behavior). Join
`response.content` text blocks (`summarize.ts:198-201`), `JSON.parse` the array,
keep the existing `try/catch → [topic]` fallback.

**Files.**
- Modify `extensions/beril-literature.ts` — add
  `import { complete, getModel } from "@earendil-works/pi-ai"`; change
  `expandQueries(pi, topic)` → `expandQueries(ctx, topic)` (thread the command
  `ctx` so `ctx.model`/`ctx.modelRegistry` are reachable); update the one call
  site (`:99`). Pass `{ signal: ctx.signal }` to `complete` (optional, may be
  undefined when idle — acceptable). Remove the `pi.exec("pi", …)` call and the
  JSONL parse.
- Modify `lib/jsonl.ts` — **keep it.** The verdict confirms `test/jsonl.test.ts`
  imports it directly and `test/beril-literature.test.ts:89` exercises the pi
  branch. If `expandQueries` is the only production consumer, remove the import
  from `beril-literature.ts` but leave `lib/jsonl.ts` + `test/jsonl.test.ts`
  intact (no orphan tests).

**TDD.**
- Rewrite the two expansion tests in `test/beril-literature.test.ts`
  (`/literature-review fans out…` and `…falls back to the bare topic…`). Inject
  a fake `ctx.model` + `ctx.modelRegistry.getApiKeyAndHeaders` returning
  `{ok:true, apiKey:"k"}` and a mockable `complete`. Easiest strip-only-safe
  approach: have `expandQueries` accept an injectable completer, or stub the
  `@earendil-works/pi-ai` `complete` via a thin wrapper module the test can
  replace. Assert: (1) when `complete` returns a text block `'["q1","q2"]'`, the
  fan-out runs one `searchPubmed` per query and dedupes (reuse the shared-pmid
  fixture); (2) when `ctx.model` is undefined and no fallback auth, only
  `[topic]` is searched (assert `queries === ["bare topic"]`); (3) when
  `complete` throws or returns non-JSON, fall back to `[topic]`.
- Red → implement → green.

**Verify / acceptance.** `tsc --noEmit` + `biome check` clean; all literature
tests green. Manual: `/literature-review <topic>` in the TUI expands queries with
no second `pi` process in `ps`.

**Invariants preserved.** Inv 2: `expandQueries` makes no tool calls and touches
no hash. Inv 5: no tool_call → safety gate irrelevant; headless still returns the
bare topic (no destructive path). Inv 3: `complete`/`getModel` are value imports
(pi-ai value imports already exist in `beril-data.ts:1`); `import type` for
message types; no enum/namespace. Inv 1/4: in-package call, no MCP. Before/after
hop count for expansion: **child `pi` process + extension reload + JSONL parse →
one in-process HTTP call**.

---

## Phase 2 — UI chrome: compose the built-in footer with multiple status keys

**Why second:** lowest-risk UI/UX win, additive, no Python, no hashing, no safety
gate. Verdict CONFIRMED `getExtensionStatuses()` returns one shared non-namespaced
map and the built-in footer renders **all** keys — so a `setFooter` takeover is
unnecessary. Ranked #2 (`prefer-status-over-full-footer`); also seeds the
session-scoped active-project state (#20, `active-project-resolution`, Option (b)
only).

**Goal.** Surface BERDL connection (already there as `beril-connection`) **plus**
a lifecycle/project segment in the always-visible built-in footer, without a
`setFooter` takeover (which would lose the built-in token/cost/model/git chrome).

**Pi primitive + model.** `ctx.ui.setStatus(key, text)` →
`dist/core/extensions/types.d.ts:78-79`; aggregation by the built-in footer at
`footer.js:197-206` (sorted by key, space-joined, width-truncated). Model on
`examples/extensions/status-line.ts:11-25` and the repo's own
`extensions/beril-env.ts:6,19,67` (set on `session_start`, clear on
`session_shutdown`).

**Files.**
- Modify `extensions/beril-governance.ts` — add a module-scoped
  `let activeProject: string | undefined`. In the project-taking tool/command
  handlers (`lifecycle_transition.execute`, `lakehouse_submit.execute`,
  `/synthesize`, `/berdl-review`, `/submit`) set `activeProject = project` and,
  guarded by `ctx.hasUI`, call
  `ctx.ui.setStatus("beril-2-project", "▣ " + project)`. Note: tool `execute`
  signatures receive `ctx` as the 5th arg (currently `_ctx`); rename to `ctx`
  where needed. Add a `session_shutdown` handler clearing the key
  (`ctx.ui.setStatus("beril-2-project", undefined)`).
- (Optional, low effort) Add a `beril-1-connection`-style ordering note: keep
  `beril-env.ts`'s existing key as-is, OR rename to a sortable prefix if a
  deliberate left-to-right order matters (verdict guard (b): footer sorts by key
  name, truncates the alphabetically-last first). **Recommendation:** leave
  `beril-connection` unchanged this phase; only add the project key with a
  self-identifying glyph prefix so the two segments read distinctly when
  concatenated (verdict guard (a)).

**TDD.**
- Extend `test/beril-governance.test.ts` (or add `test/beril-governance-status.test.ts`).
  Build a fake `ctx` with `hasUI:true` and a `ui.setStatus` spy capturing
  `(key,text)`. Assert: (1) calling `lifecycle_transition.execute` with
  `project:"demo"` records `setStatus("beril-2-project", …)` containing `"demo"`;
  (2) with `hasUI:false`, `setStatus` is **not** called (headless no-op);
  (3) the `session_shutdown` handler clears the key with `undefined`.
- Red → implement → green.

**Verify / acceptance.** `tsc --noEmit` + `biome check` + full `node --test`
green. Manual (TUI): after any governance action, the footer shows the BERDL
connection segment **and** a `▣ <project>` segment on one line; both clear on
session shutdown; headless `--mode json` shows neither (no-op).

**Invariants preserved.** Inv 5: footer/status is orthogonal to the `tool_call`
safety gate — untouched. Inv 2: footer text is cosmetic; never feeds any sha256
or beril.yaml. Inv 1: pure in-package UI. Inv 3: `setStatus` needs no
enum/namespace; `let activeProject: string | undefined` is strip-safe. Inv 4: no
MCP. Hop count: **0 added** (reuses the project arg already in scope). This phase
deliberately does **not** add the cwd-walk Python subcommand (verdict REFUTED it
— `start.py:161-163` chdirs to the PROJECT.md root, never a `projects/<id>` child).

---

## Phase 3 — Workflow-control hook: next-step hints on tool results

**Why third:** additive `tool_result` hook, low risk, tightens the analysis loop.
Verdict CONFIRMED `event.details` is the object `execute()` returned and a
content-only patch leaves the structured payload byte-identical. Ranked #4
(`tool-result-next-step-hints`).

**Goal.** After a successful `berdl_query`/`berdl_discover`, append a short,
advisory next-step hint to the model-visible content (e.g. "Result may be
truncated — raise `limit` or filter further" when `returned_rows === limit_applied`;
or "Use `berdl_query` to sample a table you just discovered"). The structured
`details` payload is never modified.

**Pi primitive + model.** `pi.on("tool_result", …)` returning
`{ content: [...event.content, { type:"text", text: hint }] }`
(`types.d.ts:817`, `:733-737`). Model: the additive-content pattern; the merge
keeps omitted fields (`details`) byte-identical (`types.d.ts` middleware merge
semantics). Gate on `event.toolName === "berdl_query" && !event.isError` (the
verdict notes custom `toolName` is `string` so it does not type-narrow — read
`event.details` defensively via a cast to a narrow shape).

**Files.**
- Create `lib/hints.ts` — pure `queryHint(returnedRows, limitApplied): string | undefined`
  and `discoverHint(snapshot): string | undefined`. Pure so they are unit-testable
  without Pi. `queryHint` returns the truncation advisory only when
  `limitApplied != null && returnedRows === limitApplied`.
- Create `extensions/beril-hints.ts` (new extension; keeps the data extension
  thin) — registers the `tool_result` handler; reads `event.details` cast to
  `{ returned_rows?: number; limit_applied?: number | null }`, calls
  `queryHint`, and returns the appended-content patch. Register the new extension
  dir entry only if needed — Pi auto-loads everything under `./extensions`
  (`package.json` `pi.extensions: ["./extensions"]`), so the new file is picked
  up automatically.

**TDD.**
- Write `test/hints.test.ts` first. Assert `queryHint(100,100)` returns a
  non-empty advisory; `queryHint(7,100)` → `undefined`; `queryHint(7,null)` →
  `undefined`.
- Write `test/beril-hints.test.ts`. Build a fake `pi` capturing the registered
  `tool_result` handler; invoke it with a synthetic
  `CustomToolResultEvent`-shaped object `{toolName:"berdl_query", isError:false,
  content:[{type:"text",text:"orig"}], details:{returned_rows:100,
  limit_applied:100}}` and a fake `ctx`. Assert: (1) the returned `content` is
  `[...original, hint]` (original block preserved first, hint appended last);
  (2) the result has **no** `details` field (so the payload stays byte-identical);
  (3) `isError:true` events return `undefined`/no patch; (4) `toolName:"read"`
  events return `undefined`.
- Red → implement → green.

**Verify / acceptance.** `tsc --noEmit` + `biome check` + full `node --test`
green. Manual (TUI): a query hitting the limit shows the advisory line under the
result; a small result does not; `berdl_discover` followed by the model picking a
table is nudged by the discover hint.

**Invariants preserved.** Inv 2: `beril-data.ts`/this hook contain **zero**
sha256 logic; `details` is never in the patch → `QueryPayload` byte-identical.
Inv 5: the gate is on `tool_call`, a different event; the hint runs only after a
**successful** result, so it never bypasses a block. Inv 1/3/4: additive TS,
`import type`, no MCP. Hop count: **0 added** (pure post-processing).

---

## Phase 4 — State/event plumbing: cache BERDL readiness + push lifecycle on `pi.events`

**Why last (of the in-scope set):** highest workflow-control value but it touches
cross-extension state, so it lands after the cheaper slices prove the pattern.
Two tightly-related, verified changes. Ranked #8 (`env-readiness-event-cache`,
medium risk) and #10 (`lifecycle-status-via-events`, low risk). Both verdicts
CONFIRMED the shared bus + persistence mechanics; both carry mandatory guards.

### Phase 4a — TTL-cached BERDL readiness, consulted by `requireReady`

**Goal.** Stop re-exec'ing `beril env --json` on every tool call. Cache the
readiness verdict (with a short TTL) and have `requireReady` consult the cache as
a **fast path**, falling back to a live exec when no fresh snapshot exists. The
underlying `beril query`/`submit` still fails loudly, so a stale `ready=true`
cannot mask a dropped tunnel.

**Pi primitive + model.** Module-level cache (a `let lastEnv` + timestamp) is
plain TS. The persistence/replay option (`appendEntry` + `getBranch`) is
verified UI-independent (`tools.ts:28,43-53`) but is **not required** for the TTL
fast-path; keep this phase to the in-memory TTL cache + a `pi.events` broadcast
(below) to minimize risk and session-file churn. (Verdict warns against appending
a custom entry on every readiness check.)

**Files.**
- Modify `lib/readiness.ts` — add a module-level
  `let cached: { env: BerdlEnv; at: number } | undefined` and a TTL (e.g. 30s).
  `requireReady` first checks the cache: if fresh and `ready`, return it; else
  exec `beril env --json`, update the cache, and (on change) emit on the bus
  (see 4b). Keep the existing throw-with-next-steps behavior when not ready.
  Export a `readCachedEnv()` getter for `beril-env.ts`/`before_agent_start`
  consumers, and a `setCachedEnv(env)` so `beril-env.ts:refreshStatus` populates
  the cache after its own exec.
- Modify `extensions/beril-env.ts` — in `refreshStatus`, after the successful
  `berilExec(pi, ["env","--json"])`, call `setCachedEnv(env)` so the TUI
  connect/status commands seed the cache (verdict: today `refreshStatus`
  early-returns when `!ctx.hasUI`, so keep the cache write outside that guard if
  the value is available).

**TDD.**
- Extend `test/readiness.test.ts`. Assert: (1) first `requireReady` call execs
  `beril env` (spy on `pi.exec`); a second call within TTL does **not** exec
  again (cache hit) and returns the same env; (2) after TTL expiry the next call
  execs again; (3) a not-ready env still throws with the next-steps message and
  is **not** cached as a usable fast-path (or is cached but always re-verified —
  pick the conservative behavior and assert it); (4) `setCachedEnv` then
  `requireReady` within TTL returns the seeded value without exec.
- Red → implement → green.

**Verify / acceptance.** `tsc --noEmit` + `biome check` + full `node --test`
green. Manual (TUI): rapid successive `berdl_query` calls do not visibly
re-shell `beril env`; dropping the SSH tunnel between calls still surfaces a loud
failure from the real `beril query`.

**Invariants preserved.** Inv 5: readiness is **not** the destructive gate
(`beril-safety.ts` is separate) — never route a destructive confirmation through
this cache. Inv 2: caches only the env readiness JSON; nowhere near
`notebook_hash.py`, the review footer, beril.yaml, or ORCID/markers. Inv 1/3/4:
in-package, strip-safe (`let cached` + interface), no MCP. **Stale-cache guard
(mandatory):** keep `requireReady`'s live exec as the fallback when no fresh
snapshot exists, and rely on the underlying Python subcommand to fail loudly.

### Phase 4b — `beril-governance` emits lifecycle on `pi.events`; footer listens and re-renders

**Goal.** Replace any need to re-exec `beril lifecycle status` for the footer:
after a **successful** lifecycle transition, broadcast the canonical post-state
on the shared bus; `beril-env` (footer owner) listens and updates a
`beril-3-lifecycle` status key + requests a re-render.

**Pi primitive + model.** `pi.events.emit`/`pi.events.on`
(`types.d.ts:943`; one shared instance per session,
`loader.js:330,333`; modeled by `examples/extensions/event-bus.ts:21-34`).
Push re-render via the footer/status path
(`examples/extensions/custom-footer.ts:25` `requestRender`); for the built-in
footer, `ctx.ui.setStatus(...)` already triggers a re-render, so the listener
just calls `setStatus("beril-3-lifecycle", …)` (no `setFooter`).

**Files.**
- Modify `extensions/beril-governance.ts` — after the **awaited** `berilExec`
  succeeds in `lifecycle_transition.execute` (`:46`) and `/berdl-review` (`:118`),
  `pi.events.emit("beril:lifecycle", { project, state: result.status })` —
  emit the value the Python state machine **returned** (`result.status`), never
  the requested target (verdict guard). For `/submit`'s success path (`:160`,
  which writes a **marker**, not a `set`), emit a **distinct**
  `"beril:submitted"` signal — do NOT claim a lifecycle state that never
  transitioned (verdict guard).
- Modify `extensions/beril-env.ts` — register `pi.events.on("beril:lifecycle", …)`
  at module load; capture the ability to update status (guard every `setStatus`/
  re-render with `ctx.hasUI`; no-op headless). On `session_start`, do **one**
  seed read of lifecycle state for the active project (if any) so the widget is
  populated after a restart (the bus has no replay/history). Subscribe to the
  readiness event from 4a here too so connection state stays live without polling.

**TDD.**
- Extend `test/beril-governance.test.ts`: fake `pi.events` with an `emit` spy.
  Assert: (1) a successful `lifecycle_transition` emits `"beril:lifecycle"` with
  the **returned** `result.status` (set the mocked `berilExec` to return
  `{status:"analysis"}` and assert the emitted payload is `"analysis"`, even if
  the requested target differed); (2) a failed/throwing transition emits
  **nothing**; (3) `/submit` success emits `"beril:submitted"`, not
  `"beril:lifecycle"`.
- Extend `test/beril-env.test.ts`: register the extension with a fake shared bus,
  `emit("beril:lifecycle", {project,state})`, and assert the listener calls
  `setStatus("beril-3-lifecycle", …)` containing the state under `hasUI:true`,
  and is a no-op under `hasUI:false`.
- Red → implement → green. (Note `emit` is fire-and-forget/synchronous fan-out;
  register `on` at module load so the listener exists before any emit.)

**Verify / acceptance.** `tsc --noEmit` + `biome check` + full `node --test`
green. Manual (TUI): a `lifecycle_transition` immediately updates the footer
lifecycle segment with no extra `beril` subprocess; `/submit` shows a distinct
submitted indicator; on restart the segment seeds once from a single read.

**Invariants preserved.** Inv 2: authoritative state stays in `beril.yaml`
written by `lifecycle.py` (`sort_keys=False` + `_KEY_ORDER`); the event payload
is **display-only** — no transition/approval/marker logic moves to TS. Inv 5:
governance still routes `lakehouse_submit` through the destructive registry +
`beril-safety` hook; emitting after a successful transition bypasses no
confirm/block. Inv 1/3/4: in-package bus, strip-safe (payload is an **interface**,
never an enum), no MCP. **Mandatory guards:** emit only after the awaited exec
resolves; emit the returned state, not the requested target; `/submit` uses a
distinct submitted signal; listener guards on `ctx.hasUI`; one seed read on
`session_start`. Hop count: **N re-execs per refresh → 1 in-process emit per
transition + 1 seed read on session_start**.

---

## Cross-phase acceptance gate

After each phase (tracer-bullet discipline — every phase is independently
shippable):
1. `bunx tsc --noEmit` — clean.
2. `biome check .` — clean (auto-format with `biome check --write` if needed).
3. `node --test 'test/**/*.test.ts'` — all green (existing 40 + new).
4. `pi install -l .` + `pi list` — package + all extensions still load.
5. Spot-check: the two reproducibility primitives untouched
   (`git diff --stat` shows **no** changes under `beril_cli/hash_cmd.py`,
   `tools/notebook_hash.py`, `tools/review.sh`, `beril_cli/lifecycle.py`,
   `beril_cli/user_cmd.py`, `beril_cli/submit_cmd.py`,
   `tools/lakehouse_upload.py`) and `extensions/beril-safety.ts` is unchanged
   except where a phase explicitly notes it (none of phases 1–4 modify it).

---

## Explicitly deferred / out of scope (with rationale)

These are **not** in this plan. They are higher-risk, prerequisite-blocked, or
verdict-refuted; pursue them only as separate, independently-scoped work.

- **Port the byte-identical notebook hash to TS (KEEP in Python).** Inv 2: JS
  `JSON.stringify` diverges from Python
  `json.dumps(sort_keys=True, separators=(",",":"), ensure_ascii=False)` —
  **verified by direct test** on (a) integer-valued floats (`{"a":1.0}` → Python
  `{"a":1.0}` vs Node `{"a":1}`) and (b) supplementary-plane key sort order
  (Python by code point, JS `Array.sort()` by UTF-16 code unit). Compact
  separators + `ensure_ascii=False` UTF-8 *do* match, so the gap is narrow but
  real — and either divergence changes the sha256. All rendering in this plan
  consumes already-computed hex as opaque strings; nothing rehashes in TS.
- **TS Spark/MinIO path (KEEP in Python).** No maintained TS Spark Connect
  client exists; export writes happen server-side via cluster s3a creds that
  never reach the client. A TS port risks Inv 1 + Inv 4 and relocates the
  destructive recursive-delete primitive (Inv 5).
- **`query-table-renderResult` Markdown table card (#5, risk medium).** Verdict
  CAVEAT: the naive reuse of `lib/render.ts:renderTable` is a **silent
  data-corruption** bug for cells containing `|` or `\n` (the GFM lexer drops/
  splits cells). Ship only later, built from `result.details.rows` with a GFM
  cell-escape helper (`|`→`\|`, newlines→space) and an `options.expanded` gate,
  plus a round-trip regression test. Deferred until that escaping guard is
  written and tested.
- **`export-submit-confirm-overlay` (#14, high effort).** The confirm-with-facts
  `ctx.ui.custom` overlay requires the verified 3-way branch order
  (`!ctx.hasUI` → block; `mode==='tui'` → overlay; else → `ctx.ui.confirm`) plus
  a strip-only overlay component. High effort and it touches the safety-gate UX
  (Inv 5) — separate phase after the lower-risk slices land.
- **`hash-diff-card` (#25).** Verdict REFUTED `renderDiff` for two opaque hashes
  and the compare does not exist yet — needs a **new `beril verify`** Python
  subcommand to produce both hex values before any TS renderer is useful. Blocked.
- **`register-provider-org-endpoint` (#24, risk medium).** Verdict CAVEAT: the
  BERIL key is true Vertex/ADC, not an anthropic-messages gateway; making it work
  for Pi requires `start.py` to export `GOOGLE_APPLICATION_CREDENTIALS`/
  `GOOGLE_CLOUD_PROJECT`/`GOOGLE_CLOUD_LOCATION` on the pi branch plus an explicit
  Claude-on-Vertex `models[]`. Cross-cutting Python+TS change; out of this scope.
- **`skill-allowed-tools-preapprove` (refuted).** `allowed-tools` is
  parsed-but-ignored in Pi 0.78.1 (`skills.d.ts:3-16`, `skills.js:231-241`) — a
  no-op. Do not add it. If permission friction is the goal, extend the
  `beril-safety` `tool_call` hook's `isDestructive` allowlist instead (separate
  work, keeps the gate authoritative).
- **`context-state-injection` via `before_agent_start` (#7).** Verified primitive,
  but its value depends on the active-project + lifecycle cache built in Phases 2
  and 4; sequence it **after** this plan. When done it must append to
  `event.systemPrompt` (never replace) and reuse the TTL cache — not add a
  per-message `beril env`/`beril lifecycle status` exec.
- **`appendEntry`/`getBranch` persisted readiness or lifecycle session entries
  (#9).** Confirmed UI-independent, but Phase 4 deliberately uses an in-memory
  TTL cache + bus broadcast to avoid appending a custom entry on every readiness
  check (session-file churn). Add session persistence only if cross-restart
  read-cache is later required, and only on change.

These deferrals keep every change in this plan additive, reversible, and clear of
the two sha256 reproducibility primitives and the central safety gate.
