# beril-pi-agent — Execution Phase Notes

Running log of what was built/verified per phase, and what needs manual verification.

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
**Python (`feat/beril-pi-subcommands`):** lifecycle engine + hash/export/review/submit/lifecycle subcommands — in progress (background agent); to be verified at checkpoint 2.9.
