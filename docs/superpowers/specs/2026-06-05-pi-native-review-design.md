# Pi-native `/berdl-review` — Design Spec

**Date:** 2026-06-05
**Status:** Approved (design)
**Companion:** [`pi-api-reference.md`](./pi-api-reference.md). SDK facts below were verified against the installed `@earendil-works/pi-coding-agent` 0.78.1 (dist `.d.ts` + `examples/`).

## 1. Summary

Replace the `beril review` → `review.sh` (bash) → external `codex`/`claude` CLI path with an **in-process Pi review subagent** launched from the `/berdl-review` command. The reviewer runs on **Claude Opus 4.8** (overridable), is fed the BERDL review rubric as its system prompt, reads the project read-only, and **returns the review markdown**; the extension writes the numbered `REVIEW_N.md`, appends the reproducibility footer, and advances lifecycle. All bash/Python/codex review plumbing is deleted. The review **rubric/judgment** stays in `skills/berdl-review/SKILL.md`; this moves **execution** in-process and ports the **one reproducibility primitive** (raw `sha256` of `REPORT.md`) to byte-identical TS.

## 2. Verified SDK building blocks (file:line in the installed package)

- **Model:** `getModel("anthropic","claude-opus-4-8")` from `@earendil-works/pi-ai` — built-in (`pi-ai/dist/models.generated.*`, direct Anthropic API, 1M ctx; **not** the `bedrock`/dotted variant). Returns `undefined` for unknown ids (`models.js:11-14`) — null-check. Auth is provider-scoped and resolved by the session's `ModelRegistry`; reuse `ctx.modelRegistry`.
- **Isolation (critical):** there is **no** `extensions:false` option. Pass a custom `ResourceLoader` whose `getExtensions()` returns empty so the child session does **not** re-load the `beril-*` extensions / safety gate (proof: `sdk.js:74-78,258`; pattern: `examples/sdk/12-full-control.ts:40-64`). The custom loader's `getSystemPrompt()` returns the rubric (`agent-session.js:636-651`; a `customPrompt` **replaces** Pi's default persona — `system-prompt.js:19-41` — so the rubric must be self-sufficient).
- **Create + run:** `createAgentSession({ model, cwd: projectDir, tools, resourceLoader, sessionManager: SessionManager.inMemory(projectDir), modelRegistry: ctx.modelRegistry })` (`sdk.d.ts:108,13-52`). `await session.prompt(text)` resolves only after the full run incl. tool calls (`agent-session.d.ts:320-328`, `docs/sdk.md:203`). Read result via `session.getLastAssistantText()` (`agent-session.d.ts:588-593`). `session.dispose()` in `finally`; wire `ctx.signal → session.abort()` (`:254-258,400-404`). `prompt()` throws if no model/auth — bail early.
- **Tools:** read-only reviewer → `tools: ["read","grep","find","ls"]` (grep/find/ls are non-default built-ins and must be listed; `docs/sdk.md:471-472`). No write tool — the extension writes the file.
- **Command:** `pi.registerCommand("berdl-review", { handler: async (args, ctx) => … })`; `ctx` gives `cwd`, `modelRegistry`, `model`, `hasUI`, `signal`, `isIdle()`.

## 3. Components

| File | Responsibility |
|---|---|
| `extensions/beril-review.ts` (new) | `/berdl-review <project> [--plan] [--model <id>]` command; orchestrates resolve→run→finalize. (Moves the command out of `beril-governance.ts`.) |
| `lib/review-rubric.ts` (new) | Reviewer system prompt — **project** + **plan** variants. Authored from `skills/berdl-review/SKILL.md` and cross-checked against the original `.claude/reviewer/SYSTEM_PROMPT.md` + `PLAN_REVIEW_PROMPT.md` so the un-migrated reviewer prompts are re-homed. Self-sufficient (role, read-only tool usage, output format = YAML frontmatter + sections, **no footer** — extension adds it). |
| `lib/review-agent.ts` (new) | Builds the isolated read-only session (custom `ResourceLoader`, model resolution + fallback), runs one turn, returns the review text. Injectable session factory for tests. |
| `lib/review-finalize.ts` (new) | Pure reproducibility step: `sha256(REPORT.md)` (Node `crypto`), TOCTOU compare, footer append/idempotent-strip, next `REVIEW_N` numbering. |

**Removed:** `tools/review.sh`, `beril_cli/review_cmd.py`, the `review` subcommand + `--reviewer`/`--model` args in `beril_cli/cli.py`, `tests/test_cli_review.py`, and the `/berdl-review` command + its test in `beril-governance.ts`.

## 4. Model resolution
Default `opus-4.8`, resolved via the session registry so it respects the user's configured provider (Vertex/ADC or direct). `--model <id>` overrides. If the chosen model has no resolvable auth (`ctx.modelRegistry.getApiKeyAndHeaders(model)` → `!ok`), **fall back to `ctx.model`** (the current session model; pattern: `summarize.ts:163-178`). If neither resolves → bail with a clear error (don't run).

## 5. Data flow
`/berdl-review myproj [--plan]` →
1. Validate: project dir exists; **project review** requires `REPORT.md` + `beril.yaml` status ∈ {analysis, reviewed, complete} (else tell user to `/synthesize` first); guard `ctx.isIdle()`.
2. `REPORT_HASH_PRE = sha256(REPORT.md)` (project review only).
3. Resolve reviewer model (§4); build isolated session; `await session.prompt("Review project at <dir> against the rubric; output the complete review markdown")`; `dispose()`.
4. `text = getLastAssistantText()`; bail if empty.
5. **Project review:** `REPORT_HASH_POST = sha256(REPORT.md)`; if `!= PRE` → discard, error (TOCTOU). Write `REVIEW_N.md` (next number); append exactly one `\n<!-- report_hash: sha256:<hex> -->\n` as the final non-empty line (strip any pre-existing). Advance lifecycle → `reviewed` (via existing `beril lifecycle set`). **Plan review:** write `PLAN_REVIEW_N.md`; no footer, no lifecycle change.
6. Notify + `sendUserMessage` to follow the `berdl-review` skill to read/summarize it.

## 6. Reproducibility (Invariant 2)
The footer hash is a **raw-file** `sha256` of `REPORT.md` bytes (not the notebook canonical-JSON hash), so Node `crypto.createHash("sha256")` is **byte-identical** to the old `sha256sum`. Preserve exactly: the footer format `<!-- report_hash: sha256:<64-hex> -->` as the single, final non-empty line; the pre/post TOCTOU discard. A test pins byte-identity against a fixed input so `/submit`'s existing footer parser is unaffected. The notebook canonical hash (`beril hash`) and all other protected files stay untouched.

## 7. Error handling
No model/auth → bail before running. Empty review → error, write nothing. TOCTOU mismatch → discard the review file + error. Abort (`ctx.signal`) → `abort()` + `dispose()`. Reviewer runs only when `ctx.isIdle()` (avoid reentrancy with the parent stream).

## 8. Testing
TS (`node --test`, strip-only):
- `review-finalize`: footer byte-identity + exact format; idempotent strip of a pre-existing footer; TOCTOU discard; `REVIEW_N` numbering.
- `review-agent`: model resolution + fallback (mock `ctx.modelRegistry`); orchestration with an **injected fake session factory** (no real LLM) — asserts the isolated loader (empty extensions), read-only tools, and that the returned text is surfaced.
- `beril-review` command: validation branches (missing project/REPORT, wrong status, plan vs project), and the finalize+lifecycle calls (mock exec/finalize).
- Rubric: snapshot that both variants are present + self-sufficient (mention read-only tools + output format + no-footer).
Python: delete `test_cli_review.py`; confirm suite green after removal.

## 9. Invariants
1. Self-containment — no original-BERIL dependency (the reviewer prompts are re-homed into `lib/review-rubric.ts`). 2. Reproducibility — raw `sha256` ported byte-identically; notebook canonical hash + `/submit` footer parser untouched. 3. Strip-only TS. 4. No MCP. 5. Safety gate — the reviewer is **isolated** (custom loader, empty extensions) so it cannot recurse into `beril-safety`; `beril-safety.ts` itself is untouched.

## 10. Phasing (tracer-bullet)
- **Phase A (additive, parallel):** `lib/review-rubric.ts` ∥ `lib/review-finalize.ts` (+ tests). Nothing else references them yet → safe, green, committable.
- **Phase B (atomic swap):** `lib/review-agent.ts` + `extensions/beril-review.ts` + remove `/berdl-review` from `beril-governance.ts` + delete `review.sh`/`review_cmd.py`/cli `review` subcommand/`test_cli_review.py` + migrate the governance review test. One commit, no broken intermediate state.
