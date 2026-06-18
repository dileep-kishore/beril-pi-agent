# Skill → home mapping: skill vs extension vs sub-agent vs command

**Date:** 2026-06-06 · Companion to `2026-06-06-pi-native-coscientist-plan.md`.

Pi (unlike Claude Code) has no MCP and no built-in sub-agents/plan-mode; you
extend it only via **skills** (judgment), **extensions** (tools/commands/UI/
state/execution/safety/rendering), **prompts** (`/command` templates), and, for
isolated reasoning, an in-process **sub-agent** built on `createAgentSession`.
This is the decision record for where each BERIL capability lives.

## The rule

- **Skill** — scientific judgment, protocols, rubrics, interpretation, query
  patterns. No execution mechanics. Loaded as `/skill:<name>` or by the model.
- **Extension** — anything stateful, executable, safety-sensitive, or visual:
  tools the model calls, `/commands`, the lifecycle/footer/HUD, the destructive
  gate, and all rendering (cards, de-emphasis).
- **Sub-agent** — a bounded reasoning task that must run in isolation (its own
  read-only tool set, no recursion into our extensions), e.g. independent review.
- **Command** — the user-facing entry point; thin, usually delegating judgment
  to a skill (`sendUserMessage`) or orchestrating tools.

## Current capabilities and their homes

| Capability | Home | Why |
|---|---|---|
| Query patterns, SQL construction, pitfalls | skill `berdl-query` | pure judgment |
| Schema introspection / relationship reading | skill `berdl-discover` | judgment; tools do the fetch |
| Notebook design (structure, Spark/local, figures) | skill `analysis-notebooks` | judgment; execution is in the extension |
| Plan structure + feasibility | skill `research-plan` | judgment + template |
| Paper narrative planning | skill `paper-plan` | judgment; separates story assembly from analysis |
| Result interpretation, REPORT.md authoring | skill `synthesize` | judgment |
| Review rubrics, fix guidance | skill `berdl-review` + `lib/review-rubric.ts` | judgment (rubric text) |
| Submission readiness / approval semantics | skill `submit` | judgment |
| Topic ranking, snowballing, synthesis | skill `literature-review` | judgment |
| Landscape synthesis, candidate scoring | skill `suggest-research` | judgment |
| Gotcha capture protocol | skill `pitfall-capture` | judgment |
| MinIO credentials / `mc` usage | skill `berdl-minio` | judgment; `mc rm` routed through the gate |
| Bounded SQL / discover / peek / export | tools in `beril-data` | execution + rendering + readiness |
| Notebook scaffold / run / list | tools in `beril-analysis` + `beril notebook` CLI | execution + rendering + resume metadata |
| Planning preflight | tool `planning_preflight` in `beril-plan` | deterministic checkpoint artifact before `RESEARCH_PLAN.md` |
| Plan display | tool `research_plan` in `beril-plan` | rendering a file as a card |
| Paper-plan display | tool `paper_plan` in `beril-paper` | rendering `PAPER_PLAN.md` as a card |
| Lifecycle / hash / identity / submit | tools in `beril-governance` + `beril lifecycle/hash/user/submit` | state + irreversibility |
| Provenance / session trace | tools in `beril-audit` + project `provenance.json` / `TRACE.jsonl` | inspectable audit artifacts, not lifecycle authority |
| Literature search/fetch | tools in `beril-literature` + `lib/lit.ts` | execution (was the PubMed MCP) |
| Connection + workflow HUD | `beril-env` | UI/state |
| Tool de-emphasis defaults | `beril-display` | UI policy |
| Science checkpoints | tool `request_checkpoint` in `beril-checkpoint` | UI decision capture |
| Destructive-action gate | `beril-safety` + `lib/destructive.ts` | safety |
| Always-on conduct contract | `beril-conduct` + `lib/conduct.ts` | behaviour (system prompt) |
| **Independent review** | **sub-agent** (`lib/review-agent.ts`, Opus 4.8, read-only, empty extensions) | must not see the author's reasoning or recurse into the gate |

MCP → native: BERIL's original `.mcp.json` (PubMed + paper-search) has no Pi
equivalent; PubMed is already reimplemented natively in `lib/lit.ts` (NCBI
E-utilities over `fetch`). Any future literature source is a tool/extension, not
an MCP server.

## Unmigrated "cloud" skills — decisions

These exist in the original BERIL repo (`main @ 940c3b0e`) but are **not** in the
Pi port. They sit outside the three core researcher journeys (explore data →
literature/ideate → plan → analyze → paper-plan → report → review) and depend on
infrastructure the workbench does not own, so all are **deferred** — with a
recommended home for when they are picked up:

| Skill | What it does | Recommended Pi home | Status |
|---|---|---|---|
| `berdl-ingest` | In-cluster data ingest to the lakehouse (Iceberg/MinIO) | **skill** + a `beril ingest` CLI (generate + execute an ingest notebook); destructive → safety gate | deferred — needs ingest infra; `berdl-minio` covers small uploads now |
| `berdl-ingest-remote` | Off-cluster chunked ingest via the proxy | **skill** (or fold into `berdl-ingest` with a chunking flag) | deferred — complex; low demand |
| `remote-compute` | Batch jobs via the CDM Task Service (CTS) | **extension tool** (a compute dispatcher: submit → poll → fetch) | deferred — not the default analysis path (notebooks + local Spark are) |
| `phenix` | Structural-biology workflows on NERSC (Phenix/SLURM) | **sub-agent** (specialised, multi-step refinement reasoning) | deferred — niche; needs NERSC + Phenix |
| `linkml-schema` | Generate/validate LinkML schemas from informal data | **extension tool** (or low-priority skill) | deferred — data-curation, orthogonal to analysis |

Rationale for the homes: ingest is *judgment about how to bring data in safely*
(skill) over a *destructive execution path* (CLI + gate); remote-compute and
linkml-schema are *mechanical service calls* (tools); phenix is an *isolated,
domain-specific multi-step reasoner* (sub-agent). None block the core journeys,
so none are built here — this record is the decision the user asked for, not a
commitment to implement.
