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
- `scripts/`, `tools/` — the BERDL execution substrate the subcommands wrap (Spark/MinIO access, notebook hashing, reviewer, uploads). Invoked via `uv run` / subprocess.
- `projects/<id>/` — your research projects. Each project keeps authoritative
  lifecycle/approval state in `beril.yaml`, latest runtime/session provenance in
  `provenance.json`, and an append-only local trace in `TRACE.jsonl`.
- `docs/superpowers/` — design spec, verified Pi API reference, and implementation plan.

This repo is **self-contained**: it replaces the Claude Code / Codex skill layer of the
original BERIL Research Observatory and does not depend on that repo at runtime.

## Lifecycle

Projects move `exploration → proposed → active → analysis → reviewed → complete`
(with legal demotes), enforced by the `lifecycle_transition` tool / `beril lifecycle`.
`/research-plan` drafts the plan after `planning_preflight` (→ `proposed`);
`/analyze` scaffolds + runs the analysis notebooks with resumable execution
(→ `active`); `/paper-plan` separates the publication narrative from the
mechanical research plan; then `/synthesize → /berdl-review → /submit` carries
reproducibility hashing and an ORCID-gated approval before the irreversible
lakehouse upload. A persistent workflow HUD shows the current step and what's
next.
