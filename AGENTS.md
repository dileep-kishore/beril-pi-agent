# Repository agent instructions

State that you are using this file to guide your work.

Before changing code:

1. Read [`docs/agent/README.md`](docs/agent/README.md).
2. Follow its task router and open only the relevant current-state pages.
3. Develop a short, verifiable plan and obtain confirmation before implementing.

Always:

- Keep changes surgical and avoid fixing unrelated issues.
- Preserve the self-contained boundary: never import from, depend on, or modify
  the original BERIL Research Observatory at runtime.
- Do not patch third-party code under `node_modules`, `.venv`, or
  `site-packages`; fix this repository, change a dependency pin, or pursue an
  upstream fix.
- Use Bun for JavaScript/TypeScript and uv for Python. Do not use npm, yarn,
  pip, or conda unless explicitly requested.
- Treat skills as scientific judgment, extensions as the Pi surface, and the
  bundled `beril` CLI/scripts as the execution and durable-state substrate.
- Preserve fail-closed project trust, human gates, and destructive-action
  confirmation.
- If behavior is surprising, alert the developer and add a verified note to
  [`docs/agent/gotchas.md`](docs/agent/gotchas.md).

For Pi API work, consult
[`docs/superpowers/specs/pi-api-reference.md`](docs/superpowers/specs/pi-api-reference.md)
and the pinned package version before coding. For capability placement, consult
[`docs/superpowers/specs/2026-06-06-skill-home-mapping.md`](docs/superpowers/specs/2026-06-06-skill-home-mapping.md).

Before committing or pushing, run the full checks for every language touched:

```bash
bun run check && bun run test
uv run --group test pytest tests/ -q
```
