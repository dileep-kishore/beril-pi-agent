# Instructions for beril-pi-agent

- Always develop a plan before writing code. Confirm the plan before implementing.
- Avoid fixing unrelated issues when addressing a specific issue.
- State that you are using this file to guide your work.
- Do not monkeypatch third-party packages or edit code under `node_modules`,
  `.venv`, or `site-packages` as a fix. Prefer changes in this repository,
  dependency upgrades/pins, or upstream patches.
- This repo is **self-contained**: it replaces the Claude Code / Codex skill
  layer of the original BERIL Research Observatory and bundles its own BERDL
  execution substrate. Never import from, depend on, or modify that repo at
  runtime.

The role of this file is to describe common mistakes and confusion points that
agents might encounter as they work in this project. If you ever encounter
something surprising, alert the developer and add a note here.

## What this is

`beril-pi-agent` is a **Pi package** (`@earendil-works/pi-coding-agent`) that
turns the BERIL Research Observatory into a **terminal/TUI research
co-scientist** — not a web app. The product intent is **science in the
foreground**: it carries a researcher through the full arc — *explore data →
review literature → write a research plan → generate + run analysis notebooks →
synthesize a report → review → submit* — rendering every tool result as a
titled "science card," checking in at natural seams, and gating every
irreversible action behind confirmation, reproducibility hashing, and an ORCID
identity check. The human stays the verifier-of-record; the agent leads with the
artifact, not the command.

## Commands

```bash
# TypeScript (the Pi package — extensions/, lib/)
bun install
bun run check                                    # tsc --noEmit + biome check
bun run typecheck                                # tsc --noEmit only
bun run lint                                     # biome check .
bun run test                                     # node --test (test/**/*.test.ts)

# Python (the bundled `beril` CLI — beril_cli/, scripts/, tools/)
uv sync                                          # provides the `beril` command
uv run --group test pytest tests/ -q             # run all CLI tests
uv run beril <subcommand>                          # env/query/discover/hash/notebook/lifecycle/...

# Pi package registration + launch
pi install -l .                                  # register extensions/skills/prompts/theme (ONE-TIME; re-run after pulls)
uv run beril start                               # refresh token, pin release, exec Pi with this package
```

**Before committing or pushing**, run `bun run check` (TypeScript) and
`uv run --group test pytest tests/ -q` (Python) for whichever side you touched.

## TypeScript / Pi Package Stack

- **Language**: TypeScript (strict), ESM (`"type": "module"`).
- **Runtime**: Pi, verified against **0.78.1** (peer/dev-pinned in `package.json`).
- **Package manager**: Bun.
- **Linting/formatting**: Biome (`biome.json`, 2-space indent, 120 cols).
- **Tests**: `node --test` running `.ts` directly via Node's strip-only type
  stripping — **no runtime-dependent TS** (no `enum`, no constructor parameter
  properties, no namespaces).
- **Layout**: `extensions/*.ts` are the Pi extensions (one concern each: tools,
  commands, widgets, renderers, hooks). `lib/` is the shared logic they import —
  the `beril` exec bridge, the science-card renderer (`lib/ui/`), the calibrated-
  trust model, the review subagent, rubrics, and pure parsers. `skills/`,
  `prompts/`, `themes/` are resources Pi loads by directory.

## Python / `beril` CLI Stack

- **Language**: Python ≥ 3.11. **Package manager**: uv (always `uv run`).
- **`beril_cli/`** — the installed CLI (entry point `beril = beril_cli.cli:main`);
  the wheel builds **only** this package. Subcommands: `setup`, `doctor`,
  `start`, `env`, `query`, `discover`, `hash`, `notebook`, `export`, `submit`,
  `lifecycle`, `user`, `detect`. Most are thin wrappers over `scripts/`/`tools/`;
  the lifecycle state machine (`lifecycle.py`) is the one piece of real logic the
  CLI owns.
- **`scripts/`, `tools/`** — the BERDL execution substrate the subcommands wrap
  (Spark SQL via `run_sql.py`, MinIO export via `export_sql.py`, discovery,
  headless notebook execution, `notebook_hash.py` reproducibility hashing,
  `lakehouse_upload.py` destructive upload). These are **standalone**, invoked
  via `uv run`/subprocess and resolved relative to the workspace root — they are
  *not* packaged into the wheel.
- **Inline deps (PEP 723)**: the Spark/notebook `scripts/` declare their
  dependencies inline and run under `uv run`, so `uv` builds/caches their envs on
  first use. There is **no manual venv** (no `.venv-berdl`) to create or activate;
  the first Spark query is just slow while uv builds PySpark once.

## Architecture

**The one core split: judgment vs execution vs substrate.**

- **Skills (`skills/`) = scientific judgment** — query patterns, research
  protocols, rubrics, biological interpretation. Pure markdown `SKILL.md`,
  invoked as `/skill:<name>` or auto-selected by the model. No execution
  mechanics live here.
- **Extensions (`extensions/`) = the Pi surface** — tools (LLM-callable
  primitives), slash-commands, widgets/HUD, renderers, event hooks, state, and
  safety gates. They shell out to the bundled `beril` CLI via `lib/beril-exec.ts`
  (`berilExec(pi, [...])`, which wraps `pi.exec("beril", ...)` and parses JSON);
  they do **not** reimplement BERDL access in TypeScript.
- **`beril` CLI = execution substrate** — the proven Python that does the real
  work and owns reproducibility. `beril.yaml` is the authoritative per-project
  state; TS keeps only fast-path UI caches.

**The research arc is a lifecycle.** Projects move
`exploration → proposed → active → analysis → reviewed → complete` (with legal
demotes like `reviewed → analysis`), enforced by the `lifecycle_transition`
tool / `beril lifecycle`. The commands woven through it:
`/berdl-start → /literature-review → /research-plan → /analyze → /synthesize →
/berdl-review → /submit`, plus `/berdl-refute` (adversarial red-team pass).

**The extensions** (13, one concern each):

- `beril-env` — connection lifecycle (`berdl_env_check`, `/berdl-connect`,
  `/berdl-status`, `/berdl-welcome`) + the workflow HUD, custom footer, and
  first-launch welcome panel.
- `beril-data` — `berdl_query` (bounded read-only SQL), `berdl_discover`,
  `berdl_peek`, `berdl_feasibility`, `berdl_export` (destructive); `/berdl-preview`.
- `beril-analysis` — `notebook_scaffold` / `notebook_run` / `notebook_list` and
  `/analyze` (links the plan to executed notebooks).
- `beril-plan` — `research_plan` plan-card tool and `/research-plan`.
- `beril-literature` — `lit_search` / `lit_fetch` / `lit_stance` and
  `/literature-review` (in-process model calls for query expansion + stance,
  verify-on-write of PMIDs to drop fabrications).
- `beril-governance` — lifecycle + reproducibility + identity: `notebook_hash`,
  `lifecycle_transition`, `claim_ledger`, `evidence`, `beril_user`,
  `lakehouse_submit` (destructive); `/synthesize`, `/submit`.
- `beril-review` — `/berdl-review` (independent read-only reviewer subagent;
  advances `analysis → reviewed`, TOCTOU-guarded by report hash).
- `beril-refute` — `/berdl-refute` (red-team subagent; writes `REFUTATION_N.md`,
  changes no state).
- `beril-checkpoint` — `request_checkpoint` (pause at seams for science
  direction; auto-approves headless).
- `beril-safety` — the central destructive-action gate (`tool_call` hook).
- `beril-conduct` — injects the always-on research-conduct contract into the
  system prompt every turn (`before_agent_start`).
- `beril-display` — collapses routine tool output by default (TUI only).
- `beril-hints` — appends advisory next-step hints to successful BERDL results
  (patches `content` only, never `details`).

**Safety & calibrated trust** are the two cross-cutting invariants:

- Destructive tools (`berdl_export` overwrite, `lakehouse_submit`, bash
  `mc rm`/`rm -rf`) are defined in `lib/destructive.ts` and gated centrally by
  `beril-safety`: confirm in interactive mode, **blocked** headless
  (`--print`/`--mode json`/`--mode rpc`) — never silently accepted.
- Confidence is **computed, never verbalized** (`lib/science.ts`): high = ≥2
  independent re-runnable results, medium = exactly 1, low = literature-only.
  Claims must not sound more certain than their artifacts support; every claim
  carries a verbatim source pointer and, when found, refuting evidence.

Design specs, the implementation plan, and the **verified Pi API reference** live
under `docs/superpowers/`. Consult `specs/pi-api-reference.md` before using a Pi
API, and `specs/2026-06-06-skill-home-mapping.md` for where a capability belongs.

## Surprise Notes

These are gotchas that have tripped up agents in the past:

- **`pi install -l .` is the step people miss.** It registers extensions/skills
  with Pi and is required **once** before launch (re-run after pulling changes
  under `extensions/`). `beril start` does *not* install — it refreshes the
  token, moves the release pin, and execs the *already-installed* package.
  Confirm with `pi list`.

- **Pi 0.78.1 has a MINIMAL theme/symbol API.** The installed Pi is far older
  than the `oh-my-pi` HEAD clone — do **not** design themes/renderers against
  HEAD APIs. Verify against the installed version and
  `docs/superpowers/specs/pi-api-reference.md`.

- **`renderResult` is also called on FAILURE.** Pi invokes a tool's custom
  `renderResult` on failure with `details = {}` and `context.isError = true`
  (there is no `isError` on the result itself — tools throw to fail). Guard every
  custom `renderResult` for the error case or it renders "undefined". (Ctrl+O
  expands collapsed tool output.)

- **Text-presentation glyphs only.** All UI uses text-presentation Unicode from
  `lib/ui/glyphs.ts` — no emoji, no Nerd Font glyphs — and downgrades to ASCII
  under `NO_COLOR`/non-UTF locales, so cards render in any monospace terminal.

- **`node --test` strips, doesn't compile.** TS that needs runtime emit (`enum`,
  constructor parameter properties) fails under the test runner even if `tsc`
  accepts it. Keep extension/lib code strip-safe; tests use injectable seams
  (e.g. `__completer`, `__reviewSubagent`) rather than mocking modules.

- **Biome ignores half the tree.** `biome.json` excludes `beril_cli`, `scripts`,
  `tools`, `tests`, `themes`, `skills`, `prompts`. `bun run check` only covers
  `extensions/`, `lib/`, and `test/`; the Python side is linted/formatted
  separately.

- **CLI JSON goes through a file, not stdout.** The BERDL `[hub]` JupyterHub
  auto-spawn can pollute stdout, so subcommands write their JSON to a temp file
  and the extension reads it back. Don't "simplify" a wrapper to parse stdout.

- **Two distinct SHA-256 primitives — never conflate.** `notebook_hash.py`
  computes a *canonical-JSON* hash (tolerates JupyterLab autosave, detects real
  content drift) for reproducibility; review footers use a *raw-file* hash for
  TOCTOU integrity. They are not interchangeable.

- **BERDL Spark Connect routing.** The catalog REST plane and the per-user Spark
  Connect plane are separate. "I can see the tables but can't query them" usually
  means the session is bound to the wrong/foreign Spark cluster — not a grants
  problem. `isConnectivityError()` exists to keep infra outages from being
  reported as "the data can't answer this."

- **Off-cluster needs tunnels the agent can't open.** On a laptop, BERDL is
  reached via two SSH SOCKS tunnels (`-D 1337`, `-D 1338`) + `pproxy` on `:8123`.
  The agent cannot open SSH tunnels — the user starts them; `/berdl-connect`
  starts `pproxy` once the tunnels are up. On-cluster (JupyterHub) is direct.

- **Release pin only moves forward.** `beril start` checks out a newer published
  release only when strictly behind one (never downgrades, stays on feature
  branches). Set `BERIL_UPDATE_CHANNEL=main` to fast-forward to `origin/main`
  instead; an explicit `--version vX.Y.Z` always wins. To ship new work via the
  release channel, cut a new release tag — the pin tracks tags, not `main`.
