# beril-pi-agent

A [Pi](https://github.com/earendil-works/pi) package that turns the **BERIL Research Observatory** into a terminal/TUI research workbench.

BERIL's scientific judgment (query patterns, research protocols, rubrics, biological interpretation) stays as Pi **skills**; connection, execution, state, safety, and rendering live in five thin Pi **extensions** that shell out to a **bundled `beril` CLI** (in `beril_cli/` + `scripts/` + `tools/`). The proven Python keeps the logic and reproducibility; the package owns the Pi surface.

> **Self-contained.** This repo replaces the Claude Code / Codex skill layer of the original BERIL Research Observatory and bundles its own BERDL execution substrate — it does **not** depend on that repo at runtime. It is also a terminal workbench: no web app / Observatory UI.

## What you get

A research co-scientist where the **science is the foreground**. It carries you
through the whole arc — **explore the data → review the literature → write a
research plan → generate + run analysis notebooks → synthesize a report → review
→ submit** — keeping the science legible and reserving your attention for
direction, not commands.

**The research arc** (commands): `/berdl-start` (orient + data-forward
feasibility) → `/literature-review <topic>` → `/research-plan <project>` →
`/analyze <project>` (scaffold + run notebooks) → `/synthesize <project>` →
`/berdl-review <project>` → `/submit <project>`.

**Visual workflow**
- **Science cards.** Every tool result renders as a titled, framed card — a data
  table, a literature list, a table preview, a research plan, a checkpoint — with
  the command itself reduced to a dimmed one-liner (`lib/ui`).
- **Workflow HUD.** A persistent panel above the editor shows the active project,
  the connection, where you are in `explore → plan → analyze → review → submit`,
  and the single most useful next action.
- **Quiet plumbing.** Routine bash/file output is collapsed by default (expand on
  demand); the conduct contract tells the agent to lead with the artifact, not
  the command.
- **Checkpoints.** At natural seams (after the plan, after the first result) the
  agent uses `request_checkpoint` to ask you to steer — approval is for *science
  direction* and *irreversible ops*, never routine commands.

**Extensions** (`extensions/`)
- `beril-env` — connection lifecycle (`berdl_env_check`, `/berdl-connect`,
  `/berdl-status`) and the workflow HUD widget + footer connection indicator.
- `beril-data` — `berdl_query` (bounded read-only SQL), `berdl_discover`,
  `berdl_peek` (one-shot table preview), `berdl_export` (destructive, gated),
  each rendered as a card.
- `beril-analysis` — `notebook_scaffold` / `notebook_run` / `notebook_list`
  tools and `/analyze` (the plan → executed-notebooks link).
- `beril-plan` — `/research-plan` and the `research_plan` plan-card tool.
- `beril-governance` — lifecycle + reproducibility (`notebook_hash`,
  `lifecycle_transition`, `beril_user`, `lakehouse_submit`) and
  `/synthesize` → `/berdl-review` → `/submit`.
- `beril-literature` — `lit_search` / `lit_fetch` and `/literature-review`.
- `beril-checkpoint` — the `request_checkpoint` decision tool.
- `beril-conduct` / `beril-display` — the always-on research-conduct contract
  and the de-emphasis defaults.
- `beril-safety` — the central destructive-action gate (`berdl_export`,
  `lakehouse_submit`, `mc rm`/`rm -rf`): confirms in interactive mode, **blocks**
  headless.

**Skills** (`skills/`) — Pi-optimized scientific judgment: `berdl-query`,
`berdl-discover`, `research-plan`, `analysis-notebooks`, `synthesize`,
`berdl-review`, `submit`, `literature-review`, `suggest-research`,
`pitfall-capture`, `berdl-minio`. Invoke as `/skill:<name>` or let the model use
them.

**Prompts** (`prompts/`) — `/berdl-start` onboarding. **Themes** (`themes/`) — `beril`.

> Where each capability lives (skill vs extension vs sub-agent vs command),
> including the unmigrated cloud skills, is recorded in
> `docs/superpowers/specs/2026-06-06-skill-home-mapping.md`.

## Requirements

- [Pi](https://pi.dev) `@earendil-works/pi-coding-agent` (verified against **0.78.1**).
- Python ≥ 3.11 and [`uv`](https://docs.astral.sh/uv/) (the bundled `beril` CLI ships in this repo).
- A KBase account + `KBASE_AUTH_TOKEN` (from <https://narrative.kbase.us/#auth2/account>) in a `.env` at the repo root.
- Optional: `NCBI_API_KEY` (and `NCBI_EMAIL`) in `.env` to lift the PubMed rate limit from ~3 to ~10 req/s — useful when the co-scientist fans out many `lit_search` calls. Get a key at <https://www.ncbi.nlm.nih.gov/account/settings/>.

## Install

```bash
git clone git@github.com:dileep-kishore/beril-pi-agent && cd beril-pi-agent

# 1) the bundled beril CLI (Python execution substrate)
uv sync                  # or: uv pip install -e .   (provides the `beril` command)

# 2) the Pi package (extensions/skills/prompts/themes)
bun install
pi install -l .          # project-local; or `pi install git:…` for a remote checkout
```

`pi list` shows the package; its five extensions load at session start. This repo **is** your
workspace (`PROJECT.md` marks the root; research projects live under `projects/<id>/`).

## Launch

From the repo root:

```bash
uv run beril start --agent pi      # or just `beril start --agent pi` if the CLI is on PATH
```

This is the seamless one-command launch: `beril start` refreshes your KBase
token in `.env`, execs `pi` with this package and the bundled `beril` already on
PATH (so the extensions resolve it — **no manual `source .venv/bin/activate`**),
and hands off onboarding/status to the `beril-env` extension (run `/berdl-start`
any time to re-orient).

It **stays on your current branch/commit** — the release pin only ever moves
*forward* (it checks out a newer published release only when you're behind one,
never downgrades newer work). Pass `--version vX.Y.Z` to pin to a specific
release explicitly.

### Connecting to BERDL (off-cluster)

On a laptop, BERDL is reached through an SSH-tunnel + proxy stack that **you** start (the agent cannot open SSH tunnels):

1. `KBASE_AUTH_TOKEN` in the repo `.env`.
2. Two SSH SOCKS tunnels: `ssh -f -N -o ServerAliveInterval=60 -D 1337 ac.<user>@login1.berkeley.kbase.us` and the same for `-D 1338`.
3. `pproxy` on `:8123` — `/berdl-connect` will start it for you once the tunnels are up.

Run `/berdl-status` to confirm; the footer widget shows `BERDL off-cluster ✓ ready` when set. On the BERDL JupyterHub (on-cluster) access is direct and only the token is needed.

The BERDL execution scripts (Spark query/export/discover) and the analysis
notebooks declare their dependencies inline (PEP 723) and run under `uv run`, so
`uv` builds and caches their environments on first use. There is **no manual venv
to create or activate** — no `.venv-berdl`, no bootstrap step. The first Spark
query just takes a little longer while `uv` builds the PySpark env once.

## Model provider

beril uses **whatever model your `pi` is configured with** — your existing
provider/subscription drives the co-scientist (e.g. an OpenAI/Codex or Google
default). **No Anthropic key is required.** The one exception is the independent
`/berdl-review` subagent: it *prefers* Anthropic Opus 4.8 for a strong,
separate-from-the-author read, but **falls back to your session model
automatically** when no Anthropic auth is present, and is overridable per call
(`/berdl-review <project> --model <id>`).

To route to an org/Vertex/vLLM endpoint, use a `models.json` (Pi does not use
BERIL's `CLAUDE_CODE_USE_VERTEX` env). Example for an Anthropic-compatible gateway:

```json
{
  "providers": {
    "beril-gateway": {
      "baseUrl": "https://<your-gateway>/v1",
      "api": "anthropic-messages",
      "apiKey": "$BERIL_GATEWAY_KEY",
      "models": [{ "id": "claude-opus-4-7", "reasoning": true, "input": ["text", "image"] }]
    }
  }
}
```

For true Vertex, use ADC (`gcloud auth application-default login` + `GOOGLE_CLOUD_PROJECT`/`GOOGLE_CLOUD_LOCATION`).

## Safety & isolation

Pi runs extensions with **full system access** and has no built-in sandbox. This package adds a central confirmation gate for destructive operations, but for untrusted automation run Pi inside isolation:

- **Docker** — mount the BERIL repo, run `pi` in the container.
- **OpenShell / Gondolin** — route tools through a local micro-VM.

Destructive tools (`berdl_export` overwrite, `lakehouse_submit`'s `mc rm --recursive --force`) always prompt in interactive mode and are **blocked** in `--print`/`--mode json`/`--mode rpc`.

## Development

```bash
# TypeScript (Pi package)
bun install
bun run check     # tsc --noEmit + biome
bun run test      # node --test (TypeScript, strip-only — no parameter properties / enums)

# Python (bundled beril CLI)
uv run --group test pytest tests/ -q
```

Architecture, the verified Pi API reference, and the implementation plan live under `docs/superpowers/`.
