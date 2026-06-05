# beril-pi-agent — Design Spec

**Date:** 2026-06-05
**Status:** Approved (design); ready for implementation planning
**Companion reference:** [`pi-api-reference.md`](./pi-api-reference.md) — verified Pi 0.78.1 API + BERIL interface extracts. This spec references it for exact signatures rather than duplicating them.

---

## 1. Summary

`beril-pi-agent` is a **separate git repo** distributed as a single **Pi package** that turns the BERIL Research Observatory into a terminal/TUI research workbench on top of [Pi](https://github.com/earendil-works/pi) (earendil-works, `@earendil-works/pi-coding-agent`, verified against **0.78.1**).

It keeps BERIL's **scientific judgment** (query patterns, research protocols, rubrics, biological interpretation) as Pi **skills**, and moves **connection, execution, state, safety, and rendering** into Pi **extensions** that shell out to a stable `beril <subcommand>` CLI. The "doing" stays in BERIL's proven Python; the package owns the Pi surface.

**This is not a web UI project.** No browser UI, no Observatory web-app integration.

### Design rule (from the brief)
- **Skill** = scientific judgment, research protocols, rubrics, biological interpretation, query patterns (markdown guidance).
- **Extension** = UI, commands, tools, state, permissions, execution, rendering, reproducibility (code that *does* things, holds state, or guards safety).

### Approved decisions
| # | Decision | Choice |
|---|---|---|
| 1 | MVP scope | **Core research loop + literature**: connection, data access, governance lifecycle (synthesize→review→submit with reproducibility + ORCID gate), and literature review. Out: ingest, remote-compute, phenix. |
| 2 | TS ↔ Python relationship | **Thin TS wrappers** that shell out (`pi.exec`) to Python. Python keeps the logic + reproducibility. |
| 3 | TS → Python boundary | **Stable `beril <subcommand>` CLI** (additive subcommands in the BERIL repo). |
| 4 | Distribution | **Separate git repo**, installed via `pi install git:` (private SSH for internal KBase/LBL). |
| 5 | Launch model | **`beril start` execs `pi`** — CLI stays the version-pin / token / provider / reproducibility boundary. |
| 6 | Model provider | **Org-managed endpoint via `models.json`** (gateway `baseUrl` + `$ENV` key). |
| 7 | Literature / sub-agents | **Subprocess sub-agents + direct-API bridge** (see §3.4 — MCP is unavailable in Pi, so the "MCP bridge" is realized as direct HTTP-API subcommands). |
| 8 | Skill portability | **Pi-optimized skills** (reference Pi tools/commands directly; not portable back to Claude Code). |
| 9 | Safety posture | **Central destructive-action gate** (`tool_call` hook → `ctx.ui.confirm`) + documented isolation. |
| 10 | Decomposition | **Capability-aligned**: 5 bounded extensions + shared `lib/` + skills + prompts + theme. |

### Default deployment assumption
Pi runs **off-cluster** on a researcher's laptop and connects **remotely** to BERDL through the existing SSH-tunnel (1337/1338) + pproxy (8123) stack. On-cluster (BERDL JupyterHub) is also supported (direct access). The connection lifecycle is a first-class extension concern (§3.1).

---

## 2. Architecture

### 2.1 One package, four resource types
Wired via the `pi` key in `package.json` (verified manifest keys: `extensions`, `skills`, `prompts`, `themes` — reference §A5):

```
beril-pi-agent/                       # separate git repo = one pi package
├── package.json                      # { "pi": { extensions, skills, prompts, themes }, keywords:["pi-package"] }
├── tsconfig.json                     # strict TS
├── biome.json                        # lint/format (Pi's toolchain)
├── extensions/
│   ├── beril-env.ts                  # connection lifecycle + readiness gate + status widget
│   ├── beril-data.ts                 # berdl_query / berdl_export / berdl_discover / inventory
│   ├── beril-governance.ts           # lifecycle state machine + hashing + /synthesize /berdl-review /submit
│   ├── beril-literature.ts           # /literature-review + lit_search / lit_fetch + sub-agent fan-out
│   └── beril-safety.ts               # central tool_call gate → ctx.ui.confirm on destructive tools
├── lib/                              # shared, non-extension TS
│   ├── beril-exec.ts                 # typed pi.exec("beril", …) wrapper: JSON parse + 0/1/2 exit mapping
│   ├── readiness.ts                  # requireReady() guard (env check + structured next-steps)
│   ├── destructive.ts               # registry of destructive tool names + arg-inspection helpers
│   └── render.ts                     # TUI renderers (tables/status), all hasUI/mode-gated
├── skills/                           # Pi-optimized SKILL.md (judgment only)
│   ├── berdl-query/  berdl-discover/  synthesize/  berdl-review/
│   ├── submit/  literature-review/  suggest-research/  pitfall-capture/
├── prompts/                          # slash-command prompt templates (e.g. berdl-start.md → /berdl-start)
├── themes/                           # optional beril.json theme
├── test/                             # TS unit tests (lib + tool schemas + safety gate)
└── docs/                             # this spec + reference + READMEs
```

### 2.2 Interface boundary (TS → Python)
TS tools **never** touch BERDL directly. Every tool calls `berilExec(pi, ["<subcommand>", …])` which runs the pip-installed `beril` CLI via `pi.exec` (reference §A1: `exec(cmd, args, opts) → {stdout, stderr, code, killed}`; note `code`, not `exitCode`; `timeout` is ms). The wrapper:
- maps BERIL's **0/1/2 exit contract** (0 ok / 1 runtime failure / 2 config-or-usage) to typed results,
- parses JSON from a **file** the subcommand writes (via `--output`/`--json-out`) to avoid `[hub]` stdout pollution from `ensure_hub()` (reference §B2 hazard),
- surfaces `stderr` notices (e.g. "Missing field(s)") separately from data.

### 2.3 Launch flow
`beril start --agent pi`:
1. `os.chdir(repo_root)` (walk up for `PROJECT.md`),
2. checkout pinned version/tag (reproducibility),
3. `_sync_auth_token(.env)` (refresh `KBASE_AUTH_TOKEN`),
4. ensure org provider config (write/verify `models.json` or `.pi/settings.json` provider; **not** Claude-Code Vertex env — reference §A7 correction),
5. `os.execvp(which("pi"), ["pi", *extra_args])`.

Onboarding (formerly an injected `/berdl_start`) is handled by **`beril-env`'s `session_start` hook**, which runs the readiness check and renders the connection-status widget — no prompt injection needed in Pi.

### 2.4 Skill ↔ command ↔ tool contract
Verified naming (reference §A6): skills are invocable as **`/skill:<name>`** and are model-auto-invocable; bare **`/<name>`** commands must be **extension commands** (`registerCommand`). Therefore:
- **Skills** (`skills/*/SKILL.md`) carry judgment/rubrics, Pi-optimized (may name the tools/commands they pair with).
- **Extension commands** (`/synthesize`, `/berdl-review`, `/submit`, `/literature-review`, `/berdl-connect`, `/berdl-status`) are TS handlers that orchestrate tools + state and reference the matching skill for judgment.
- **Tools** (`registerTool`) are the model-callable execution primitives, each shelling to a `beril` subcommand.

A command like `/submit` = *skill supplies the approval semantics* + *command orchestrates ORCID gate → hash compares → guarded upload* + *safety gate confirms the destructive step*.

---

## 3. The five extensions

### 3.1 `beril-env` — connection lifecycle (MVP, Phase 0)
- **Tool:** `berdl_env_check` → `beril env --json` (read-only; on/off-cluster, tunnel/pproxy/token readiness, structured `next_steps`).
- **Commands:** `/berdl-connect` (run check, auto-start pproxy when tunnels up, print SSH-tunnel instructions — *the agent cannot start user SSH tunnels*), `/berdl-status` (re-render status).
- **Hooks:** `session_start` → readiness check → `ctx.ui.setStatus("beril-connection", …)` widget (on/off-cluster + health), guarded on `ctx.hasUI`; dispose in `session_shutdown`.
- **Permission surface:** starts local pproxy (port 8123); reads/writes `KBASE_AUTH_TOKEN` in `.env`.
- **Shared dependency:** exposes `requireReady()` used by data/governance tools to refuse execution when not connected.

### 3.2 `beril-data` — data access (MVP, Phase 1)
- **Tools:**
  - `berdl_query` → `beril query` (bounded SELECT; `--limit` default 100 rail; read-only). Params via `Type.Object({ query, limit? })`.
  - `berdl_export` → `beril export` (**DESTRUCTIVE**: `--mode overwrite` default replaces MinIO data). Tagged destructive → routed through `beril-safety` confirm.
  - `berdl_discover` → `beril discover` (access-aware introspection; writes a snapshot file).
- **Rendering:** `renderResult` table/inventory via `lib/render.ts`, gated on `ctx.hasUI`.
- **Gating:** every tool calls `requireReady()` first.

### 3.3 `beril-governance` — lifecycle state machine (MVP, Phase 2) — *the highest-value lift*
Lifts the `beril.yaml` lifecycle + hashing logic — currently duplicated across the `synthesize`/`berdl-review`/`submit` skill prose — into one code source of truth.
- **Tools:**
  - `notebook_hash` → `beril hash` (canonical-JSON SHA-256; `sha256:` prefix convention; compare `computed_hex == unprefixed(stored)` — reference §B3).
  - `lifecycle_transition` → `beril lifecycle` (**new subcommand to build**): enforces the state machine `exploration→proposed→active→analysis→reviewed→complete` + legal demotes; reads/writes `beril.yaml`, markers, README `## Status`.
  - `beril_user` → `beril user --json` (ORCID identity oracle; exit 0 iff `name`+`affiliation`+`orcid` all non-empty).
  - `lakehouse_submit` → `beril submit` (**DESTRUCTIVE**: `mc rm --recursive --force` pre-clear + upload; 0/1/2 where **2 = partial = failure**). Routed through `beril-safety`.
- **Commands:** `/synthesize` (interpretation skill → REPORT.md + `analysis` transition), `/berdl-review` (spawn independent reviewer via `beril review`, validate `<!-- report_hash: sha256:… -->` footer, `reviewed` transition), `/submit` (lock → checklist → hash compares → ORCID gate → guarded upload → markers + `submissions[]`).
- **State owned:** `beril.yaml` (incl. `approval`/`previous_approvals[]`/`submissions[]`), `SUBMITTED.md`/`SUBMISSION_FAILED.md` (FAILED always wins), `.submit.lock`, memory promotion (`memories/discoveries.md`, `performance.md`, append-only `pitfalls.md`). Session lifecycle context via `appendEntry`.

### 3.4 `beril-literature` — literature review (Phase 3)
Pi has **no MCP** (reference §A7), so the original "MCP bridge" is realized as **direct-API subcommands**:
- **Tools:** `lit_search` / `lit_fetch` → `beril lit search|fetch` (**new subcommands**) that hit PubMed E-utilities + Semantic Scholar HTTP APIs directly (httpx), replacing the `.mcp.json` pubmed/paper-search servers. Read-only; write `references.md`.
- **Command:** `/literature-review` (rubric skill) + **sub-agent fan-out** via `pi.exec("pi", ["--mode","json","--no-session", prompt])`, parsing JSONL **split on `\n` only** (reference §A7), or in-process `complete()` from `@earendil-works/pi-ai`.

### 3.5 `beril-safety` — central destructive-action gate (MVP skeleton Phase 1, completed Phase 2)
- **Hook:** `pi.on("tool_call", …)` → if `event.toolName` ∈ destructive registry (`berdl_export`, `lakehouse_submit`, plus arg-inspected built-ins like `bash` running `mc rm`/`rm -rf`) → `ctx.ui.confirm`; **block** (`return {block:true, reason}`) on deny or when `!ctx.hasUI` (headless auto-deny). Blueprint verbatim from `permission-gate.ts`/`confirm-destructive.ts` (reference §C).
- **Docs:** ships Docker/OpenShell isolation guidance (Pi has no sandbox).

---

## 4. Additive changes to the BERIL repo

New `beril` subcommands (thin wrappers except `lifecycle`/`lit`, which are net-new engines). Added on a branch in the BERIL repo, following the existing argparse-subparser + lazy-import dispatch pattern (reference §B1):

| Subcommand | Wraps | New? | Notes |
|---|---|---|---|
| `beril env --json` | `detect_berdl_environment.py` / `berdl_env.py` | wrap | readiness JSON |
| `beril query` | `scripts/run_sql.py` | wrap | JSON→file to dodge `[hub]` pollution |
| `beril export` | `scripts/export_sql.py` | wrap | destructive (overwrite) |
| `beril discover` | `scripts/discover_berdl_collections.py` | wrap | snapshot file |
| `beril inventory` | `scripts/berdl_inventory.py` | wrap | markdown report |
| `beril hash` | `tools/notebook_hash.py` | wrap | prefixed-JSON passthrough |
| `beril review` | `tools/review.sh` | wrap | independent reviewer + footer |
| `beril submit` | `tools/lakehouse_upload.py` | wrap | destructive; 0/1/2 |
| `beril lifecycle` | — | **build** | state-machine engine (the lift) |
| `beril lit search\|fetch` | — | **build** | direct PubMed/Semantic Scholar HTTP |
| `beril start --agent pi` | extend `start.py` | extend | exec `pi`; provider config; no Vertex env |

These subcommands are the stable contract the TS tools call. Each ships with pytest coverage in the BERIL repo.

---

## 5. Cross-cutting concerns

| Concern | Where it lives | Notes |
|---|---|---|
| Env detection | `beril-env` + `beril env` | single canonical readiness service; `session_start` widget |
| Credentials/auth | extension layer reads files | `KBASE_AUTH_TOKEN` in `.env`; MinIO in `~/.mc`; provider via `models.json` `$ENV`. **No Pi settings *write* API** — config via files (reference §A7) |
| SQL result flow | `beril-data` | bounded inline (`query`, limit 100) vs MinIO export (`export`, overwrite). JSON read from `--output` file, not stdout |
| Reproducibility | `beril-governance` + Python | two distinct `sha256:` primitives — canonical notebook hash (`beril hash`) vs raw-file `sha256sum` (review footer). Never conflate (reference §B3) |
| Provider/model routing | `models.json` (+ optional `registerProvider`) | org/Vertex/vLLM gateway; `$VAR`/`!cmd` secret resolution |
| Safety | `beril-safety` central + `requireReady()` | one auditable gate; headless = auto-deny |
| Sub-agents | `pi --mode json` subprocess / `complete()` | no native nested-agent API; JSONL split on `\n` only |

---

## 6. Error handling

- **Tools throw on failure** (verified: `AgentToolResult` has no `isError`; reference §A2). `berilExec` throws a typed `BerilError` carrying `{code, stderr, subcommand}`; tool `execute` lets it propagate so Pi surfaces it as a tool error.
- **Exit-code mapping:** 0 → result; 1 → runtime failure (throw with stderr); 2 → config/usage error (throw with actionable `next_steps`); for `beril submit`, **2 = partial = failure** (throw, preserve the partial-archive JSON in the error).
- **Not-ready** (`requireReady()` fails) → tool throws with the structured `next_steps` (SSH tunnel/pproxy/token guidance) instead of attempting execution.
- **Headless safety** (`!ctx.hasUI`) → destructive tools auto-deny (block) rather than silently proceeding.
- **TOCTOU integrity** preserved in Python (`review.sh` pre/post report-hash; `submit` pre/post rehash) — the TS layer does not re-implement it.

---

## 7. Testing strategy

**Python (BERIL repo, pytest):**
- Each new wrapper subcommand: arg parsing, exit-code passthrough (0/1/2), JSON-to-file output, stdout-pollution isolation (mock `run_sql`/`export_sql`/`mc`).
- `beril lifecycle`: dedicated state-machine tests — every legal transition + every illegal transition rejected; demote bookkeeping (`approval`→`previous_approvals[]`); marker invariants (exactly one of SUBMITTED/FAILED; FAILED wins); hash-compare gating (prefixed/unprefixed); ORCID gate.
- `beril hash`: byte-for-byte canonicalization + `sha256:` prefix idempotency.
- `beril lit`: API client with mocked HTTP (httpx mock) — query building, ranking, `references.md` shape.

**TypeScript (this repo):**
- `lib/beril-exec`: exit-code→result/throw mapping (mock `pi.exec`).
- `lib/readiness`: ready/not-ready branching with structured next-steps.
- Tool param schemas: each `Type.Object` validates representative good/bad inputs.
- `beril-safety` gate: fake `ctx` → confirm-yes allows, confirm-no blocks, `!hasUI` blocks; destructive-arg detection (`bash` w/ `mc rm`).
- `session_start` status: sets/clears widget under `hasUI`, no-ops headless.
- **Integration smoke:** `pi --mode json` against a **mock `beril` CLI** on `PATH` exercising query→synthesize→review→submit happy path.

**Verification gates between phases:** each phase ends with a runnable check (see §8) and green tests before the next phase starts; commit per green slice.

---

## 8. Phasing (tracer-bullet vertical slices)

| Phase | Deliverable | Verify |
|---|---|---|
| **0 — Scaffold + connect** | repo scaffold (package.json/tsconfig/biome), `lib/beril-exec` + `readiness`, `beril-env` ext, `beril env` subcommand, `beril start --agent pi` | off-cluster `beril env --json` ok; `pi` launches with package; status widget = ready |
| **1 — Query** | `beril-data` (`berdl_query`/`berdl_discover`) + `beril query`/`discover` + `beril-safety` skeleton | bounded query end-to-end in Pi against (mock or live) BERDL |
| **2 — Governance core** | `beril lifecycle` (state-machine lift) + `beril hash` + `berdl_export`(guarded) + `/synthesize` `/berdl-review` `/submit` + `beril review`/`submit`/`user` wiring + full `beril-safety` | full lifecycle exploration→complete with hash + ORCID + submit gate (mock upload) |
| **3 — Literature** | `beril lit search\|fetch` + `lit_search`/`lit_fetch` tools + `/literature-review` + sub-agent fan-out | `/literature-review` produces `references.md` |
| **4 — Polish** | Pi-optimize all skills, `/berdl-start` prompt, theme, packaging (peer/bundled deps), install docs, isolation guidance | `pi install git:…` clean install; docs complete |

---

## 9. Risks & residual unknowns (resolve during implementation)

Carried from the verified reference (Part D residuals):
- **`beril lifecycle` is net-new** — the state machine lives only in skill prose + `tools/*.{py,sh}` today; building it correctly (hash compares, marker invariants, demote bookkeeping) is the riskiest piece → heaviest test coverage.
- **`beril.yaml` approval/submissions ordering** has no on-disk example → our `beril lifecycle` defines the canonical serializer; tests pin it.
- **`[hub]` stdout pollution** under `--berdl-proxy` → wrappers must route JSON to files; verify at runtime.
- **Off-cluster network chain is human-gated** — SSH tunnels (1337/1338) require user creds and cannot be agent-started; `beril-env` instructs, doesn't automate.
- **Provider/Vertex** — confirm the org endpoint works via `models.json` `anthropic-messages` + gateway, or ADC for true Vertex; BERIL's `CLAUDE_CODE_USE_VERTEX` env does not apply to Pi.
- **`tool_call` throw-vs-return** — use `return {block,reason}` (documented); throwing inside the handler is unverified.
- **MCP unavailable** — literature uses direct APIs, accepted as a scope adaptation of decision #7.
- Runtime checks needed: `confirm`/widget behavior in real TUI; `detect_berdl_environment.py` JSON schema; MinIO cred pickup in `export_sql`; pi-as-reviewer vs claude/codex in `review.sh`.

---

## 10. Out of scope (MVP)

BERIL web app (ORCiD OAuth/Postgres/session), `berdl-ingest`/`-remote`, `remote-compute` (CTS), `phenix` (NERSC SLURM), `linkml-schema` generation, `berdl-minio` admin. Each is a clean follow-on extension (`beril-ingest`, `beril-compute`, `beril-phenix`) added later without disturbing the MVP surface.
