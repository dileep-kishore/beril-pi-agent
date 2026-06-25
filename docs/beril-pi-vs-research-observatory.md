# beril-pi-agent vs the BERIL Research Observatory

What this package is, how it relates to the original BERIL Research Observatory,
and what makes it different — including the recent trust-hardening additions.

## What beril-pi-agent is

`beril-pi-agent` (`@earendil-works/pi-coding-agent`) is a self-contained **Pi
(terminal/TUI) research co-scientist**. It carries a researcher through the full
arc — explore data → review literature → write a plan → generate and run analysis
notebooks → synthesize a report → review → submit — rendering every tool result
as a titled "science card" and gating irreversible actions behind confirmation,
an integrity hash, and an ORCID identity check.

It **replaces the Claude Code / Codex skill layer** of the original BERIL
Research Observatory and **bundles its own BERDL execution substrate**
(`beril_cli/`, `scripts/`, `tools/`). Scientific judgment lives in Pi skills;
the Pi surface (tools, commands, cards, gates, hooks) lives in extensions that
shell out to the bundled `beril` CLI.

### Standalone invariant (load-bearing)

This repo must **never import from, depend on, or modify the original BERIL
Research Observatory at runtime**. The original was read **read-only**, for this
document only. See the `beril-pi-agent-standalone` team memory.

## The original BERIL Research Observatory

For contrast, the original (`kbaseincubator/BERIL-research-observatory`, the
"Microbial Discovery Forge") is several things at once:

- A hosted **web application** — the FastAPI Observatory UI (`ui/`,
  beril.kbase.us) for browsing collections, projects, and the BERIL Atlas.
- A **Claude Code / Codex skill layer** (`.claude/skills/`, `.claude/reviewer/`)
  that any skill-capable coding agent loads, plus shared `docs/` "observatory
  memory" (discoveries, pitfalls, schemas).
- A BERDL execution substrate (Spark SQL, ingestion, MinIO transfer).
- A `beril` CLI scoped to environment management (`setup`, `doctor`, `start`)
  that launches a coding agent.

Its review step is a prompt-based AI reviewer, and `/submit` "requests a formal
**AI** review" — there is no independent reviewer subagent and no human identity
gate on the lifecycle.

## Recent additions (trust-hardening line of work)

These advance beril's distinctive, field-validated stance rather than chasing
autonomy. Each lands on a state plane that already exists — no new store, no new
subagent.

- **WS1 — a trustworthy review gate.** The independent read-only reviewer now
  carries a **data-leakage / evaluation-integrity rubric** (benchmark selection,
  train/test and target/feature/group leakage, metric misuse, post-hoc test-set
  selection) and is told to **read cell outputs** (metrics, split sizes, class
  balances), not just source. The `analysis → reviewed` transition now requires
  an explicit **human, ORCID-bound sign-off**, enforced in the Python state
  machine so the generic `lifecycle_transition` tool cannot bypass it; AI review
  is advisory. Activating the long-dormant approval block also **unbroke
  `/submit`**.
- **WS2 — a groundedness axis on calibrated trust.** Computed trust now
  distinguishes *the source supports the claim* from *there is enough independent
  evidence*: `groundednessForEvidence` counts **distinct** re-runnable artifacts.
  A `tier_mismatch` flag surfaces once, as a warning at the review-preflight seam,
  when a claim is written `high`/`medium` but is single-source. Still computed,
  never verbalized.
- **WS3 — a lightweight investigation "world model" (orientation only).** The
  non-authoritative `provenance.json:research_state` block gains bounded
  `question`, `openQuestions`, `assumptions`, and `deadEnds`, surfaced via a
  `world_model` tool and `/world-model` card. It is orientation, never
  established findings, and never gates a transition.
- **Phase-4 simplification.** A simplicity pass trimmed shipped over-surfacing
  (dropped the dead faithfulness helper and duplicate card counters), made the
  ML-specific half of the leakage rubric conditional, and kept falsification
  ranking as one guidance paragraph reusing the existing `/berdl-refute` — no new
  command, skill, or ranker.

## What makes it different

| Axis | Original Observatory | beril-pi-agent |
| --- | --- | --- |
| Primary surface | Hosted web app (Observatory UI) + chat skills | Terminal/TUI; every result is a framed **science card** — no web app |
| Trust model | Persuasive prose / AI review | **Computed, never verbalized** calibrated trust, now with a **groundedness** axis |
| Review | Prompt-based AI reviewer; `/submit` requests an AI review | **Independent read-only** reviewer + adversarial `/berdl-refute`; **disconfirmation-first** |
| Lifecycle gate | No human identity gate | One **human ORCID-bound sign-off** at `analysis → reviewed`; everything else advisory |
| Reproducibility | — | **Notebook-as-record**: the analysis notebook with its saved outputs *is* the record. **No** re-running notebooks, **no** byte/hash reproducibility metric; the canonical hash is an **integrity check only**. Submission is ORCID-gated |
| Auditability | Shared `docs/` memory + project files | `beril.yaml` (authoritative) + `provenance.json` + `TRACE.jsonl` (inspectable, non-authoritative) |
| Dependencies | Coding-agent + cloud services | **Free + keyless** by default; nothing third-party in a core path (tool access, safety gate, reproducibility) |
| Workflow | Skill menu | **Map, not a lock** advisory arc — exactly **one** human hard gate, every other nudge advisory |

## Pointers (do not duplicate)

- Design + rationale for the additions:
  [`docs/superpowers/specs/2026-06-23-coscientist-trust-hardening-design.md`](superpowers/specs/2026-06-23-coscientist-trust-hardening-design.md).
- Co-scientist field positioning (distinctive axes, blind spots, field-validated
  recommendations): the `coscientist-landscape-positioning` team memory.
