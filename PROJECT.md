# BERIL Pi Workbench — Project Root

This file marks the workspace root. The `beril` CLI and the bundled BERDL scripts
resolve paths (`.env`, `projects/<id>/`) relative to the directory containing
this file, so keep it at the repo root. The BERDL scripts and notebooks declare
their dependencies inline (PEP 723) and run under `uv run`, so `uv` manages and
caches their environments automatically — there is no manual venv to create or
activate.

## Layout

- `extensions/`, `lib/`, `skills/`, `prompts/`, `themes/` — the Pi package (TypeScript + resources).
- `beril_cli/` — the bundled `beril` CLI (Python): the launcher, the BERDL/lifecycle/governance subcommands (see `beril --help`), and the lifecycle state machine.
- `scripts/`, `tools/` — the BERDL execution substrate the subcommands wrap (Spark/MinIO access, notebook execution and integrity hashing, uploads). Invoked via `uv run` / subprocess.
- `projects/<id>/` — your research projects. Each project keeps authoritative
  lifecycle/approval state in `beril.yaml`, latest runtime/session provenance in
  `provenance.json`, and an append-only local trace in `TRACE.jsonl`.
- `docs/agent/` — maintained current-state architecture and implementation reference.
- `docs/superpowers/` — dated design specs, the verified Pi API reference, plans, and reviews.

This repo is **self-contained**: it replaces the Claude Code / Codex skill layer of the
original BERIL Research Observatory and does not depend on that repo at runtime.

## Lifecycle

Projects move `exploration → proposed → active → analysis → reviewed → complete`
(with legal demotes), enforced by the `lifecycle_transition` tool / `beril lifecycle`.
`/research-plan` drafts the plan after `planning_preflight` (→ `proposed`);
`/analyze` scaffolds + runs the analysis notebooks with resumable execution
(→ `active`); `/paper-plan` separates the publication narrative from the
mechanical research plan; then `/synthesize → /berdl-review → /submit` carries
claim/evidence checks, integrity and review-currency validation, a human
ORCID-gated approval, RO-Crate generation, and commons landing before the
irreversible lakehouse upload. This is a map, not a lock: users can branch into data,
literature, ideas, or audit work whenever useful. A persistent workflow HUD shows
the current step, a suggested move, available actions, and an exploration escape
hatch.
