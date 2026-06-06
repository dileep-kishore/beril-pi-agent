# Pi-native `/berdl-review` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the `beril review` → `review.sh` → codex/claude CLI path with an in-process Pi review subagent (Opus 4.8, overridable), keeping the reproducibility footer byte-identical.

**Architecture:** `/berdl-review` (new `extensions/beril-review.ts`) runs an isolated, read-only `createAgentSession` on Opus 4.8 with the BERDL rubric as its system prompt; it returns the review markdown, and the extension writes `REVIEW_N.md` + the raw-`sha256` `report_hash` footer (ported to TS) and advances lifecycle. All bash/Python/codex review plumbing is deleted.

**Tech Stack:** TypeScript (Node strip-only), `@earendil-works/pi-coding-agent` SDK (`createAgentSession`, `DefaultResourceLoader`/custom `ResourceLoader`, `SessionManager.inMemory`), `@earendil-works/pi-ai` (`getModel`), `node:crypto`, `typebox`. Tests: `node --test`. Companion spec: `docs/superpowers/specs/2026-06-05-pi-native-review-design.md` (read it — it has the verified SDK file:line refs).

**Toolchain constraints:** strip-only TS (no enum/namespace/param-properties; `.ts` import extensions; `import type`); `bunx tsc --noEmit`; `bunx biome check .`; `node --test 'test/**/*.test.ts'`; Python `uv run --group test pytest -q`. Do NOT touch the protected reproducibility files (`tools/notebook_hash.py`, `beril_cli/lifecycle.py`, `hash_cmd.py`, `user_cmd.py`, `submit_cmd.py`, `lakehouse_upload.py`) or `extensions/beril-safety.ts`.

## File structure

| File | Responsibility |
|---|---|
| `lib/review-rubric.ts` (new) | `PROJECT_REVIEW_RUBRIC` + `PLAN_REVIEW_RUBRIC` system-prompt strings (self-sufficient: role, read-only tools, output = YAML frontmatter + sections, NO footer). |
| `lib/review-finalize.ts` (new) | `sha256File`, `nextReviewPath`, `appendReportHashFooter`, `stripReportHashFooters` — pure repro logic. |
| `lib/review-agent.ts` (new) | `runReviewSubagent(opts)` — isolated read-only session, model resolution + fallback, returns review text. Injectable session factory. |
| `extensions/beril-review.ts` (new) | `/berdl-review <project> [--plan] [--model <id>]` command orchestration. |
| `extensions/beril-governance.ts` (modify) | remove the `/berdl-review` command + its test. |
| `beril_cli/cli.py` (modify) | remove the `review` subparser + dispatch. |
| Deleted | `tools/review.sh`, `beril_cli/review_cmd.py`, `tests/test_cli_review.py`. |

**Execution waves (see subagent-driven-development):** Phase A tasks (1, 2) touch disjoint new files → run in parallel. Phase B (tasks 3–5) are coupled (4 imports 3; 5 is the swap) → one sequential unit, single atomic commit.

---

## Phase A — additive libs (parallel-safe)

### Task 1: `lib/review-rubric.ts`

**Files:** Create `lib/review-rubric.ts`; Test `test/review-rubric.test.ts`. Source material: `skills/berdl-review/SKILL.md` (rubric sections) cross-checked against `/Users/g8k/Documents/Work/Collaborations/BERIL-research-observatory/.claude/reviewer/SYSTEM_PROMPT.md` + `PLAN_REVIEW_PROMPT.md` (read-only, for fidelity — do not depend on that repo at runtime).

- [ ] **Step 1 — failing test** (`test/review-rubric.test.ts`): assert both exports exist and are self-sufficient.

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { PLAN_REVIEW_RUBRIC, PROJECT_REVIEW_RUBRIC } from "../lib/review-rubric.ts";

test("project rubric is self-sufficient", () => {
  for (const needle of ["read-only", "Methodology", "Reproducibility", "Code quality", "Findings", "frontmatter"]) {
    assert.ok(PROJECT_REVIEW_RUBRIC.includes(needle), needle);
  }
  // The extension owns the footer — the reviewer must NOT emit report_hash.
  assert.ok(!/report_hash/i.test(PROJECT_REVIEW_RUBRIC));
});
test("plan rubric covers feasibility + pitfalls", () => {
  for (const needle of ["Hypothesis", "pitfall", "Performance", "Duplication"]) {
    assert.ok(PLAN_REVIEW_RUBRIC.includes(needle), needle);
  }
});
```

- [ ] **Step 2 — run, expect FAIL:** `node --test test/review-rubric.test.ts` (module not found).
- [ ] **Step 3 — implement** `lib/review-rubric.ts`: two `export const … = \`…\`` strings. Each opens with the reviewer role + "you have read-only tools (read/grep/find/ls); do not attempt to write files" + "output the COMPLETE review as markdown with a YAML frontmatter block and the rubric sections; do NOT add a report_hash footer". Then the project/plan rubric bodies derived from `skills/berdl-review/SKILL.md` §"Project review rubric" / §"Plan review rubric".
- [ ] **Step 4 — run, expect PASS:** `node --test test/review-rubric.test.ts`.
- [ ] **Step 5:** (controller commits — see execution note).

### Task 2: `lib/review-finalize.ts`

**Files:** Create `lib/review-finalize.ts`; Test `test/review-finalize.test.ts`.

Interface:
```ts
export function sha256File(path: string): string;            // raw bytes → 64-hex (no prefix)
export function stripReportHashFooters(body: string): string; // remove any `<!-- report_hash: sha256:… -->` lines
export function appendReportHashFooter(body: string, hex: string): string; // strip + append exactly one as final non-empty line
export function nextReviewPath(projectDir: string, prefix: "REVIEW" | "PLAN_REVIEW"): string; // REVIEW_1.md, REVIEW_2.md…
```

- [ ] **Step 1 — failing test** `test/review-finalize.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appendReportHashFooter, sha256File, stripReportHashFooters } from "../lib/review-finalize.ts";

test("sha256File is byte-identical to sha256sum", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rf-"));
  const f = join(dir, "REPORT.md");
  await writeFile(f, "hello\n"); // sha256("hello\n") = 5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03
  assert.equal(sha256File(f), "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03");
});
test("footer is the single final non-empty line, idempotent", () => {
  const hex = "a".repeat(64);
  const once = appendReportHashFooter("body\n", hex);
  assert.match(once, /<!-- report_hash: sha256:a{64} -->\n$/);
  const twice = appendReportHashFooter(once, hex);
  assert.equal((twice.match(/report_hash/g) || []).length, 1);
  assert.equal(stripReportHashFooters(once).includes("report_hash"), false);
});
```

- [ ] **Step 2 — run, expect FAIL.** `node --test test/review-finalize.test.ts`.
- [ ] **Step 3 — implement** `lib/review-finalize.ts` using `node:crypto` `createHash("sha256")` over `readFileSync(path)` → hex; footer format `\n<!-- report_hash: sha256:${hex} -->\n` matching `tools/review.sh:270`; `stripReportHashFooters` removes lines matching `/^<!--\s*report_hash:\s*sha256:[0-9a-f]+\s*-->\s*$/m`; `nextReviewPath` increments `${prefix}_${n}.md` while the file exists.
- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5:** controller commits.

**Commit (controller, after A green):** `feat(review): rubric + finalize libs for in-process review` — `lib/review-rubric.ts`, `lib/review-finalize.ts`, both tests. Gate: tsc + biome + full `node --test` + pytest all green.

---

## Phase B — the swap (atomic, sequential)

### Task 3: `lib/review-agent.ts`

**Files:** Create `lib/review-agent.ts`; Test `test/review-agent.test.ts`.

Interface:
```ts
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
export interface ReviewRequest { projectDir: string; rubric: string; task: string; modelOverride?: string; }
// Injectable for tests: a factory that returns { prompt(text): Promise<void>, getLastAssistantText(): string|undefined, abort(): Promise<void>, dispose(): void }
export type SessionFactory = (cfg: { model: unknown; cwd: string; rubric: string }) => Promise<ReviewSession>;
export async function runReviewSubagent(ctx: ExtensionCommandContext, req: ReviewRequest, factory?: SessionFactory): Promise<string>;
```

- [ ] **Step 1 — failing test** `test/review-agent.test.ts`: inject a fake factory whose `prompt()` is a no-op and `getLastAssistantText()` returns `"## Review\nLGTM"`; fake `ctx` with a `modelRegistry.getApiKeyAndHeaders` returning `{ok:true, apiKey:"k"}` and a `model`. Assert (1) `runReviewSubagent` returns `"## Review\nLGTM"`; (2) when the resolved model's auth is `{ok:false}` and no `ctx.model`, it throws a clear "no model/auth" error; (3) `dispose()` is called.
- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement** `lib/review-agent.ts`: resolve model = `getModel("anthropic", req.modelOverride ?? "claude-opus-4-8")`; check `ctx.modelRegistry.getApiKeyAndHeaders(model)`; if `!ok`, fall back to `ctx.model`; if still none → throw. Default `factory` builds the real session: a custom `ResourceLoader` (`getExtensions: () => ({extensions:[], errors:[], runtime: createExtensionRuntime()})`, `getSkills/getPrompts/getThemes` empty, `getAgentsFiles: () => ({agentsFiles:[]})`, `getSystemPrompt: () => req.rubric`, `getAppendSystemPrompt: () => []`, `extendResources: () => {}`, `reload: async () => {}`); `createAgentSession({ model, cwd: req.projectDir, tools: ["read","grep","find","ls"], resourceLoader, sessionManager: SessionManager.inMemory(req.projectDir), modelRegistry: ctx.modelRegistry })`. `await session.prompt(req.task)` (wire `ctx.signal → session.abort()`); read `session.getLastAssistantText()`; `session.dispose()` in `finally`. **Verify the `createExtensionRuntime`/`ResourceLoader` member names against `dist/core/resource-loader.d.ts` + `examples/sdk/12-full-control.ts` before finalizing.**
- [ ] **Step 4 — run, expect PASS.**

### Task 4: `extensions/beril-review.ts`

**Files:** Create `extensions/beril-review.ts`; Test `test/beril-review.test.ts`.

- [ ] **Step 1 — failing test** `test/beril-review.test.ts`: fake `pi` capturing `registerCommand("berdl-review", …)`; drive the handler with a fake `ctx` (`hasUI:true`, `isIdle:()=>true`, `cwd`, ui spies) against a temp project dir containing `beril.yaml` (status `analysis`) + `REPORT.md`. Inject the review-agent factory (return canned review text) so no real LLM. Assert: (1) a `REVIEW_1.md` is written containing the review + exactly one `report_hash` footer as the final line; (2) `beril lifecycle set <proj> reviewed` is invoked (mock `pi.exec`); (3) `--plan` writes `PLAN_REVIEW_1.md`, no footer, no lifecycle call; (4) missing `REPORT.md` (project review) → notify error, no file written.
- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement** `extensions/beril-review.ts`: parse args (`<project>`, `--plan`, `--model <id>`); validate (`ctx.isIdle()`, project dir, REPORT.md + status for project review — read status via `beril lifecycle status` or `beril.yaml`); `REPORT_HASH_PRE = sha256File(REPORT.md)`; `text = await runReviewSubagent(ctx, {projectDir, rubric: PROJECT|PLAN, task})`; for project review recompute POST and discard on mismatch; `path = nextReviewPath(...)`; write `appendReportHashFooter(text, PRE)` (project) or raw `text` (plan); project review → `berilExec(pi, ["lifecycle","set",project,"reviewed"])`; notify + `sendUserMessage` to follow the `berdl-review` skill. Make the agent factory injectable for the test (e.g. accept via a module-level default that the test overrides, mirroring `beril-literature.ts`'s `__completer` seam).
- [ ] **Step 4 — run, expect PASS.**

### Task 5: remove the old plumbing (same commit as 3+4)

**Files:** Delete `tools/review.sh`, `beril_cli/review_cmd.py`, `tests/test_cli_review.py`; Modify `beril_cli/cli.py` (remove `review` subparser + the `if args.command == "review"` dispatch); Modify `extensions/beril-governance.ts` (remove the `/berdl-review` `registerCommand` block) and `test/beril-governance.test.ts` (remove the "/berdl-review runs review then marks reviewed" test + the `review` branch from harness mocks).

- [ ] **Step 1:** delete the three files; edit `cli.py` + `beril-governance.ts` + its test.
- [ ] **Step 2 — full gate:** `bunx tsc --noEmit` (0), `bunx biome check .` (0), `node --test 'test/**/*.test.ts'` (all pass), `uv run --group test pytest -q` (all pass), `pi install -l .` (loads). Confirm `grep -rn "review" beril_cli/cli.py` shows no `review` subcommand and `git grep -n "berdl-review" extensions/beril-governance.ts` is empty.

**Commit (controller, after B green):** `feat(review): in-process Pi review subagent; remove review.sh + codex path` — all Phase B files + deletions. One atomic commit; no broken intermediate.

---

## Self-review (spec coverage)
- §3 components → Tasks 1–4 + removals (Task 5). ✓
- §4 model resolution + fallback → Task 3 Step 3 + test (2). ✓
- §5 data flow (validate→PRE→run→POST/TOCTOU→write→footer→lifecycle) → Task 4. ✓
- §6 reproducibility byte-identity → Task 2 Step 1 (known sha256) + footer format. ✓
- §7 error handling → Task 3 (no model/auth), Task 4 (missing REPORT, TOCTOU). ✓
- §8 testing → each task's tests. ✓
- §9 invariants → isolation (Task 3 empty-extensions loader), repro (Task 2), safety untouched (Task 5 leaves beril-safety.ts alone). ✓

## Final acceptance
Full gate green; `/berdl-review` registered by `beril-review` (not governance); `beril review` subcommand gone; `review.sh`/`review_cmd.py` gone; reproducibility footer byte-identical (Task 2 test pins it); `beril-safety.ts` + notebook hash untouched (`git diff` check).
