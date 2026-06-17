# beril-pi-agent

A [Pi](https://github.com/earendil-works/pi) package that turns the **BERIL Research Observatory** into a terminal/TUI research workbench.

BERIL's scientific judgment (query patterns, research protocols, rubrics, biological interpretation) stays as Pi **skills**; connection, execution, state, safety, and rendering live in thin Pi **extensions** (one concern each, see `extensions/`) that shell out to a **bundled `beril` CLI** (in `beril_cli/` + `scripts/` + `tools/`). The proven Python keeps the logic and reproducibility; the package owns the Pi surface.

> **Self-contained.** This repo replaces the Claude Code / Codex skill layer of the original BERIL Research Observatory and bundles its own BERDL execution substrate — it does **not** depend on that repo at runtime. It is also a terminal workbench: no web app / Observatory UI.

## What you get

A research co-scientist where the **science is the foreground**. It carries you
through the whole arc — **explore the data → review the literature → write a
research plan → generate + run analysis notebooks → synthesize a report → review
→ submit** — keeping the science legible and reserving your attention for
direction, not commands.

**The research arc** (commands): `/berdl-start` (orient + data-forward
feasibility) → `/literature-review <topic>` → `/research-plan <project>` →
`/analyze <project> --first-result` (run one discriminating result) →
`/analyze <project> --continue` → `/synthesize <project>` →
`/berdl-refute <project>` → `/berdl-review <project>` → `/submit <project>`.
Run `/skills` or `/capabilities` whenever you are unsure which route fits the
current scientific question.

**Visual workflow**
- **Science cards.** Every tool result renders as a titled, framed card — a data
  table, a literature list, a table preview, a research plan, a checkpoint — with
  the command itself reduced to a dimmed one-liner (`lib/ui`).
- **Workflow HUD.** A persistent panel above the editor shows the active project,
  the connection, where you are in `explore → plan → analyze → review → submit`,
  and concrete actions that are available from that step.
- **Capability routing.** `/skills`, `/capabilities`, and the `Ctrl+Shift+K`
  palette group skills, commands, and tools by scientific intent; plain-language
  prompts also get a lightweight route nudge when there is an obvious BERIL path.
- **Quiet plumbing.** Routine bash/file output is collapsed by default (expand on
  demand); the conduct contract tells the agent to lead with the artifact, not
  the command.
- **Checkpoints.** At natural seams (after the plan, after the first result) the
  agent uses `request_checkpoint` to ask you to steer — approval is for *science
  direction* and *irreversible ops*, never routine commands.
- **Reroll seams.** `/bookmark-science`, `/back-to-plan`, and
  `/reroll-analysis-from <label>` label scientific branch points so a researcher
  can return to a plan or first-result checkpoint instead of manually hunting the
  session tree.

**Extensions** (`extensions/`)
- `beril-env` — connection lifecycle (`berdl_env_check`, `/berdl-connect`,
  `/berdl-status`) and the workflow HUD widget + footer connection indicator.
- `beril-data` — `berdl_query` (bounded read-only SQL), `berdl_discover`,
  `berdl_peek` (one-shot table preview), `berdl_feasibility`, `berdl_export`
  (destructive, gated), data-result hints, each rendered as a card.
- `beril-analysis` — `notebook_scaffold` / `notebook_run` / `notebook_list`
  tools and `/analyze` (split into `--first-result` and `--continue`).
- `beril-capabilities` — `/skills`, `/capabilities`, the capability palette,
  and route nudges that map plain-language scientific intent to the right skill.
- `beril-plan` — `/research-plan` and the `research_plan` plan-card tool.
- `beril-governance` — lifecycle + reproducibility (`notebook_hash`,
  `claim_state`, `lifecycle_transition`, `beril_user`, `lakehouse_submit`) and
  `/synthesize` → `/berdl-review` → `/submit`.
- `beril-literature` — literature tools (PubMed + Europe PMC, free/keyless) and
  `/literature-review`, with `--project <id>` for project-scoped references.
- `beril-ideas` — `science_memory`, `/science-memory`, and `/idea-tournament`
  for using approved discoveries as priors for better next studies.
- `beril-reroll` — science bookmarks and session forks for plan/result rerolls.
- `beril-web` — read-only `web_read` (open web) and `docs_lookup` (current
  library docs); both keyless, and web/docs evidence stays low-tier.
- `beril-checkpoint` — the `request_checkpoint` decision tool.
- `beril-review` — `/berdl-review` and `/berdl-refute`, the independent
  review family including the adversarial red-team pass.
- `beril-conduct` / `beril-display` — the always-on research-conduct contract
  and display policy: collapsed routine tools plus quiet bash rendering.
- `beril-safety` — the central destructive-action gate (`berdl_export`,
  `lakehouse_submit`, `mc rm`/`rm -rf`): confirms in interactive mode, **blocks**
  headless.

**Skills** (`skills/`) — Pi-optimized scientific judgment: `berdl-query`,
`berdl-discover`, `research-plan`, `analysis-notebooks`, `synthesize`,
`berdl-review`, `submit`, `literature-review`, `suggest-research`,
`pitfall-capture`, `berdl-minio`. Invoke as `/skill:<name>` or let the model use
them.

**Prompts** (`prompts/`) — `/berdl-start` onboarding. **Themes** (`themes/`) — `beril` (BERIL branding) and `phenix` (PHENIX branding). BERDL labels are reserved for the connection/data-access layer.

> Where each capability lives (skill vs extension vs sub-agent vs command),
> including the unmigrated cloud skills, is recorded in
> `docs/superpowers/specs/2026-06-06-skill-home-mapping.md`.

## Requirements

- [Pi](https://pi.dev) `@earendil-works/pi-coding-agent` (pinned in `package.json`).
- Python ≥ 3.11 and [`uv`](https://docs.astral.sh/uv/) (the bundled `beril` CLI ships in this repo).
- A KBase account + `KBASE_AUTH_TOKEN` (from <https://narrative.kbase.us/#auth2/account>) in a `.env` at the repo root.
- **No API keys are required** for literature or web/docs — PubMed + Europe PMC and the docs lookup all work keyless by default. Optional keys only raise rate limits: `NCBI_API_KEY` (and `NCBI_EMAIL`) for PubMed (<https://www.ncbi.nlm.nih.gov/account/settings/>), `CONTEXT7_API_KEY` for `docs_lookup`.

## Setup

Three one-time steps, then launch — all from the repo root.

```bash
# Prerequisites: uv, bun, a coding agent on PATH (pi — install per https://pi.dev), and a KBase token.
git clone git@github.com:dileep-kishore/beril-pi-agent && cd beril-pi-agent

# 1) the bundled `beril` CLI (Python execution substrate)
uv sync                       # provides the `beril` command

# 2) register the Pi package with Pi — extensions, skills, prompts, theme  (ONE-TIME)
bun install
pi install -l .               # re-run ONLY after you pull changes under extensions/

# 3) credentials + identity (writes .env + ~/.config/beril/config.toml)
uv run beril setup            # or just put KBASE_AUTH_TOKEN=… in a .env at the repo root
```

> **`pi install -l .` is the step people miss.** It registers the extensions/skills with Pi and
> is required **once** before you launch. `beril start` does **not** install them — it refreshes
> your token and execs your agent, which then loads the *already-installed* package. Confirm with
> `pi list` (you should see `beril`). Re-run `pi install -l .` only when the package's
> extensions/skills change (e.g. after a `git pull`).

This repo **is** your workspace (`PROJECT.md` marks the root; research projects live under `projects/<id>/`).

## Launch

From the repo root:

```bash
uv run beril start            # always launches Pi (beril is a Pi workbench)
uv run beril start --theme phenix  # switch the project-local Pi theme/brand
```

`beril start` refreshes your KBase token in `.env`, then execs **Pi** with this package and the
bundled `beril` already on PATH (so the extensions resolve it — **no manual
`source .venv/bin/activate`**), and hands off onboarding to the `beril-env` extension (run
`/berdl-start` any time to re-orient). It starts a **fresh Pi session by default** so stale
project state does not leak into new work; pass an explicit Pi session flag (`--continue`,
`--resume`, `--session …`, or `--no-session`) when you want to restore or control a thread.
`beril start` also enables Pi's quiet startup for this project so the generic
context/skills/extensions inventory stays hidden and the BERIL science/workflow welcome is the
first surface. Resumed project sessions are named `<project> · <phase>` so the picker stays legible. beril is a
**Pi workbench**: `beril start` always launches
`pi` (a stale config can't redirect it). Other agents like Claude/Codex are still used *inside*
skills and subagents — e.g. the `/berdl-review` Opus reviewer — but never as the launcher.

It **stays on your current branch/commit** — the release pin only ever moves *forward* (it checks
out a newer **published release** only when you're *strictly behind* one, never downgrades newer
work). Pass `--version vX.Y.Z` to pin explicitly. Note: the pin tracks the latest **release tag**,
not `main` — so to ship new work to other machines, cut a new release.

**Track `main` instead of releases.** Set `BERIL_UPDATE_CHANNEL=main` in `.env` and `beril start`
fast-forwards to the latest `origin/main` on launch instead of pinning a release — handy while
iterating before a release is cut. Unset (or `release`) keeps the release pin; an explicit
`--version` still wins. It only ever *fast-forwards*, so local commits are never clobbered.

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

Destructive tools (`berdl_export` overwrite, `lakehouse_submit`'s `mc rm --recursive --force`, and bash touching sensitive paths like `.env`/`~/.ssh`/keys) always prompt in interactive mode and are **blocked** in `--print`/`--mode json`/`--mode rpc`. The gate is **fail-closed under Pi project trust**: in an untrusted project every destructive action is blocked outright.

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
