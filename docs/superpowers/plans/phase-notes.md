# beril-pi-agent — Execution Phase Notes

Running log of what was built/verified per phase, and what needs manual verification.

## ⚠️ Re-architecture (post-MVP): self-contained / vendored

The original build placed the `beril` CLI subcommands **in the original BERIL repo** (an unmerged branch) and had the Pi extensions call across to it — a cross-repo dependency that contradicted "a separate, complete alternative." **Corrected:** the `beril` CLI + the BERDL execution scripts/tools it wraps are now **vendored into this repo** (`beril_cli/`, `scripts/`, `tools/`, `pyproject.toml`, `PROJECT.md`). `beril-pi-agent` is now fully standalone and replaces the original repo's Claude Code/Codex skill layer; the **original BERIL repo is untouched (back at `940c3b0e`) and not a runtime dependency.** Commit `cdd9f0e`. Verified: **201 Python tests + 40 TS tests pass**; `beril env`/`lifecycle`/`hash` run end-to-end from this repo's root. (The phase log below was written against the original two-repo layout; the Python now lives here, not in `feat/beril-pi-subcommands`.)

## Phase 0 — Scaffold + Connect ✅ (automated checks green)

**Python (BERIL repo, branch `feat/beril-pi-subcommands`):**
- `1fee265f` refactor: `find_repo_root` → `beril_cli/paths.py`
- `e9572ded` feat: `beril env --json` (always exits 0; readiness in `ready`)
- `be5c04f8` feat: `beril start --agent pi` (extension-driven onboarding; no Vertex/opus/`/berdl_start`)
- 30 CLI tests pass (`uv run --group test pytest tests/test_cli_*.py -q`).
- **Live check:** `uv run beril env --json` emits pure JSON (first char `{`, no `[hub]` pollution). Contract holds.

**TypeScript (this repo, branch `feat/mvp`):**
- `22341fc` chore: scaffold (package.json `pi` manifest, tsconfig strict, biome, pinned pi 0.78.1 deps)
- `6c0d49e` feat: `lib/beril-exec.ts` (0/1/2 exit mapping + JSON parse)
- `7d24182` feat: `lib/readiness.ts` (`requireReady`)
- `48ba7a8` feat: `extensions/beril-env.ts` (tool + 2 commands + status widget)
- 11 TS tests pass (`bun run test`); `tsc --noEmit` clean.
- **Live check:** `pi install -l .` + `pi list` succeed → manifest valid, package + extensions load.

**Toolchain facts established:**
- Node 26 runs `.ts` tests natively in **strip-only** mode → NO parameter properties / `enum` / `namespace` (erasable syntax only).
- Test runner: `node --test 'test/**/*.test.ts'` (directory form fails). Typecheck: `bunx tsc --noEmit`.
- Python tests: `uv run --group test pytest tests/test_cli_<name>.py -q`; flat `tests/test_cli_*.py` naming.
- `typebox@1.1.38` is the correct package; `Type` imported from `"typebox"`.

**Deferred to manual verification (need interactive TUI + live BERDL + model auth):**
- [ ] `beril start --agent pi` launches Pi and the footer shows `BERDL … ✓/✗`.
- [ ] In Pi: `/berdl-status` refreshes; "check the BERDL environment" calls `berdl_env_check`.
- [ ] A real off-cluster connection (SSH tunnels 1337/1338 + pproxy) flips the widget to ready.

## Phase 1 — Query ✅ (automated)
- Python (`feat/beril-pi-subcommands`): `5ca45071` `beril query` (temp-file JSON, dodges `[hub]`), `71df008a` `beril discover`. 10 CLI tests; 173 total pass.
- TS (`feat/mvp`): `942ac21` `beril-safety` central gate (5 tests), `8bbed63` `beril-data` query+discover (renderTable, readiness-gated).
- Deferred manual: live bounded query renders a table in Pi; export triggers the safety confirm.

## Phase 2 — Governance core (the lift)
**TS (`feat/mvp`) ✅:** `8b82e58` governance tools (notebook_hash, lifecycle_transition, beril_user, lakehouse_submit); `ae02df5` `/synthesize` `/berdl-review` `/submit` commands. ORCID gate: `/submit` reads identity stdout, aborts before upload when ORCID empty, confirms destructive step, marks submitted/failed. 30 TS tests pass; tsc + biome clean; `pi install -l .` loads all 4 extensions.
**Python (`feat/beril-pi-subcommands`) ✅:** `9ec1f128` lifecycle state-machine core, `67975322` beril.yaml IO (+`pyyaml` dep), `f211477c` hash, `5f158c17` export (destructive), `cfa3d2b8` review+submit (2=partial=failure), `e15636ff` lifecycle subcommand.
**Checkpoint 2.9 — live no-mock smoke (verified by me):** drove `active→analysis→reviewed→complete`, **rejected illegal `analysis→complete` (exit 2)**, demote `reviewed→analysis`, `approve` (canonical key order), `marker` (SUBMITTED.md), `hash` ({} on no-notebook). beril.yaml serialization correct; pure-JSON stdout contract holds.
**Cross-repo contract audit:** found+fixed one mismatch — `beril submit` is positional (`submit <project>`), not `--project` (TS `e8a718b`); also added the missing `berdl_export` tool. All other TS→Python arg shapes match their subparsers.

## Phase 3 — Literature ✅ (automated)
- Python (`feat/beril-pi-subcommands`): `3afd7bae` lit client (PubMed E-utilities + Semantic Scholar; pure normalizers tested), `e3240568` `beril lit search|fetch` (+`httpx` dep). search→JSON array, fetch→JSON object (matches TS contract). 15 lit tests.
- TS (`feat/mvp`): `…` `beril-literature` — `lit_search`/`lit_fetch` tools + `/literature-review` fan-out (sub-agent topic expansion via `pi --mode json`, newline-only JSONL parse, per-query search, dedupe → `references.md`). lib/jsonl.ts tested.

## Phase 4 — Polish ✅ (skills/prompt/theme/README); 4.4 deferred
- 4.1 **8 Pi-optimized skills** (parallel workflow + audit): berdl-query, berdl-discover, synthesize, berdl-review, submit, literature-review, suggest-research, pitfall-capture. All valid frontmatter (name+description), zero execution mechanics, reference real tools/commands. Judgment/rubrics preserved from the BERIL originals.
- 4.2 `/berdl-start` prompt + `beril` theme (valid against Pi's theme schema).
- 4.3 README (install, launch, off-cluster connection, models.json provider, safety/isolation).
- **Final state:** TS — tsc+biome clean, 40 tests; Python — 245 tests. Package loads via `pi install -l .`.

### Deferred to manual verification (need interactive TUI + live BERDL + model auth)
- [ ] Full live loop in Pi: `beril start --agent pi` → `/berdl-status` ready → `berdl_query` renders a table → `/synthesize`→`/berdl-review`→`/submit` (ORCID gate + safety confirm) on a real project → `/literature-review` writes references.md.
- [ ] **4.4 integration smoke:** `pi --mode json --no-session "<prompt>"` against a mock `beril` on PATH (or live), exercising the query→synthesize→review→submit happy path end-to-end (needs a model).
- [ ] Provider: confirm the org `models.json` gateway (or ADC for Vertex) resolves.

## Pi-native optimization (post-MVP, branch `feat/pi-native`) ✅

Executed the highest-value/lowest-risk slices from `docs/superpowers/plans/2026-06-05-pi-native-plan.md`
(report: `docs/superpowers/specs/2026-06-05-pi-native-recommendations.md`) via subagent-driven TDD
(implement → spec-review → quality-review per phase; controller-owned verification + commits).
Final whole-branch review verdict: **SHIP**. Gate at every commit: `bunx tsc --noEmit` clean,
`bunx biome check .` clean, full `node --test` green, `uv run pytest -q` green, `pi install -l .` loads.
**Invariant guard:** `git diff main..HEAD` touches none of `notebook_hash.py`, `review.sh`,
`lakehouse_upload.py`, `lifecycle.py`, `hash_cmd.py`, `user_cmd.py`, `submit_cmd.py`, `beril-safety.ts`.

- **Phase 1 — literature ported to TS** (`ae66088`, `d18c3d3`): `lib/lit.ts` (Node `fetch`, byte-for-byte
  field mapping incl. `res.ok` parity with the Python `raise_for_status`) replaces the `beril lit`
  subprocess; `expandQueries` uses in-process `complete()` with a `summarize.ts`-style model fallback
  (headless-safe) + an injectable test seam. Removed `lit_cmd.py`, `lit_client.py`, the `lit` subparser,
  the `httpx` dependency, their pytest files, and the now-dead `lib/jsonl.ts`. Python 201 → 186 tests.
- **Phase 3 — tool_result hints** (`c656bbd`): `lib/hints.ts` + `extensions/beril-hints.ts` append a
  next-step advisory to `berdl_query`/`berdl_discover` results (e.g. truncation when
  `returned_rows == limit_applied`). Content-only patch — never touches `details`, so the payload stays
  byte-identical; runs only on `!isError`, so the `tool_call` safety gate is unaffected.
- **Phase 2 — footer project segment** (`07433c4`): governance tracks the active project and sets
  `ctx.ui.setStatus("beril-2-project", …)` (hasUI-guarded; cleared on `session_shutdown`).
- **Phase 4a — readiness TTL cache** (`8244b76`): `requireReady` fast-paths on a fresh, ready cached
  verdict (30s TTL), live-exec fallback otherwise; never caches not-ready; `beril-env` seeds it. Drops the
  per-tool `beril env` re-exec. `resetReadinessCache()` reset per-test in readiness/data suites.
- **Phase 4b — lifecycle events → footer** (`2339a41`): governance emits `beril:lifecycle`/`beril:submitted`
  on the shared `pi.events` bus after awaited success (the *returned* state); `beril-env` listens and sets
  `beril-3-lifecycle`. `beril.yaml` stays authoritative; payload is display-only.

**Deferred (per the plan's out-of-scope, higher-risk/blocked):** `query-table-renderResult` (needs GFM
cell-escaping), `export/submit confirm-with-facts overlay`, `hash-diff card` (needs a new read-only
`beril verify`), `registerProvider` Vertex/ADC, `before_agent_start` context injection, `appendEntry`
persistence. Keep-in-Python unchanged (Spark/MinIO, both sha256 primitives, lifecycle/ORCID).
