# Runtime and operations

Update this page when setup, launch, package registration, release channels,
BERDL connectivity, notebook execution, or submission transport changes.

## One-time setup and launch

```bash
uv sync
bun install
pi install -l .
uv run beril setup
uv run beril start
```

`pi install -l .` registers this package's extensions, skills, prompts, and
themes. It is the frequently missed step. `beril start` refreshes credentials,
applies the selected update policy, and execs the already-installed Pi package;
it does not install it. Confirm registration with `pi list` and re-run the local
install after pulling extension/skill changes.

The workspace root is discovered through `PROJECT.md`. Keep that marker at the
repository root.

## Session and release behavior

`beril start` launches Pi only. It starts a fresh session unless explicit Pi
session flags request resume/continue behavior. Project sessions are named with
project and phase where possible.

`beril start --provider cborg` provisions the CBORG (LBL LiteLLM gateway)
custom provider into Pi's `models.json` (`beril_cli/model_provider.py`),
exports `BERIL_MODEL_PROVIDER` plus per-role model defaults
(`BERIL_MAIN_MODEL`, `BERIL_FAST_MODEL`, `BERIL_REVIEW_MODEL`,
`BERIL_VISION_MODEL`), and appends `--provider cborg --model lbl/cborg-coder`
to Pi's argv (Pi ignores `--provider` without `--model`). Any other
`--provider` value passes through to Pi unchanged. Extensions resolve
role-specific models through `lib/model-roles.ts`; see the README "Model
provider" section for usage and the CBORG IP-allowlist gotcha.

Release behavior is forward-only:

- Default: move to a newer published release tag only when behind; never
  downgrade or clobber feature branches.
- `BERIL_UPDATE_CHANNEL=main`: fast-forward to `origin/main` when possible.
- `--version vX.Y.Z`: explicit version wins.

The release channel follows tags, not arbitrary `main` commits.

## BERDL connectivity

On the BERDL JupyterHub, access is direct. Off-cluster, the user must start two
SSH SOCKS tunnels (`-D 1337` and `-D 1338`). The agent cannot open SSH tunnels.
After they exist, `/berdl-connect` can start the local pproxy listener on 8123.

Use these surfaces rather than guessing:

- `/berdl-status` or `berdl_env_check`: readiness and next steps.
- `berdl_discover`: catalog/table visibility.
- `berdl_query`: actual Spark Connect execution.

Seeing catalog tables does not prove Spark execution works. The REST catalog and
per-user Spark Connect planes are separate; query failure with successful
discovery often means the session is routed to the wrong/foreign Spark cluster,
not missing grants.

## uv-managed execution

BERDL Spark and notebook scripts declare dependencies inline and run with
`uv run`. There is no `.venv-berdl`, activation step, or bootstrap environment.
The first query/notebook may be slow while uv builds and caches its environment.

Notebook scaffolding creates numbered notebooks, `notebooks/util.py`, and
`data/cache/`. Runs save outputs and BERIL execution metadata in place.
Resume-aware execution skips notebooks whose previous BERIL metadata records a
successful run; it does not rerun them as a trust metric.

## Failure classification

- Connectivity and permission failures receive distinct BERDL guidance from
  `lib/beril-exec.ts`.
- `lib/syserror.ts` recognizes only structured rate-limit, auth, billing,
  overload, and connectivity signals. Infrastructure failures render as neutral
  infrastructure cards, never scientific conclusions.
- Keep the classifier conservative: ordinary scientific prose containing words
  such as “rate,” “credit,” or “429” must not be reclassified.

## Irreversible operations

`berdl_export`, `lakehouse_submit`, destructive bash commands, and bash touching
sensitive credential paths are gated centrally. They are blocked in untrusted
projects and non-interactive modes; trusted TUI sessions require explicit
confirmation. `/submit` also has its own command-path confirmation because the
central hook only covers model tool calls.

For lifecycle and submission semantics, read
[`lifecycle-and-trust.md`](lifecycle-and-trust.md).
