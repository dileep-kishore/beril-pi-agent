# Gotchas and surprise notes

Add a note only after verifying a recurring, non-obvious behavior. Keep the
entry short, state the consequence, and point to the source of truth.

## Package and Pi runtime

- **Registration is separate from launch.** `pi install -l .` registers the
  package; `beril start` does not. Re-register after pulling extension/skill
  changes. Source: `package.json`, `beril_cli/start.py`.
- **The pinned Pi API is intentionally old/minimal.** Check `package.json` and
  the verified local Pi API reference, not upstream HEAD.
- **Failure rendering still calls `renderResult`.** On failure, details may be
  empty and `context.isError` is the reliable flag. Unguarded renderers show
  misleading `undefined` cards.
- **Node strips TypeScript rather than compiling it for tests.** Runtime-emitted
  TS features can pass `tsc` but fail under `node --test`.
- **Text glyphs only.** UI glyphs must come from `lib/ui/glyphs.ts`; no emoji or
  Nerd Font assumptions.
- **Biome does not cover the whole tree.** A passing `bun run check` says
  nothing about Python, skills, prompts, or docs.

## Execution and state

- **CLI JSON may travel through a file.** JupyterHub auto-spawn can write to
  stdout, so query/discovery wrappers use a temporary result file. Do not remove
  that indirection.
- **The catalog plane and Spark plane are distinct.** “I see tables but cannot
  query” is commonly Spark routing/connectivity, not permissions.
- **The agent cannot open SSH tunnels.** The user starts the 1337/1338 SOCKS
  tunnels; `/berdl-connect` starts pproxy afterward.
- **No manual BERDL virtual environment exists.** uv builds PEP 723
  environments on demand; references to activating `.venv-berdl` are stale.
- **TypeScript state is a UI cache.** `beril.yaml` and filesystem artifacts are
  authoritative. Never let a module-closure cache clear a gate.
- **World-model state is orientation, not findings.** Compaction must merge its
  question/open-question/assumption/dead-end fields rather than replace them;
  claims and reports hold settled results.

## Trust, hashes, and records

- **Three hash families have different meanings.** Canonical notebook hashes
  are integrity signals; raw report/review hashes prevent TOCTOU drift; commons
  and claim hashes provide content addressing. They are not interchangeable.
- **The notebook with saved outputs is the record.** BERIL does not rerun a
  notebook or compare stochastic output bytes to calculate trust.
- **Reviews may be written without promotion.** Headless/untrusted sessions can
  produce a review artifact, but only interactive human ORCID sign-off advances
  `analysis → reviewed`.
- **Coherence reads the filesystem.** A recorded verdict cannot clear missing
  or stale report/claims/provenance/trace inputs. Override is a deliberate,
  ORCID-attributed human act.
- **The commons is outside the project.** It lives under `~/.beril/agora` or
  `$BERIL_COMMONS_DIR`; tests must always redirect it to a temporary directory.
- **`errorCard` may intentionally become an infrastructure card.** The
  structured matcher is conservative by design; broad keyword matching would
  turn scientific statements into plumbing errors.

## Release and safety

- **The release pin only moves forward and follows tags.** New work on `main`
  does not reach release-channel users until a release is cut.
- **Project trust is fail-closed.** Destructive actions are blocked and the
  conduct contract is not injected when Pi marks a project untrusted. Removing
  those guards is not a valid fix.
- **Submission prerequisites run before upload.** RO-Crate generation and
  commons landing failures must stop the operation before the irreversible
  archive replacement.
