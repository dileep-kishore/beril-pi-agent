# beril-pi-agent

A [Pi](https://github.com/earendil-works/pi) package that turns the **BERIL Research Observatory** into a terminal/TUI research workbench.

BERIL's scientific judgment (query patterns, research protocols, rubrics, biological interpretation) stays as Pi **skills**; connection, execution, state, safety, and rendering live in five thin Pi **extensions** that shell out to a **bundled `beril` CLI** (in `beril_cli/` + `scripts/` + `tools/`). The proven Python keeps the logic and reproducibility; the package owns the Pi surface.

> **Self-contained.** This repo replaces the Claude Code / Codex skill layer of the original BERIL Research Observatory and bundles its own BERDL execution substrate — it does **not** depend on that repo at runtime. It is also a terminal workbench: no web app / Observatory UI.

## What you get

**Extensions** (`extensions/`)
- `beril-env` — connection lifecycle: `berdl_env_check` tool, `/berdl-connect` & `/berdl-status` commands, and a session status widget (on/off-cluster, ready/not-ready).
- `beril-data` — `berdl_query` (bounded read-only SQL, default `LIMIT 100`), `berdl_discover` (access-aware introspection), `berdl_export` (write to MinIO — destructive, gated).
- `beril-governance` — the lifecycle state machine + reproducibility: `notebook_hash`, `lifecycle_transition`, `beril_user` (ORCID), `lakehouse_submit` tools, and the `/synthesize` → `/berdl-review` → `/submit` commands.
- `beril-literature` — `lit_search` / `lit_fetch` tools and `/literature-review <topic>` (sub-agent query expansion → search → dedupe → `references.md`).
- `beril-safety` — a central destructive-action gate: every irreversible tool call (`berdl_export`, `lakehouse_submit`, `mc rm`/`rm -rf` via bash) requires confirmation, and is **blocked** in non-interactive sessions.

**Skills** (`skills/`) — Pi-optimized scientific judgment: `berdl-query`, `berdl-discover`, `synthesize`, `berdl-review`, `submit`, `literature-review`, `suggest-research`, `pitfall-capture`. Invoke directly as `/skill:<name>` or let the model use them.

**Prompts** (`prompts/`) — `/berdl-start` onboarding. **Themes** (`themes/`) — `beril`.

## Requirements

- [Pi](https://pi.dev) `@earendil-works/pi-coding-agent` (verified against **0.78.1**).
- Python ≥ 3.11 and [`uv`](https://docs.astral.sh/uv/) (the bundled `beril` CLI ships in this repo).
- A KBase account + `KBASE_AUTH_TOKEN` (from <https://narrative.kbase.us/#auth2/account>) in a `.env` at the repo root.

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

`beril start` pins a release tag, refreshes your KBase token, ensures the model provider, and execs `pi` with this package. Onboarding/status is handled by the `beril-env` extension (no prompt injection) — run `/berdl-start` any time to re-orient.

### Connecting to BERDL (off-cluster)

On a laptop, BERDL is reached through an SSH-tunnel + proxy stack that **you** start (the agent cannot open SSH tunnels):

1. `KBASE_AUTH_TOKEN` in the repo `.env`.
2. Two SSH SOCKS tunnels: `ssh -f -N -o ServerAliveInterval=60 -D 1337 ac.<user>@login1.berkeley.kbase.us` and the same for `-D 1338`.
3. `pproxy` on `:8123` — `/berdl-connect` will start it for you once the tunnels are up.

Run `/berdl-status` to confirm; the footer widget shows `BERDL off-cluster ✓ ready` when set. On the BERDL JupyterHub (on-cluster) access is direct and only the token is needed.

## Model provider

Route to your org/Vertex/vLLM endpoint with a `models.json` (Pi does not use BERIL's `CLAUDE_CODE_USE_VERTEX` env). Example for an Anthropic-compatible gateway:

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
