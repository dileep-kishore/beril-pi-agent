# Context-aware, throttled, state-aware capability route-nudge — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `superpowers:test-driven-development` for each lane. Keep edits scoped to the
> files listed here. Run only the touched lane's targeted tests while iterating;
> run `bun run check` + `bun run test` before commit.

**Problem:** The capability route-nudge fires on **every turn** via the
`before_agent_start` hook in `extensions/beril-capabilities.ts:75-88`. It runs
`matchCapability(event.prompt)` — pure keyword regex on the literal user prompt —
and on any hit injects **both** a system-prompt steer **and** a card, with:
no `ctx` (so no project-trust / headless gate), no lifecycle-phase awareness, and
no dedup. Result: a casual word ("data", "submit", "contradict") recommends an
unrelated, often out-of-phase capability (e.g. `/berdl-refute` before any
findings exist), repeatedly.

**Goal:** Make the nudge (1) consider the **whole context** (lifecycle phase +
computed step, not just the literal prompt), (2) **not fire every turn**, and
(3) be **state-aware** (suppress / redirect by lifecycle reachability) — by
gating the existing hook on cheap, already-available signals. Keep all
presentation (the `CAPABILITIES` catalog, `routeNudge`/`resourceLabel`,
`capabilitiesCard`, the `beril-skill-nudge` renderer) unchanged. The problem is
firing **policy**, not formatting.

**Architecture:** Pure gating logic in a new `lib/nudge-policy.ts` (unit-testable
under `node --test`); the lifecycle-phase signal sourced from a module-closure
cache fed by the shared `beril:lifecycle` event bus (sync, zero per-turn
subprocess — honors the "TS keeps only fast-path UI caches" invariant); the hook
in `extensions/beril-capabilities.ts` does ctx/trust/headless gating + throttle
bookkeeping + IO.

**Tech stack:** TypeScript ESM Pi extensions, `node --test` (strip-only — no
`enum`, no constructor parameter properties), Biome. No new dependency.

## Verified Pi 0.79.1 facts this rests on
(checked against `node_modules/@earendil-works/pi-coding-agent/dist/.../types.d.ts`)
- `BeforeAgentStartEvent` carries **only** `prompt`, `images?`, `systemPrompt`,
  `systemPromptOptions` — **no** history / turn index. Any context beyond the
  prompt must come from `ctx`, not the event. (`types.d.ts:491-501`)
- The hook `ctx` is the full `ExtensionContext`: `isProjectTrusted()`, `hasUI`,
  `mode`, `sessionManager` (read-only: `getBranch()`/`getEntries()`), etc.
  (`types.d.ts:208-241`, `session-manager.d.ts:136`)
- Returning `{ systemPrompt, message }` injects steer + card; returning
  `undefined` fully suppresses (same early-return the hook already uses).
  (`types.d.ts:760-764`)
- The module-closure throttle idiom (a `let`/`Set` that survives across turns
  within a session) is established: `beril-memory.ts:34,116-131` (one-shot
  arm/disarm) and `beril-env.ts:79,90-93` (`lastPhase` once-per-change).
- The `beril:lifecycle` bus has **no replay**: register the listener at module
  load; seed once. Payload key is `state` (6-state lifecycle status);
  `beril lifecycle current` returns `{ project, status }`.
  (`beril-env.ts:151-161,332-347`)
- **Unverifiable from `.d.ts`:** whether Pi *awaits* an async
  `before_agent_start`. → The hook's returned decision **stays synchronous**.

## Locked design decisions (confirmed with the user)
1. **World-model phrasing → DEFERRED** to a follow-up. The hot path stays fully
   synchronous; no `session-state --get` subprocess inside the hook.
2. **Off-phase match → REDIRECT.** When a matched capability is not reachable
   from the current phase, suppress it and surface `recommendedCommand(status,
   project)` (the phase-correct next move) instead.
3. **Throttle → per-session.** A module-closure `Set<string>` keyed by
   `cap.id@status`, cleared whenever the status changes. Resets on
   `/reload`/`/new`/resume/fork (acceptable; `appendEntry` durability is a
   possible later add).
4. **Reachability → at-or-one-ahead.** Nudgeable when
   `requiredStep(cap) <= stepIndex(status) + 1`. Unknown status ⇒ don't gate
   (fall through to the throttled keyword nudge).

## Gates, in cheap-first order (the rewritten hook)
1. `if (!ctx.isProjectTrusted()) return undefined` — fail-closed (copies
   `beril-conduct.ts:24`; the current hook's real bug is injecting on untrusted
   projects).
2. `if (!ctx.hasUI) return undefined` — headless (json/print) suppress.
   *Implemented as a distinct check so a future "keep the steer headless" toggle
   is one line (see Risks).*
3. `const cap = matchCapability(event.prompt); if (!cap) return undefined;`
4. Reachability: compute `decideNudge({ cap, status, project })`.
   - reachable ⇒ `{ kind: "nudge", cap }`
   - not reachable ⇒ `{ kind: "redirect", command: recommendedCommand(status, project) }`
   - unknown status ⇒ `{ kind: "nudge", cap }` (don't gate)
5. Throttle: key = `nudge:cap.id@status` or `redirect@status`. If
   `nudgedInStatus.has(key)` ⇒ `return undefined`. Else `add(key)` and emit.
6. Emit: `{ systemPrompt: <append>, message: <beril-skill-nudge card> }`
   (append to `event.systemPrompt`, never replace).

---

## Phase 1 — Pure gating module `lib/nudge-policy.ts`

**Files:**
- New: `lib/nudge-policy.ts`
- New: `test/nudge-policy.test.ts`
- Reference (import only): `lib/research-steps.ts`, `lib/workflow.ts`,
  `lib/capabilities.ts`

- [ ] Write failing `test/nudge-policy.test.ts` asserting:
  - `requiredStep` for explore-lane caps (`start`, `discover`, `literature`,
    `world-model`, `memory`) = 0; `plan` = 1; `analyze`/`paper`/`synthesize` = 2;
    `refute`/`review` = 3; `submit` = 4.
  - `isReachable(submitCap, "exploration") === false`;
    `isReachable(analyzeCap, "proposed") === true`;
    `isReachable(planCap, "exploration") === true` (one-ahead);
    `isReachable(submitCap, "analysis") === true`.
  - Unknown status (`stepIndex(status) < 0`, e.g. `undefined`) ⇒ `isReachable`
    returns `true` (don't gate).
  - `currentStep("analysis") === "review"` is respected (don't read "analysis"
    as "still analyzing").
  - `decideNudge` with an off-phase match (`submit` cap, `"exploration"`) returns
    `{ kind: "redirect", command }` where `command === recommendedCommand("exploration", project)`.
  - `decideNudge` with an on-phase match returns `{ kind: "nudge", cap }`.
- [ ] Implement `lib/nudge-policy.ts`:
  - `requiredStep(cap: Capability): number` — explicit `cap.id → step index` map
    (string-literal/object map, **no enum**), defaulting explore-lane to 0.
  - `isReachable(cap, status): boolean` — `stepIndex(status) < 0 ? true :
    requiredStep(cap) <= stepIndex(status) + 1`.
  - `decideNudge({ cap, status, project }): NudgeDecision` (`"nudge" | "redirect"
    | "suppress"`). Reachable ⇒ nudge; unreachable & a `recommendedCommand`
    exists ⇒ redirect; else suppress. Pure: no fs, no IO, never throws.
  - `phrase(decision, cap?): string` helper that produces the redirect copy
    ("Next move here: `<command>`. …") reusing `routeNudge` for the nudge case.
  - Document that `status` is the **raw 6-state lifecycle status**, converted via
    `stepIndex`/`currentStep` from `lib/research-steps.ts`.
- [ ] **Verify:** `bun run typecheck`; `bun run test` runs the new file green.

## Phase 2 — Tighten `matchCapability` false positives

**Files:**
- Modify: `lib/capabilities.ts` (`matchCapability` + `CAPABILITIES[].aliases` only)
- Modify: `test/beril-capabilities.test.ts` (add a regression case)

- [ ] Write a failing regression test: a casual `"I updated the data table"` does
  **not** match `discover`; preserve the existing `test/beril-capabilities.test.ts:74-78`
  assertion that `"literature that refutes this?"` still routes to `literature`/
  `refute` (update it deliberately only if a narrowed regex requires it).
- [ ] In `lib/capabilities.ts:189-207`, anchor the per-alias regexes with `\b`
  (matching `routeOrder`) and drop bare-substring offenders: `discover`'s
  `query|data`, `start`'s `status`, `literature`'s `paper|novel|contradict`,
  `plan`'s `question`, `review`'s `audit|hash`. Add a one-line comment that
  `routeOrder` is precedence and `aliases` is fallback scoring.
- [ ] Do **not** change the `Capability` shape or any catalog field
  (`/skills`, `/capabilities`, the palette depend on them).
- [ ] **Verify:** `bun run test` green; the existing routeOrder assertion still
  passes (or is consciously updated); new regression passes.

## Phase 3 — Rebuild the test harness + add the phase cache

> The current `test/beril-capabilities.test.ts` `pi` stub has **no** `events` and
> **no** `exec`, and calls `before_agent_start({prompt, systemPrompt})` with one
> arg. Phase 4 adds `pi.events.on(...)` + `pi.on("session_start", ...)` at module
> load and changes the hook to `(event, ctx)` — which throws at **construction**
> for **every** test in that file (including the unrelated `/skills`,
> `/capabilities`, shortcut, and renderer tests). The harness must be **rebuilt**,
> not patched. Do this first so Phase 4 has a working harness.

**Files:**
- Modify: `test/beril-capabilities.test.ts` (rebuild harness on the
  `test/beril-env.test.ts` pattern)
- Modify: `extensions/beril-capabilities.ts` (cache + bus + guarded seed)
- Reference (import only): `lib/beril-exec.ts`

- [ ] Rebuild the harness mirroring `test/beril-env.test.ts`:
  - `fakeBus()` (`on`/`emit`) as `pi.events`;
  - `pi.exec` stub returning `{ project, status }` JSON (through the file path
    the bridge expects, or via the injectable seam if one exists);
  - a `ctx` factory exposing `isProjectTrusted()`, `hasUI`, `mode`, and
    `sessionManager.getBranch()`.
  - Keep the existing `/skills`, `/capabilities`, shortcut, and renderer tests
    passing through the rebuilt constructor.
- [ ] In `extensions/beril-capabilities.ts`, add module-closure state:
  `let status: string | undefined; let project: string | undefined; const
  nudgedInStatus = new Set<string>();`
- [ ] Register at module load (before any emit):
  `pi.events.on("beril:lifecycle", (d) => { const { state, project: p } = d as
  { state: string; project: string }; if (state !== status) nudgedInStatus.clear();
  status = state; project = p; })`.
- [ ] Add a **reason-gated** seed:
  `pi.on("session_start", async (e, ctx) => { try { if (!shouldSeed(e.reason) ||
  !ctx.hasUI) return; const cur = await berilExec(pi, ["lifecycle", "current"]);
  if (cur?.project) { project = cur.project; status = cur.status; } } catch {} })`
  — copy `beril-env`'s `shouldSeedActiveProject(reason)` guard (export/reuse it,
  or replicate the small reason check) so this cache and the HUD never disagree
  on a fresh `/new` session. One subprocess at startup only; sync reads after.
- [ ] **Verify:** `bun run check`; a unit test drives `session_start` with a stub
  `lifecycle current` → `{project:"aquila",status:"active"}` and asserts the
  cached `status` is `"active"`; emitting `beril:lifecycle` with a new `state`
  clears `nudgedInStatus`.

## Phase 4 — Rewrite the `before_agent_start` hook (synchronous, gated)

**Files:**
- Modify: `extensions/beril-capabilities.ts` (hook body)
- Reference (import only): `lib/nudge-policy.ts`, `lib/research-steps.ts`,
  `lib/workflow.ts`, `lib/aside.ts`

- [ ] Write failing tests in `test/beril-capabilities.test.ts`:
  - untrusted `ctx` ⇒ `undefined` (no card, no systemPrompt);
  - `hasUI:false` ⇒ `undefined`;
  - first trusted + UI on-phase match ⇒ returns `{ systemPrompt, message }` with
    the `beril-skill-nudge` card;
  - a **second identical** turn in the same status ⇒ `undefined` (throttle);
  - a status change (`beril:lifecycle` emit) re-arms ⇒ the same match nudges
    again;
  - off-phase match (`"submit …"` while status `exploration`) ⇒ a **redirect**
    whose command is `recommendedCommand("exploration", project)`
    (= `/berdl-preview <table>`), **not** a `/submit` nudge;
  - unknown status (no seed, no bus event) ⇒ keyword nudge fires (don't gate),
    once, then throttled under the `@unknown` key.
- [ ] Rewrite the hook to `(event, ctx)` implementing the cheap-first gate order
  in **Gates** above. Always **append** to `event.systemPrompt`. Wrap any
  best-effort work in `try/catch`; **never throw** (cf. `beril-audit.ts:56-63`).
  Keep the whole returned decision **synchronous** (no `await` in the return
  path — per the unverified async-await caveat).
- [ ] **(Optional, best-effort)** "route-already-taken" tightener: scan the last
  N **user-role** messages from `ctx.sessionManager.getBranch()` (reuse
  `branchToContext` from `lib/aside.ts:48-54`) for `cap.command`/`cap.skill`; on a
  hit, suppress. A miss never suppresses. The per-`(cap, status)` `Set` remains
  the primary, deterministic dedup — this is only a marginal tightener and may be
  skipped if it adds noise.
- [ ] **Verify:** all Phase 4 tests green; `bun run check` clean.

## Phase 5 — Full suite, lint, no-dep check

- [ ] `bun run check` (tsc --noEmit + Biome) clean; confirm strip-safety (no
  `enum`/parameter-properties introduced), text-presentation glyphs only in any
  new copy, and the `beril-skill-nudge` renderer's error path is unaffected
  (`capabilitiesCard` already guards).
- [ ] `bun run test` (node --test) green including `nudge-policy` + the rebuilt
  capabilities tests.
- [ ] `git diff package.json` shows **no** dependency change.

---

## Risks & mitigations
- **Async-await on the hot path (unverifiable):** the returned nudge decision is
  fully synchronous; only the `session_start` seed is async and tolerant of
  landing late. World-model phrasing (which would need an async read) is deferred.
- **Cold start / out-of-band phase change:** the reason-gated seed plus the
  `beril:lifecycle` bus keep `status` live; unknown status ⇒ don't gate, so the
  nudge never goes silent on a fresh session. A CLI-side phase change not via the
  `lifecycle_transition` tool is corrected on the next bus event (same staleness
  the HUD already tolerates).
- **`lifecycle current` mtime selection** skips complete projects and can return
  an older/empty project right after completion (`lifecycle_cmd.py:223-224`);
  affects only gating relevance, never correctness, and self-corrects on the next
  transition.
- **Over-suppression:** unknown-phase falls through, the throttle re-arms on each
  phase change, and Phase 4 includes a positive test that the nudge **does** fire
  on a fresh on-phase match.
- **Headless steer is a behavior change:** the current hook injects the
  system-prompt steer headless; this plan suppresses it. Implemented as a distinct
  `hasUI` check so re-enabling the steer (card off, steer on) headless is a
  one-line change if wanted later.
- **`systemPrompt` chaining order** across `beril-conduct`/`beril-memory`/
  `beril-capabilities` is unspecified in the type; always **append**, never
  depend on order.

## Out of scope
- World-model phrasing (deferred follow-up; cleanly separable — a pre-warmed
  closure cache fed by the bus/seed, then `phrase()` consumes it synchronously).
- Reload-durable throttling via `pi.appendEntry` (per-session is intentional).
- Any change to the lifecycle state machine / `FORWARD`/`DEMOTE` edges / Python
  CLI logic — the nudge **consumes** phase, it does not re-encode edge rules.
- `/skills`, `/capabilities`, `/capabilities --all`, the Ctrl+Shift+K palette —
  only the `before_agent_start` nudge path changes.
- Multi-capability "you might mean A or B" disambiguation (`matchCapability`
  stays winner-take-all).
- New tools / MCP / third-party deps; a generic `ctx.state` store (none exists in
  Pi 0.79.1).
