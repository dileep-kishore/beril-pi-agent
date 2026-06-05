# BERIL Pi Workbench — Project Root

This file marks the workspace root. The `beril` CLI and the bundled BERDL scripts
resolve paths (`.env`, `.venv-berdl`, `projects/<id>/`) relative to the directory
containing this file, so keep it at the repo root.

## Layout

- `extensions/`, `lib/`, `skills/`, `prompts/`, `themes/` — the Pi package (TypeScript + resources).
- `beril_cli/` — the bundled `beril` CLI (Python): launcher + `env`/`query`/`export`/`discover`/`hash`/`review`/`submit`/`lifecycle`/`lit` subcommands + the lifecycle state machine.
- `scripts/`, `tools/` — the BERDL execution substrate the subcommands wrap (Spark/MinIO access, notebook hashing, reviewer, uploads). Invoked via `uv run` / subprocess.
- `projects/<id>/` — your research projects (each with a `beril.yaml` lifecycle file). Created as you work.
- `docs/superpowers/` — design spec, verified Pi API reference, and implementation plan.

This repo is **self-contained**: it replaces the Claude Code / Codex skill layer of the
original BERIL Research Observatory and does not depend on that repo at runtime.

## Lifecycle

Projects move `exploration → proposed → active → analysis → reviewed → complete`
(with legal demotes), enforced by the `lifecycle_transition` tool / `beril lifecycle`.
The `/synthesize → /berdl-review → /submit` flow carries reproducibility hashing and an
ORCID-gated approval before the irreversible lakehouse upload.
