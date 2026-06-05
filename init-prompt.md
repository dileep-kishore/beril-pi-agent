You are helping build a custom Pi agent package for BERIL Research Observatory. Use superpowers, parallel subagents and workflows to brainstorm the spec and design for this

Goal:
Create a separate repo/package called `beril-pi-agent` that turns BERIL into a Pi-based terminal/TUI research workbench. This is **not** a web UI project. Do not build browser UI or Observatory UI integration for MVP.

Core idea:
Keep BERIL’s existing scientific skills as the research/protocol layer. Move stateful, executable, safety-sensitive, and UI-heavy behavior into Pi extensions.

Read first:
- Pi repo/docs:
  - https://github.com/earendil-works/pi
  - https://pi.dev/docs/latest/usage
  - https://pi.dev/docs/latest/extensions
  - https://pi.dev/docs/latest/skills
  - https://pi.dev/docs/latest/packages
  - https://pi.dev/docs/latest/settings
  - https://pi.dev/docs/latest/providers
  - https://pi.dev/docs/latest/custom-provider
- BERIL repo:
  - https://github.com/kbaseincubator/BERIL-research-observatory (Use the local repo at /Users/g8k/.superset/projects/BERIL-research-observatory)
  - inspect `.claude/skills/`, especially:
    - `berdl_start`
    - `berdl`
    - `berdl-query`
    - `berdl-discover`
    - `literature-review`
    - `synthesize`
    - `berdl-review`
    - `submit`
  - inspect:
    - `.mcp.json`
    - `scripts/berdl_env.py`
    - `scripts/run_sql.py`
    - `scripts/export_sql.py`
    - `tools/review.sh`
    - `tools/notebook_hash.py`

Design rule:
- Skills = scientific judgment, research protocols, rubrics, biological interpretation, query patterns.
- Extensions = UI, commands, tools, state, permissions, execution, rendering, reproducibility.
