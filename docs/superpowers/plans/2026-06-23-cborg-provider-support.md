# CBORG Provider Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let BERIL launch Pi against CBORG with `beril start --provider cborg`, while keeping the current Pi-configured provider behavior as the default.

**Architecture:** Treat CBORG as an OpenAI-compatible LiteLLM proxy and provision it as a Pi custom provider before Pi model resolution. Keep provider switching in the Python launcher, keep model-role selection in small TypeScript helpers used by BERIL extensions, and avoid changing scientific workflow behavior beyond model selection.

**Tech Stack:** Python 3.11 CLI with `uv`/pytest; TypeScript ESM Pi extensions with Bun, `node:test`, and the pinned `@earendil-works/pi-coding-agent@0.79.1`; Pi custom models via `~/.pi/agent/models.json`.

---

## Research Summary

CBORG API facts verified on 2026-06-23:

- API base: `https://api.cborg.lbl.gov`; LBL-network direct route: `https://api-local.cborg.lbl.gov`.
- The API is a token-authenticated LiteLLM proxy. It supports OpenAI Chat Completions, OpenAI Responses, Anthropic, and Gemini surfaces.
- `/openapi.json` reports LiteLLM API `1.89.3` and exposes `/chat/completions`, `/v1/chat/completions`, `/model/info`, `/v1/model/info`, `/models`, and `/v1/models`.
- `/v1/models` returns `401` without a key. CBORG docs recommend authenticated `/model/info` for live model discovery.
- Auth works with OpenAI-style bearer keys; the OpenAPI security scheme also names `x-litellm-api-key`. Pi should send both.
- CBORG recommends `lbl/cborg-*` aliases for on-prem models because aliases can move to newer backing models without client config changes.
- On-prem aliases relevant to BERIL:
  - `lbl/cborg-coder`: highest quality reasoning with low latency; best default for agentic coding/research workflow.
  - `lbl/cborg-coder-fast`: lower-latency coding default.
  - `lbl/cborg-deepthought`: complex analytical tasks; best review/refutation default.
  - `lbl/cborg-mini`: lightweight small-context tasks.
  - `lbl/cborg-chat`: interactive chat.
  - `lbl/cborg-vision`: vision plus reasoning.
- CBORG asks clients to limit on-prem workloads to 5 parallel requests and to back off on `429`/maintenance errors.

Current BERIL facts:

- `beril start` always execs `pi` and currently forwards unknown args to Pi via `parse_known_args` (`beril_cli/cli.py:200`, `run_start` at `beril_cli/start.py:334`).
- The README currently tells users to configure custom provider routing through Pi `models.json`; no BERIL helper provisions it.
- Pi supports custom providers in `~/.pi/agent/models.json`, and project settings support `defaultProvider`, `defaultModel`, `defaultThinkingLevel`, and `enabledModels`.
- `/berdl-review` currently resolves explicit overrides with `getModel("anthropic", modelOverride)` (`lib/review-agent.ts:103`), so CBORG review aliases cannot be selected directly yet.
- Literature expansion and stance assessment prefer `ctx.model`, but their no-session fallback is hardcoded to Anthropic Sonnet (`extensions/beril-literature.ts:22,72,184`).

## Audit Update (2026-07-20)

The plan was re-audited against the current codebase, the installed Pi 0.79.1 package source, and the live CBORG API before implementation. Verified corrections, folded into the tasks below:

- **`--provider` alone is inert in Pi 0.79.1.** Pi only consumes `--provider` together with `--model` (`dist/main.js:268-272`). Appending a default `--model` for CBORG is load-bearing, not cosmetic. Consequently the default model is appended whenever the user did not pass `--model` — a user-supplied `--models` (plural, cycling scope) no longer suppresses it, because `--models` patterns match only auth-configured models and would leave `--provider` ignored.
- **Once argparse owns `--provider`, it is consumed from `remaining`** (`cli.py:200`), so `run_start` must explicitly re-append `--provider <name>` to the Pi argv for **every** provider value, not just cborg.
- **models.json validation is all-or-nothing.** A non-built-in provider with `models[]` requires `baseUrl`, `apiKey`, and `api`, or Pi drops **all** custom providers in the file with only a loadError (`model-registry.js:440-455`). Pi also accepts JSONC comments in models.json (`stripJsonComments`), which stdlib `json.load` rejects. The BERIL merge must therefore fail safe: on unreadable/unparseable/non-dict content, warn and leave the file untouched (never clobber), and always write a complete cborg entry.
- **models.json lives at `$PI_CODING_AGENT_DIR/models.json`** (env override) falling back to `~/.pi/agent/models.json` (`config.js:393-399`). Honoring `PI_CODING_AGENT_DIR` gives tests clean isolation.
- **`pi-ai`'s `getModel` only knows built-in models** — custom CBORG models can never resolve through `getModel("anthropic", ...)`-style calls (`pi-ai/dist/models.js:11-14`). Registry-based resolution (`ctx.modelRegistry.find`/`getAll`) is required, not stylistic. Pi's own `findExactModelReferenceMatch` implements the first-slash/ambiguity semantics but is not exported, so the bespoke helper is justified.
- **Missing `CBORG_API_KEY` does not fail launch** (confirmed): `--model` resolves via `getAll()` regardless of auth; the error surfaces on the first request. `--list-models` also works without auth.
- **The Task 4 concurrency cap `min(panel.length, 5)` is a no-op today** — the default panel is 4 specialists and default concurrency is already `panel.length`. Kept only as a one-line future-proof cap for custom panels > 5.
- **Task 5 intentionally reverses precedence:** today `ctx.model` wins whenever a session model exists; after this change a resolved role env/provider-profile model wins over `ctx.model` (otherwise CBORG sessions would never route expansion to `cborg-mini`). Nothing-resolves still falls back to `ctx.model`.
- **Existing test seams must survive:** review/literature tests stub `modelRegistry` as `{ getApiKeyAndHeaders }` only and inject a `getModel`/`__completer` seam; the helper must tolerate registries without `find`/`getAll` (optional-call), auth checks stay on `getApiKeyAndHeaders`, and role-env tests must save/restore `process.env` (node --test shares one process per file).
- **Live CBORG validation was not possible from the dev machine:** the proxy enforces an IP allowlist **before** auth — every endpoint returns `403 ip_not_authorized` unless the client is on LBLnet/VPN or the IP is authorized at `https://api.cborg.lbl.gov/key/manage`. The six `lbl/cborg-*` seed aliases therefore remain doc-sourced, not live-verified; wrong IDs would surface at first chat call. Setup docs must name this 403 failure mode (it looks like, but is not, a bad key).

## Product Decision

Use opt-in CBORG first:

```bash
CBORG_API_KEY=sk-... uv run beril start --provider cborg
CBORG_API_KEY=sk-... uv run beril start --provider cborg --model lbl/cborg-coder-fast
CBORG_API_KEY=sk-... uv run beril start --provider cborg --model lbl/cborg-deepthought --thinking off
```

Do not make CBORG the default until it has been validated in normal BERIL sessions. Add `BERIL_MODEL_PROVIDER=cborg` as an env/default path after the explicit flag works.

## Model Role Defaults

These are defaults, not hard locks. Users can still pass Pi `--model`, `--models`, and command-specific model flags.

| BERIL role | Default CBORG model | Used by | Reason |
|---|---|---|---|
| `main` | `lbl/cborg-coder` | normal session/tool planning | Best fit for agentic coding plus scientific workflow control. |
| `fast` | `lbl/cborg-mini` | query expansion, stance triage, small summaries | Cheap/fast low-stakes model calls. |
| `review` | `lbl/cborg-deepthought` | `/berdl-review`, `/berdl-refute`, panel reviewers | Stronger analytical model for adversarial review. |
| `vision` | `lbl/cborg-vision` | future image/plot inspection paths | Explicit vision alias; not wired today. |

Fallback order for model-role resolution:

1. Role env override, e.g. `BERIL_REVIEW_MODEL=cborg/lbl/cborg-deepthought`.
2. Provider profile default when `BERIL_MODEL_PROVIDER=cborg`.
3. Current Pi session model.
4. Existing Anthropic fallback only when no provider profile is active.

## Implementation Tasks

### Task 1: Add CBORG provider profile generation

**Files:**
- Create: `beril_cli/model_provider.py`
- Test: `tests/test_cli_model_provider.py`

Implement a small Python module that builds and merges the Pi custom provider entry for CBORG into Pi's `models.json`.

- [ ] Path resolution honors Pi's own override: `$PI_CODING_AGENT_DIR/models.json`, else `~/.pi/agent/models.json`. Expose it as a function (`models_json_path()`) so tests isolate via `PI_CODING_AGENT_DIR`.
- [ ] Merge convention copies `_set_theme`/`_ensure_quiet_startup` (`start.py:64-109`): read-if-exists, bail (warn, leave untouched) on non-dict or parse failure — a user file may be valid JSONC for Pi and still unparseable here — mutate only `providers.cborg`, `mkdir(parents=True)`, `write_text(json.dumps(..., indent=2) + "\n")`, warn-don't-raise on `OSError`/`JSONDecodeError`.
- [ ] The written entry is always complete (`baseUrl` + `apiKey` + `api` + `models`) — an incomplete entry makes Pi drop every custom provider in the file.

Provider shape (validated against the 0.79.1 typebox schema — all fields, including the four `compat` sub-fields, are accepted):

```json
{
  "providers": {
    "cborg": {
      "name": "CBORG API",
      "baseUrl": "https://api.cborg.lbl.gov/v1",
      "api": "openai-completions",
      "apiKey": "$CBORG_API_KEY",
      "headers": {
        "x-litellm-api-key": "$CBORG_API_KEY"
      },
      "compat": {
        "supportsStore": false,
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false,
        "maxTokensField": "max_tokens"
      },
      "models": [
        {
          "id": "lbl/cborg-coder",
          "name": "CBORG Coder",
          "reasoning": false,
          "input": ["text"],
          "contextWindow": 114688,
          "maxTokens": 16384,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    }
  }
}
```

Add the full static seed list for `lbl/cborg-coder`, `lbl/cborg-coder-fast`, `lbl/cborg-deepthought`, `lbl/cborg-mini`, `lbl/cborg-chat`, and `lbl/cborg-vision`. (Only `id` is strictly required per model — `contextWindow`/`maxTokens` default to 128000/16384 — but keep explicit values for the aliases we have documented numbers for.)

Tests:

- [ ] Missing `models.json` creates a valid file.
- [ ] Existing unrelated providers are preserved.
- [ ] Existing `providers.cborg` is replaced only by the BERIL-managed CBORG profile.
- [ ] `BERIL_CBORG_API_BASE=https://api-local.cborg.lbl.gov/v1` overrides `baseUrl`.
- [ ] The written provider includes both `apiKey` and `x-litellm-api-key`.
- [ ] Malformed/JSONC `models.json` is left untouched (warn, no write).
- [ ] `PI_CODING_AGENT_DIR` relocates the file (test isolation path).

### Task 2: Wire `beril start --provider cborg`

**Files:**
- Modify: `beril_cli/cli.py`
- Modify: `beril_cli/start.py`
- Test: `tests/test_cli_start_pi.py`
- Test: `tests/test_cli_start.py` (only if a helper lands there)

Add `--provider` to the `start` subparser (next to `--agent`/`--version`/`--theme`; no conflicts). Pass `provider=args.provider` through and add `provider: str | None = None` to `run_start`. In `run_start`, if provider is `cborg`:

- [ ] Call `ensure_model_provider("cborg")`, imported at module level in `start.py` so tests can `monkeypatch.setattr(start, "ensure_model_provider", ...)`.
- [ ] Set `BERIL_MODEL_PROVIDER=cborg`.
- [ ] Set default role env vars via `os.environ.setdefault` (the existing only-if-unset idiom, `start.py:387`):
  - `BERIL_MAIN_MODEL=cborg/lbl/cborg-coder`
  - `BERIL_FAST_MODEL=cborg/lbl/cborg-mini`
  - `BERIL_REVIEW_MODEL=cborg/lbl/cborg-deepthought`
  - `BERIL_VISION_MODEL=cborg/lbl/cborg-vision`
- [ ] Append `--provider cborg` to Pi args.
- [ ] If the user did not pass `--model` (check both `--model x` and `--model=x` forms via the `arg.split("=", 1)[0]` idiom from `_has_session_flag`), append `--model lbl/cborg-coder`. `--models` alone does **not** suppress this — `--provider` is inert without `--model` in Pi 0.79.1. Normalize a joined `--model=x` to the space form: Pi's parser accepts only the exact `--model` token and exits 1 on `--model=x` (`dist/cli/args.js:40`).
- [ ] If `CBORG_API_KEY` is unset, print a short warning (launch continues; Pi errors on first request).

For any non-CBORG provider, re-append `--provider <name>` to the Pi argv (argparse consumed it) and do not provision anything. This preserves normal Pi provider behavior.

CBORG provisioning + env defaults slot after the repo-root check and before `execvp` (`start.py:395`). `os.chdir` does not affect the home-based models.json path.

Tests (mirror `_stub_launch`, `tests/test_cli_start_pi.py:33-45`; always stub `ensure_model_provider` or set `PI_CODING_AGENT_DIR` to `tmp_path` so no test touches the real `~/.pi/agent/models.json`):

- [ ] `run_start(provider="cborg")` provisions CBORG and execs `["pi", "--provider", "cborg", "--model", "lbl/cborg-coder"]`.
- [ ] User-supplied `--model lbl/cborg-coder-fast` (and `--model=...`) is not overridden.
- [ ] `run_start(provider="openai")` does not call the CBORG provisioner but still execs `["pi", "--provider", "openai", ...]` (the silently-dropped-flag regression).
- [ ] Missing `CBORG_API_KEY` does not fail launch; a warning is printed.
- [ ] Role env vars already set by the user are not overwritten.
- [ ] Existing assertions preserved: default launch has no `--model` in argv (`test_cli_start_pi.py:30`) and default argv is exactly `["pi", "explore the data"]` (`:98`).

### Task 3: Add shared model-role resolution

**Files:**
- Create: `lib/model-roles.ts`
- Test: `test/model-roles.test.ts`

Implement a pure helper that resolves role-specific models without assuming Anthropic. Resolution must go through `ctx.modelRegistry` (`find`/`getAll`) — `pi-ai`'s `getModel` cannot see custom-provider models.

API:

```ts
export type BerilModelRole = "main" | "fast" | "review" | "vision";

export function roleEnvName(role: BerilModelRole): string;

export function resolveModelReference(
  registry: Pick<ModelRegistry, "find" | "getAll">,
  reference: string,
  preferredProvider?: string,
): Model<any> | undefined;

export function resolveRoleModel(
  ctx: Pick<ExtensionCommandContext, "model" | "modelRegistry">,
  role: BerilModelRole,
  fallback?: { provider: string; model: string },
): Model<any> | undefined;
```

Rules:

- [ ] Canonical references use `provider/modelId`, where `modelId` may itself contain slashes: `cborg/lbl/cborg-deepthought`. Split on the **first** slash only, and only treat the prefix as a provider when it names one.
- [ ] Bare model IDs first search `BERIL_MODEL_PROVIDER`, then the fallback provider, then unique matches from `modelRegistry.getAll()`. Ambiguous bare IDs resolve to nothing.
- [ ] If nothing resolves, return `ctx.model`.
- [ ] Tolerate registries that lack `find`/`getAll` (existing test stubs define only `getApiKeyAndHeaders`) — optional-call and fall through.

Tests (save/restore `process.env` around any `BERIL_*` mutation — `node --test` runs a file's tests in one process):

- [ ] Resolves `cborg/lbl/cborg-deepthought` by splitting only the first slash.
- [ ] Resolves bare `lbl/cborg-mini` with `BERIL_MODEL_PROVIDER=cborg`.
- [ ] Rejects ambiguous bare IDs across multiple providers.
- [ ] Falls back to `ctx.model` when no role env/default resolves.
- [ ] Bare `claude-opus-4-8` with fallback provider `anthropic` and no `BERIL_MODEL_PROVIDER` resolves via the registry (back-compat with today's override path).

### Task 4: Make review/refutation model overrides provider-aware

**Files:**
- Modify: `lib/review-agent.ts`
- Test: `test/review-agent.test.ts`
- Test: `test/review-fanout.test.ts`

Replace the hardcoded `getModel("anthropic", modelOverride ?? DEFAULT_REVIEW_MODEL)` path (`lib/review-agent.ts:103`) with `resolveRoleModel`. `/berdl-refute` runs a single subagent through `runReviewSubagent`, so it inherits this automatically — no `lib/refutation.ts` changes (that file is a pure markdown summarizer).

Behavior:

- [ ] Explicit `modelOverride` accepts either `provider/modelId` or a bare ID under `BERIL_MODEL_PROVIDER`.
- [ ] No override uses role `review`, which is `cborg/lbl/cborg-deepthought` for CBORG sessions; the non-CBORG default remains Anthropic Opus 4.8 via the `fallback` argument.
- [ ] The auth check stays on `ctx.modelRegistry.getApiKeyAndHeaders` (the existing test seam); no auth → fall back to `ctx.model` exactly as today.
- [ ] Keep the read-only tool allowlist unchanged.
- [ ] Future-proof cap (one line in `runReviewPanel`): when `BERIL_MODEL_PROVIDER=cborg`, cap panel concurrency at 5 per CBORG on-prem guidance. (No-op for today's 4-specialist panel.)

Tests:

- [ ] `/berdl-review --model cborg/lbl/cborg-deepthought` selects the CBORG model from the registry.
- [ ] Bare `--model lbl/cborg-deepthought` selects CBORG when `BERIL_MODEL_PROVIDER=cborg`.
- [ ] Bare `--model claude-opus-4-8` still resolves to Anthropic with no `BERIL_MODEL_PROVIDER` set (back-compat).
- [ ] When CBORG auth is unavailable, review falls back to `ctx.model`.
- [ ] A custom panel of 6 with `BERIL_MODEL_PROVIDER=cborg` runs at concurrency 5.
- [ ] Existing registry stubs (`{ getApiKeyAndHeaders }` only) keep passing — extend stubs with `find`/`getAll` only where a test exercises resolution.

### Task 5: Route lightweight model calls through the `fast` role

**Files:**
- Modify: `extensions/beril-literature.ts`
- Test: `test/beril-literature.test.ts`

Update `expandQueries` and `assessStances`:

- [ ] Prefer `resolveRoleModel(ctx, "fast")` — **no fallback argument** (the resolver tries a fallback before `ctx.model`, so passing the Anthropic default here would reroute non-CBORG sessions off their session model; the Anthropic default stays in the existing no-session-model else-branch). **This is an intentional precedence change:** a resolved role env/provider-profile model now wins over `ctx.model`; when nothing resolves, `ctx.model` wins as today, then the Anthropic fallback when there is no session model.
- [ ] Keep the injectable Completer seam (`deps.getModel`/`__completer`) — existing tests depend on it; role resolution threads through `ctx.modelRegistry` without removing the seam.
- [ ] Keep current `[topic]` and all-NEI fallbacks when no model/auth is usable.
- [ ] Do not change literature fetch/search behavior; only the in-process model calls change.

Tests:

- [ ] With `BERIL_MODEL_PROVIDER=cborg` and `BERIL_FAST_MODEL=cborg/lbl/cborg-mini`, query expansion calls `lbl/cborg-mini`.
- [ ] If `BERIL_FAST_MODEL` has no auth, expansion falls back to `[topic]` or current session model per the helper rules.
- [ ] Existing no-model/no-auth tests still pass (Completer seam preserved; save/restore `process.env`).

### Task 6: Optional authenticated model refresh — DEFERRED

Not implemented in the first PR. The static `lbl/cborg-*` aliases are enough to make `beril start --provider cborg` useful, and live `/model/info` could not be exercised from the dev environment (IP allowlist). When implemented: stdlib `urllib` (repo convention — `beril_cli` stays zero-dependency), GET `${base-without-/v1}/model/info` with both auth headers, filter `model_info.mode` in `{chat, completion, responses, missing}`, merge into the static seed, preserve static role defaults on failure, tests patch `urlopen` like `tests/test_cli_start.py:36-54`.

### Task 7: Document usage and model guidance

**Files:**
- Modify: `README.md` (extend the existing "Model provider" section)

Document:

- [ ] `CBORG_API_KEY=sk-... uv run beril start --provider cborg`
- [ ] **The IP-allowlist gotcha:** CBORG 403s (`ip_not_authorized`) before auth unless on LBLnet/VPN or the IP is authorized at `https://api.cborg.lbl.gov/key/manage` — it looks like a bad key but is not.
- [ ] `BERIL_CBORG_API_BASE=https://api-local.cborg.lbl.gov/v1` for LBL network/VPN direct routing.
- [ ] Role env overrides: `BERIL_MAIN_MODEL`, `BERIL_FAST_MODEL`, `BERIL_REVIEW_MODEL`, `BERIL_VISION_MODEL`.
- [ ] How to switch back: omit `--provider cborg`, or pass a different Pi provider/model.
- [ ] How to inspect models: `uv run beril start --provider cborg --list-models` (works without auth).
- [ ] Why review/refute use `lbl/cborg-deepthought` by default.

## Verification

Automated (canonical gates per CLAUDE.md):

```bash
bun run check && bun run test
uv run --group test pytest tests/ -q
```

Manual with a real key (requires LBLnet/VPN or an authorized IP):

```bash
CBORG_API_KEY=sk-... uv run beril start --provider cborg --list-models
CBORG_API_KEY=sk-... uv run beril start --provider cborg
```

In the TUI:

- Confirm the selected model is `lbl/cborg-coder`.
- Run `/literature-review <topic>` and verify query expansion still works.
- Run `/berdl-review <project> --model cborg/lbl/cborg-deepthought` and verify the review subagent starts.
- Run `/model` and switch away from CBORG to confirm normal Pi provider switching still works.

## Open Questions

- Whether Pi should own global `~/.pi/agent/models.json` mutation long term. It is the most reliable path for startup model resolution, but it is global. If that feels too invasive, implement CBORG through an async Beril extension using `pi.registerProvider()` instead (0.79.1 requires `baseUrl` + `apiKey`/`oauth` when models are given).
- Whether CBORG commercial aliases such as `claude-sonnet-high`, `claude-opus-high`, and `gpt-codex` should be included in the static seed. Do not hardcode them until authenticated `/model/info` confirms the exact IDs available to the target key.
- Whether CBORG should become BERIL's default provider. Defer until the explicit profile has been exercised across a full BERIL project lifecycle.
