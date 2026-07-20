# Agent reference

This is the canonical, task-routed reference for working on `beril-pi-agent`.
Read this page first, then open only the pages relevant to the task.

## Read by task

| Task | Read |
| --- | --- |
| Change package boundaries, data flow, or state ownership | [`architecture.md`](architecture.md) |
| Add or change a tool, command, skill, extension, hook, or renderer | [`architecture.md`](architecture.md), then [`capability-map.md`](capability-map.md) |
| Change lifecycle, claims, review, gates, approval, provenance, commons, or submission | [`lifecycle-and-trust.md`](lifecycle-and-trust.md) |
| Change the Python CLI, BERDL scripts, notebooks, or data access | [`architecture.md`](architecture.md), then [`operations.md`](operations.md) |
| Set up, test, lint, debug, or prepare a change | [`development.md`](development.md) |
| Diagnose launch, registration, connection, release, or environment behavior | [`operations.md`](operations.md), then [`gotchas.md`](gotchas.md) |
| Understand why current trust/UX behavior exists | [`decisions.md`](decisions.md) |
| Something surprising happened | [`gotchas.md`](gotchas.md); add a concise note if it is new and verified |

For Pi APIs, also consult the locally verified
[`pi-api-reference.md`](../superpowers/specs/pi-api-reference.md) before coding.
For deciding whether behavior belongs in a skill, extension, command, or
subagent, consult the
[`skill-home mapping`](../superpowers/specs/2026-06-06-skill-home-mapping.md).

## Non-negotiable invariants

- Develop a plan and obtain confirmation before writing code.
- Keep changes surgical. Do not fix unrelated issues.
- The repository is self-contained. Never add a runtime import, dependency, or
  mutation against the original BERIL Research Observatory.
- Skills own scientific judgment. Extensions own the Pi surface. The bundled
  `beril` CLI and standalone scripts own execution and durable lifecycle logic.
- The human is the verifier of record. Destructive actions and human gates must
  remain explicit, attributed, and fail-closed.
- Use Bun for JavaScript/TypeScript and uv for Python. Do not patch
  `node_modules`, `.venv`, or `site-packages`.
- Keep new core paths free and keyless by default; optional credentials may
  raise limits but must not be required for core operation.

## Authority and precedence

Use these sources in order:

1. Executable registries and state machines: `package.json`,
   `extensions/*.ts`, `lib/capabilities.ts`, `lib/gates.ts`,
   `beril_cli/cli.py`, and `beril_cli/lifecycle.py`/`lifecycle_cmd.py`.
2. This `docs/agent/` wiki for current architecture, operating rules, and
   cross-file context.
3. Skills for scientific protocols and judgment.
4. Dated files under `docs/superpowers/` for rationale and historical plans.

If code and this wiki disagree, verify the behavior with tests, correct the
wiki in the same change, and record a gotcha when the mismatch could recur.

## Maintenance contract

Avoid duplicating implementation details across pages. Put a fact on the page
that owns it and link there from other pages.

| Changed area | Review these docs |
| --- | --- |
| `extensions/`, `skills/`, `lib/capabilities.ts` | `capability-map.md` |
| `lib/gates.ts`, `lib/science.ts`, `lib/claim-state.ts`, lifecycle/governance/review code | `lifecycle-and-trust.md`, `decisions.md` |
| `beril_cli/`, `scripts/`, `tools/` | `architecture.md`, `operations.md` |
| `package.json`, `pyproject.toml`, `biome.json`, test commands | `development.md` |
| launch, trust, connection, release, rendering, hashing behavior | `gotchas.md`, `operations.md` |
| a major merged design change | `decisions.md`; keep the dated source record in `docs/superpowers/` |
