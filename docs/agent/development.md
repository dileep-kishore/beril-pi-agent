# Development and verification

Update this page when dependencies, package scripts, code-style constraints, or
test commands change.

## Before editing

1. State assumptions and identify the owning layer using
   [`architecture.md`](architecture.md).
2. Write a short plan with verifiable outcomes and obtain confirmation.
3. Inspect the focused source, its tests, and any current-state wiki page.
4. For Pi API work, verify against
   [`pi-api-reference.md`](../superpowers/specs/pi-api-reference.md) and the
   pinned dependency in `package.json`; do not design against upstream HEAD.
5. Preserve unrelated working-tree changes.

Do not edit third-party code under `node_modules`, `.venv`, or `site-packages`.
Do not introduce a dependency on the original BERIL repository.

## Toolchains

| Area | Runtime/package manager | Style/checking | Tests |
| --- | --- | --- | --- |
| TypeScript Pi package | Bun; strict ESM TypeScript | `tsc --noEmit`, Biome | Node `--test` over `test/**/*.test.ts` |
| Python CLI/substrate | Python ≥3.11 through uv | Existing Python style; type hints and focused validation | pytest over `tests/` |
| Inline BERDL scripts | `uv run` with PEP 723 dependencies | Keep standalone/import-safe boundaries | Focused Python tests and command-level checks |

Commands:

```bash
bun install
bun run typecheck
bun run lint
bun run check
bun run test

uv sync
uv run --group test pytest tests/ -q
uv run beril <subcommand>
```

Use Bun/uv rather than npm, yarn, pip, or conda unless the user explicitly
requires otherwise.

## TypeScript constraints

- Node tests use strip-only TypeScript. Do not use `enum`, namespaces,
  constructor parameter properties, or other syntax requiring runtime emit.
- Prefer pure logic in `lib/` and thin extension registration/orchestration.
- Use interfaces for object shapes and types for other aliases.
- Guard every custom `renderResult` when `context.isError` is true; Pi invokes
  renderers on failures with empty details.
- Use injectable seams already established by the codebase instead of module
  monkeypatching.
- Keep glyphs in `lib/ui/glyphs.ts`, text-presentation only, with ASCII fallback.
- Biome covers `extensions/`, `lib/`, and `test/`; it intentionally excludes
  much of the Python/resource tree.

## Python constraints

- Run Python through `uv run`.
- Keep CLI stdout machine-readable. Human/log chatter goes to stderr, and
  BERDL paths that can receive JupyterHub noise use temporary JSON files.
- `beril_cli/` is the only package included in the wheel. `scripts/` and
  `tools/` are standalone and resolved relative to the workspace root.
- Keep lifecycle enforcement centralized in the Python state machine.
- Tests touching the commons must isolate `$BERIL_COMMONS_DIR`.

## Verification by change

| Change | Minimum verification |
| --- | --- |
| Pure TS/lib or extension | Focused `node --test` files, then `bun run check` and `bun run test` |
| Python CLI/substrate | Focused pytest files, then `uv run --group test pytest tests/ -q` |
| Cross-language contract | Both full suites plus a focused command/bridge test |
| Skill/prompt/theme only | Review rendered/loaded content and relevant catalog tests; re-register locally if needed |
| Docs only | Validate links, cross-check live registries, inspect diff/status; code suites are unnecessary unless executable files changed |

Before committing or pushing, run the full checks for every language touched.
Use conventional commit messages and keep commits focused.
