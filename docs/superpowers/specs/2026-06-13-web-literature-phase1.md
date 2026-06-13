# Phase 1 — Web + Literature + Safety (fit-first, Option A)

Status: in implementation (branch `feat/web-literature-phase1`)
Date: 2026-06-13
Runtime: Pi 0.79.1

## Priority stack (decided with the user)

1. **Fit + robustness first** — anything added must not cause issues and must
   complement the scientific-agent design (reliable, auditable, verifiable,
   self-contained). This outranks code minimization. No third-party code in a
   core path (tool access, the safety gate, reproducibility) that could break,
   churn, or be abandoned.
2. Minimize custom code we maintain — secondary to (1).
3. **No required paid web API** — free/no-key/already-have sources only by
   default; any keyed capability is optional and OFF by default.

This is **Option A**: deliver the bio/web value as free, targeted clients in the
proven `lib/lit.ts` pattern — **no generic MCP bridge, no third-party packages in
core paths**. A generic MCP bridge built on `@modelcontextprotocol/sdk` remains a
clean future option if arbitrary/OAuth servers are ever wanted.

Reversed from the earlier maintenance-lens draft: do **not** adopt
`@codella/pi-mcp-support` (v0.1.1, single maintainer, no OAuth, in the tool path)
nor `@gotgenes/pi-permission-system` (124 versions/41 days, in the safety gate).
Plannotator is out of scope entirely.

## Surviving third-party deps

`@mozilla/readability` + `linkedom` only (local URL→markdown; not in the safety
or tool-access path). Nothing v0.1.1 in the tool path; nothing in the safety
gate. Zero required spend.

## Components (build order)

### 0. Prereqs (done: devDep bump) + trust guards
- Bump the four `@earendil-works/*` devDeps `0.78.1 → 0.79.1` + `bun install`
  (required: `isProjectTrusted` / `setSessionName` exist only in 0.79.1 types).
- `beril-safety`: **fail-closed** — `ctx.isProjectTrusted()` checked after the
  `isDestructive` branch; untrusted ⇒ block every destructive call.
- `beril-conduct`: **no-op safely** — untrusted ⇒ return `undefined` (base prompt
  preserved); conduct grants no capability so blocking is unnecessary.
- Files: `package.json`, `extensions/beril-safety.ts`, `extensions/beril-conduct.ts`.

### 1. Safety sensitive-path deny
- Add `SENSITIVE_PATHS` to `lib/destructive.ts`; widen `isDestructive` so a
  built-in `bash` command reading/writing `.env`/`~/.ssh`/keys/credentials routes
  through the existing confirm-interactive / block-headless gate. No package, no
  change to `beril-safety.ts`. A tripwire (regex), not a parser — false positives
  cost a confirm, never silent loss.
- Files: `lib/destructive.ts`, `test/beril-safety.test.ts`.

### 2. Europe PMC client (free, no key)
- New `lib/europepmc.ts` mirroring `lib/lit.ts`; **shares the one rate gate**
  (`acquireSlot`/`sleep` exported from `lit.ts`). Add `doi?` to `LitRecord`.
- `lit_search` becomes dual-source (PubMed + Europe PMC, merged via existing
  `dedupe`, PubMed-first). `resolveDoi` extends verify-on-write to DOI-only
  records; `references.md` + lit card gain a DOI link fallback.
- Open-access full-text via `.../{source}/{id}/fullTextXML` (thin primitive).
- Files: `lib/europepmc.ts`(new), `lib/lit.ts`, `extensions/beril-literature.ts`,
  `lib/ui/science-cards.ts`, `test/europepmc.test.ts`(new).

### 3. Web tools + evidence tiers
- `lib/web.ts`: `readWeb` (global `fetch` → `linkedom` → `@mozilla/readability`,
  http(s)-only + RFC1918/loopback/link-local SSRF guard + size + timeout) and a
  Context7 **no-key** docs client (optional `CONTEXT7_API_KEY` lifts limits; 429 ⇒
  honest best-effort card, never throws).
- `extensions/beril-web.ts`: read-only `web_read` + `docs_lookup` tools (NOT in
  `lib/destructive.ts`).
- Evidence tiers: extend `EvidencePointer.kind` union with `"web"`/`"docs"`;
  `isResult` already keeps them LOW (no tier-logic change). `glyphs.ts` +
  `claim-ledger.ts` tags + `science-cards.ts` web/docs cards (source URL +
  retrieval date on every card).
- New deps: `@mozilla/readability`, `linkedom`.
- Files: `lib/web.ts`(new), `extensions/beril-web.ts`(new), `lib/science.ts`,
  `lib/claim-ledger.ts`, `lib/ui/science-cards.ts`, `lib/ui/glyphs.ts`,
  `package.json`, `test/web.test.ts`(new).

### 4. Parallel multi-specialist review panel
- `lib/parallel-map.ts`: bounded `Promise.allSettled` worker pool (zero deps).
- Split `PROJECT_REVIEW_RUBRIC` into stats / biology / reproducibility specialist
  personas + reuse the refuter; `REVIEW_PANEL` manifest. `runReviewPanel` +
  pure `mergePanelReviews` over the **unchanged** `runReviewSubagent` (isolated,
  read-only `[read,grep,find,ls]`). `/berdl-review --panel` writes one merged
  `REVIEW_N.md`; single-reviewer path unchanged. TOCTOU report-hash preserved.
- Unit test asserts every panel spec's tool allowlist excludes destructive tools.
- Files: `lib/parallel-map.ts`(new), `lib/review-rubric.ts`, `lib/review-agent.ts`,
  `extensions/beril-review.ts`, tests.

### 5. Session naming + resume
- `pi.setSessionName(\`${project} · ${phase}\`)` (note: on `pi`, not `ctx`) wired
  into the `beril-env` lifecycle listener + `seedActiveProject`; idempotent via
  `getSessionName()`.
- `beril_cli/start.py`: thread `--continue` as default extra arg, suppressed if
  the user passes any session flag (`--continue/--resume/--session*/--fork/--no-session`,
  incl. `=`-joined forms).
- Files: `extensions/beril-env.ts`, `beril_cli/start.py`, `tests/test_cli_start_pi.py`.

## Verification
`bun run check` (tsc + biome) + `bun run test` (node --test) for TS;
`uv run --group test pytest tests/test_cli_start_pi.py -q` for the Python side.
All TS additions are strip-safe (no enum / param-props / namespace).
