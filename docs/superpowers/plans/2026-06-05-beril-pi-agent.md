# beril-pi-agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `beril-pi-agent`, a Pi package that turns BERIL into a terminal research workbench — 5 capability-aligned TS extensions wrapping a stable `beril` CLI, with Pi-optimized skills and a central safety gate.

**Architecture:** Thin TypeScript extensions register Pi tools/commands/hooks and shell out (`pi.exec`) to a bundled `beril <subcommand>` CLI; the proven Python keeps the logic, state, and reproducibility.

> **CORRECTION (see phase-notes.md):** this plan was written for a two-repo layout (Python subcommands added to `BERIL-research-observatory`). That was changed post-MVP — the `beril` CLI + BERDL `scripts/`/`tools/` are now **vendored into this single repo** (`beril_cli/`, `scripts/`, `tools/`, `pyproject.toml`, `PROJECT.md`), making `beril-pi-agent` self-contained with no dependency on the original repo. Where tasks below say "BERIL repo / `feat/beril-pi-subcommands`", read "this repo's bundled CLI." All Python tests now live in `tests/test_cli_*.py` here.

**Tech Stack:** Pi `@earendil-works/pi-coding-agent@0.78.1` (verified), TypeScript (strict) + `typebox` params + Biome, Node 26 test runner (`node:test`); Python 3.11 stdlib + argparse (BERIL CLI), pytest. Companion: [`../specs/pi-api-reference.md`](../specs/pi-api-reference.md) and [`../specs/2026-06-05-beril-pi-agent-design.md`](../specs/2026-06-05-beril-pi-agent-design.md).

---

## Conventions (read once, applied throughout)

### C1 — `beril` subcommand I/O contract
Every **data-returning** subcommand (`env`, `query`, `discover`, `inventory`, `hash`, `user`, `lifecycle`, `lit`) MUST:
- print **exactly one JSON value** to **stdout** and nothing else (no banners, no `[hub]` chatter);
- send all diagnostics/progress to **stderr**;
- exit **0** = success, **1** = runtime failure, **2** = config/usage error (`beril submit`: **2 = partial = failure**).

Subcommands that wrap a script which prints noise (e.g. `run_sql.py`'s `ensure_hub` chatter) MUST route the script's JSON to a temp `--output` file and re-emit only that file's contents to stdout.

### C2 — Repo-root resolution
Subcommands locate the BERIL repo via `find_repo_root()` (walk up for `PROJECT.md`). Refactored out of `start.py` into `beril_cli/paths.py` in Task 0.1 and reused everywhere.

### C3 — TS extension skeleton (every `extensions/*.ts`)
```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function (pi: ExtensionAPI) { /* register tools/commands/hooks */ }
```
Import types from the package **root**. Tool params use `import { Type } from "typebox"`; string-enums use `import { StringEnum } from "@earendil-works/pi-ai"`. `execute(toolCallId, params, signal, onUpdate, ctx)` — tools **throw** on failure (no `isError` field). Touch `ctx.ui` only when `ctx.hasUI`; touch `ctx.ui.custom/setFooter/setHeader` only when `ctx.mode === "tui"`.

**STRIP-ONLY TS CONSTRAINT (verified at runtime):** tests run under Node 26's native type-stripping, which only *erases* types — it cannot *transform* code. Therefore NEVER use: TypeScript **parameter properties** (`constructor(public x: T)` → declare the field + assign in the body instead), `enum`, `namespace`, or experimental decorators. Use `.ts` extensions in relative imports; use `import type` for type-only imports (`verbatimModuleSyntax` is on). Test command: `node --test test/` (no flags). Typecheck: `bunx tsc --noEmit`.

### C4 — `berilExec` wrapper template (`lib/beril-exec.ts`, built in Task 0.3)
All tools call `berilExec(pi, args)` rather than `pi.exec` directly. It runs `beril`, maps exit 0/1/2, and `JSON.parse`s stdout.

### C5 — Wrapper-subcommand task template (Python)
Wrapper subcommands (`query`, `export`, `discover`, `inventory`, `hash`, `review`, `submit`, `env`) follow this shape; each task below specifies the deltas only:
```python
# beril_cli/<name>_cmd.py
def run_<name>(args) -> int:
    root = find_repo_root()
    if root is None:
        print("BERIL repo not found (no PROJECT.md on path).", file=sys.stderr); return 2
    # build argv for the underlying script; route JSON to a temp file when the script is noisy
    # subprocess.run(...); map child returncode; emit one JSON object to stdout; return 0/1/2
```

### C6 — Commit discipline
One commit per task (after its tests pass). Conventional messages. Python tasks commit in the BERIL repo (`feat/beril-pi-subcommands`); TS tasks commit in `beril-pi-agent` (`feat/mvp`). Never push.

---

## File Structure

**`beril-pi-agent/` (this repo, branch `feat/mvp`):**
| File | Responsibility |
|---|---|
| `package.json` | npm + `pi` manifest (extensions/skills/prompts/themes); peerDeps for pi-core |
| `tsconfig.json`, `biome.json` | strict TS + lint/format |
| `lib/beril-exec.ts` | typed `pi.exec("beril", …)` → result/throw + JSON parse |
| `lib/readiness.ts` | `requireReady(pi)` env-readiness guard |
| `lib/destructive.ts` | destructive-tool registry + arg inspection |
| `lib/render.ts` | `hasUI`-gated table/status renderers |
| `extensions/beril-env.ts` | `berdl_env_check` tool, `/berdl-connect` `/berdl-status`, `session_start` widget |
| `extensions/beril-data.ts` | `berdl_query` / `berdl_export` / `berdl_discover` tools |
| `extensions/beril-governance.ts` | `notebook_hash`/`lifecycle_transition`/`beril_user`/`lakehouse_submit` tools, `/synthesize` `/berdl-review` `/submit` |
| `extensions/beril-literature.ts` | `lit_search`/`lit_fetch` tools, `/literature-review` |
| `extensions/beril-safety.ts` | central `tool_call` gate |
| `skills/*/SKILL.md` | Pi-optimized judgment (query/discover/synth/review/submit/lit/suggest/pitfall) |
| `prompts/berdl-start.md` | `/berdl-start` onboarding template |
| `themes/beril.json` | optional theme |
| `test/*.test.ts` | `node:test` unit/integration |

**`BERIL-research-observatory/` (branch `feat/beril-pi-subcommands`):**
| File | Responsibility |
|---|---|
| `beril_cli/paths.py` | `find_repo_root()` (extracted) |
| `beril_cli/cli.py` | + subparsers & dispatch for new subcommands; `--agent pi` |
| `beril_cli/start.py` | + `pi` launch branch |
| `beril_cli/{env,query,export,discover,inventory,hash,review,submit,lifecycle,lit}_cmd.py` | subcommands |
| `beril_cli/lifecycle.py` | **net-new** state-machine engine |
| `beril_cli/lit_client.py` | **net-new** PubMed/Semantic Scholar HTTP client |
| `tests/cli/test_*.py` | pytest |

---

# PHASE 0 — Scaffold + Connect

Goal: `beril env --json` returns readiness; `beril start --agent pi` launches Pi with the package; `beril-env` renders a connection-status widget on session start. Verify at end: launch Pi off-cluster and see the status widget.

### Task 0.1: Extract `find_repo_root()` to `beril_cli/paths.py`

**Files:**
- Create: `beril_cli/paths.py`
- Modify: `beril_cli/start.py` (replace local `_find_repo_root`)
- Test: `tests/cli/test_paths.py`

- [ ] **Step 1: Write the failing test**
```python
# tests/cli/test_paths.py
from pathlib import Path
from beril_cli.paths import find_repo_root

def test_finds_root_with_project_md(tmp_path, monkeypatch):
    (tmp_path / "PROJECT.md").write_text("x")
    sub = tmp_path / "a" / "b"; sub.mkdir(parents=True)
    monkeypatch.chdir(sub)
    assert find_repo_root() == tmp_path

def test_returns_none_without_marker(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    assert find_repo_root() is None
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd BERIL-research-observatory && uv run pytest tests/cli/test_paths.py -q`
Expected: FAIL (`ModuleNotFoundError: beril_cli.paths`)

- [ ] **Step 3: Write minimal implementation**
```python
# beril_cli/paths.py
"""Shared filesystem helpers for the BERIL CLI."""
from __future__ import annotations
from pathlib import Path

def find_repo_root(start: Path | None = None) -> Path | None:
    """Walk up from `start` (or cwd) looking for PROJECT.md (repo marker)."""
    current = start or Path.cwd()
    for parent in [current, *current.parents]:
        if (parent / "PROJECT.md").exists():
            return parent
    return None
```

- [ ] **Step 4: Point `start.py` at it**
In `beril_cli/start.py`, delete the local `_find_repo_root` def and add `from beril_cli.paths import find_repo_root`; replace the `repo_root = _find_repo_root()` call with `repo_root = find_repo_root()`.

- [ ] **Step 5: Run tests**
Run: `uv run pytest tests/cli/test_paths.py -q`
Expected: PASS (2 passed)

- [ ] **Step 6: Commit**
```bash
git add beril_cli/paths.py beril_cli/start.py tests/cli/test_paths.py
git commit -m "refactor(cli): extract find_repo_root to beril_cli.paths"
```

### Task 0.2: `beril env --json` subcommand

**Files:**
- Create: `beril_cli/env_cmd.py`
- Modify: `beril_cli/cli.py` (subparser + dispatch)
- Test: `tests/cli/test_env_cmd.py`

Wraps `scripts/berdl_env.py --json` (the canonical detector with pproxy auto-recovery; reference §B-env). Re-emits its JSON on stdout per C1.

- [ ] **Step 1: Write the failing test** (mock the underlying detector via subprocess monkeypatch)
```python
# tests/cli/test_env_cmd.py
import json, argparse
from beril_cli import env_cmd

def test_env_emits_json(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(env_cmd, "find_repo_root", lambda: tmp_path)
    fake = {"location": "off-cluster", "ready": True, "checks": {}, "next_steps": []}
    def fake_run(argv, **kw):
        class R: returncode = 0; stdout = json.dumps(fake); stderr = ""
        return R()
    monkeypatch.setattr(env_cmd.subprocess, "run", fake_run)
    rc = env_cmd.run_env(argparse.Namespace(json=True))
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and out["ready"] is True and out["location"] == "off-cluster"
```

- [ ] **Step 2: Run test to verify it fails**
Run: `uv run pytest tests/cli/test_env_cmd.py -q` → FAIL (`ModuleNotFoundError: beril_cli.env_cmd`)

- [ ] **Step 3: Write implementation**
```python
# beril_cli/env_cmd.py
"""beril env — emit BERDL environment readiness as JSON (per the subcommand I/O contract)."""
from __future__ import annotations
import argparse, json, subprocess, sys
from beril_cli.paths import find_repo_root

def run_env(args: argparse.Namespace) -> int:
    root = find_repo_root()
    if root is None:
        print("BERIL repo not found (no PROJECT.md on path).", file=sys.stderr)
        return 2
    script = root / "scripts" / "berdl_env.py"
    proc = subprocess.run(
        [sys.executable, str(script), "--json"],
        cwd=str(root), capture_output=True, text=True, check=False,
    )
    if proc.returncode not in (0, 1):  # detector uses 0/1 for ready/not-ready
        sys.stderr.write(proc.stderr)
        return 2
    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError:
        sys.stderr.write(proc.stdout + proc.stderr)
        return 2
    json.dump(payload, sys.stdout); sys.stdout.write("\n")
    return 0 if payload.get("ready") else 1
```

- [ ] **Step 4: Wire into `cli.py`**
Add under the subparsers block:
```python
    env_parser = sub.add_parser("env", help="Report BERDL environment readiness")
    env_parser.add_argument("--json", action="store_true", default=True, help="Emit JSON (default)")
```
Add to the dispatch if-chain:
```python
    if args.command == "env":
        from beril_cli.env_cmd import run_env
        return run_env(args)
```

- [ ] **Step 5: Run tests**
Run: `uv run pytest tests/cli/test_env_cmd.py -q` → PASS

- [ ] **Step 6: Commit**
```bash
git add beril_cli/env_cmd.py beril_cli/cli.py tests/cli/test_env_cmd.py
git commit -m "feat(cli): add 'beril env --json' readiness subcommand"
```

### Task 0.3: TS scaffold — `package.json`, `tsconfig`, `biome`, install deps

**Files (this repo):** Create `package.json`, `tsconfig.json`, `biome.json`, `.gitignore` (append `node_modules/`, `dist/`).

- [ ] **Step 1: Write `package.json`**
```json
{
  "name": "beril-pi-agent",
  "version": "0.1.0",
  "description": "BERIL Research Observatory workbench for Pi",
  "type": "module",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  },
  "scripts": {
    "check": "tsc --noEmit && biome check .",
    "test": "node --test --experimental-strip-types test/"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-agent-core": "*",
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-tui": "*",
    "typebox": "*"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "typescript": "^5.6.0",
    "@earendil-works/pi-coding-agent": "*",
    "typebox": "*"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
    "strict": true, "noEmit": true, "skipLibCheck": true,
    "esModuleInterop": true, "types": ["node"]
  },
  "include": ["extensions", "lib", "test"]
}
```

- [ ] **Step 3: Write `biome.json`**
```json
{ "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2 },
  "linter": { "enabled": true, "rules": { "recommended": true } } }
```

- [ ] **Step 4: Install + verify toolchain**
Run: `cd beril-pi-agent && bun install`
Expected: installs devDeps incl. `@earendil-works/pi-coding-agent` and `typebox`. Then `bunx tsc --noEmit` → no errors (no source yet).

- [ ] **Step 5: Commit**
```bash
git add package.json tsconfig.json biome.json .gitignore bun.lock
git commit -m "chore: scaffold pi package (manifest, tsconfig, biome, deps)"
```

### Task 0.4: `lib/beril-exec.ts` — typed CLI wrapper

**Files:** Create `lib/beril-exec.ts`, `test/beril-exec.test.ts`.

- [ ] **Step 1: Write the failing test**
```ts
// test/beril-exec.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { berilExec, BerilError } from "../lib/beril-exec.ts";

function fakePi(result: { stdout: string; stderr: string; code: number }) {
  return { exec: async () => ({ ...result, killed: false }) } as any;
}

test("parses JSON stdout on exit 0", async () => {
  const pi = fakePi({ stdout: '{"ready":true}', stderr: "", code: 0 });
  assert.deepEqual(await berilExec(pi, ["env"]), { ready: true });
});

test("throws BerilError on exit 1 with stderr", async () => {
  const pi = fakePi({ stdout: "", stderr: "boom", code: 1 });
  await assert.rejects(() => berilExec(pi, ["query"]), (e: any) =>
    e instanceof BerilError && e.code === 1 && /boom/.test(e.message));
});

test("exit 2 marks usage error", async () => {
  const pi = fakePi({ stdout: "", stderr: "missing token", code: 2 });
  await assert.rejects(() => berilExec(pi, ["env"]), (e: any) => e.code === 2 && e.isUsage === true);
});
```

- [ ] **Step 2: Run to verify fail**
Run: `node --test --experimental-strip-types test/beril-exec.test.ts` → FAIL (module not found)

- [ ] **Step 3: Implement**
```ts
// lib/beril-exec.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export class BerilError extends Error {
  constructor(public code: number, message: string, public stderr = "") {
    super(message);
    this.name = "BerilError";
  }
  get isUsage(): boolean { return this.code === 2; }
}

export interface BerilExecOptions { timeoutMs?: number; signal?: AbortSignal; cwd?: string; }

/** Run `beril <args>` and parse a single JSON value from stdout. Throws BerilError on non-zero exit. */
export async function berilExec<T = unknown>(
  pi: Pick<ExtensionAPI, "exec">, args: string[], opts: BerilExecOptions = {},
): Promise<T> {
  const res = await pi.exec("beril", args, {
    timeout: opts.timeoutMs ?? 120_000, signal: opts.signal, cwd: opts.cwd,
  });
  if (res.code !== 0) {
    const msg = (res.stderr || res.stdout || `beril ${args[0]} exited ${res.code}`).trim();
    throw new BerilError(res.code, msg, res.stderr);
  }
  try {
    return JSON.parse(res.stdout) as T;
  } catch {
    throw new BerilError(0, `beril ${args[0]}: stdout was not JSON: ${res.stdout.slice(0, 200)}`);
  }
}
```

- [ ] **Step 4: Run tests** → PASS (3 passed). Then `bunx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**
```bash
git add lib/beril-exec.ts test/beril-exec.test.ts
git commit -m "feat(lib): typed beril CLI exec wrapper with 0/1/2 exit mapping"
```

### Task 0.5: `lib/readiness.ts` — `requireReady`

**Files:** Create `lib/readiness.ts`, `test/readiness.test.ts`.

- [ ] **Step 1: Failing test**
```ts
// test/readiness.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { requireReady } from "../lib/readiness.ts";

const pi = (env: any) => ({ exec: async () => ({ stdout: JSON.stringify(env), stderr: "", code: env.ready ? 0 : 1, killed: false }) } as any);

test("returns env when ready", async () => {
  const e = await requireReady(pi({ ready: true, location: "off-cluster", checks: {}, next_steps: [] }));
  assert.equal(e.location, "off-cluster");
});

test("throws with next_steps when not ready", async () => {
  await assert.rejects(
    () => requireReady(pi({ ready: false, location: "off-cluster", checks: {}, next_steps: ["start pproxy"] })),
    (err: any) => /start pproxy/.test(err.message));
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**
```ts
// lib/readiness.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { berilExec, BerilError } from "./beril-exec.ts";

export interface BerdlEnv {
  location: "on-cluster" | "off-cluster" | "unknown";
  ready: boolean;
  checks: Record<string, boolean>;
  next_steps: string[];
}

/** Resolve to the readiness report, or throw a guidance error if BERDL is not reachable. */
export async function requireReady(pi: Pick<ExtensionAPI, "exec">): Promise<BerdlEnv> {
  let env: BerdlEnv;
  try {
    env = await berilExec<BerdlEnv>(pi, ["env", "--json"]);
  } catch (e) {
    if (e instanceof BerilError && e.code === 1) env = JSON.parse(e.stderr || "{}");
    else throw e;
  }
  if (!env.ready) {
    throw new Error(
      `BERDL not ready (${env.location}). Next steps:\n- ${(env.next_steps ?? []).join("\n- ")}`,
    );
  }
  return env;
}
```
> Note: `beril env` returns exit 1 when not-ready but still prints JSON to stdout. Adjust `berilExec` usage: call `pi.exec` semantics mean code 1 throws before parsing. To keep readiness JSON on the not-ready path, `requireReady` re-reads it. Implementer: if `berilExec` swallowed stdout, switch `env_cmd.py` to exit 0 always and carry readiness in the payload — pick ONE: **decision: `beril env` exits 0 always, `ready` bool in payload.** Update Task 0.2 Step 3 last line to `return 0` and Task 0.2 test to assert rc==0; update this file's `requireReady` to drop the catch and just check `env.ready`.

- [ ] **Step 4: Apply the decision** (env exits 0 always), simplify `requireReady` to:
```ts
  const env = await berilExec<BerdlEnv>(pi, ["env", "--json"]);
  if (!env.ready) throw new Error(`BERDL not ready (${env.location}). Next steps:\n- ${(env.next_steps ?? []).join("\n- ")}`);
  return env;
```

- [ ] **Step 5: Run tests** (update fake to `code: 0`) → PASS. `tsc --noEmit` clean.

- [ ] **Step 6: Commit**
```bash
git add lib/readiness.ts test/readiness.test.ts
git commit -m "feat(lib): requireReady guard over 'beril env'"
```

### Task 0.6: `extensions/beril-env.ts` — tool + commands + status widget

**Files:** Create `extensions/beril-env.ts`, `test/beril-env.test.ts`.

- [ ] **Step 1: Failing test** (extension registers a tool + two commands; session_start sets a status when hasUI)
```ts
// test/beril-env.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import berilEnv from "../extensions/beril-env.ts";

function harness() {
  const tools: any = {}, commands: any = {}, handlers: any = {};
  const pi: any = {
    registerTool: (t: any) => (tools[t.name] = t),
    registerCommand: (n: string, o: any) => (commands[n] = o),
    on: (e: string, h: any) => (handlers[e] = h),
    exec: async () => ({ stdout: JSON.stringify({ ready: true, location: "off-cluster", checks: {}, next_steps: [] }), stderr: "", code: 0, killed: false }),
  };
  return { pi, tools, commands, handlers };
}

test("registers env tool + connect/status commands + session_start", () => {
  const h = harness(); berilEnv(h.pi);
  assert.ok(h.tools["berdl_env_check"]);
  assert.ok(h.commands["berdl-connect"] && h.commands["berdl-status"]);
  assert.ok(h.handlers["session_start"]);
});

test("session_start sets a status widget when hasUI", async () => {
  const h = harness(); berilEnv(h.pi);
  const set: any[] = [];
  const ctx: any = { hasUI: true, mode: "tui", ui: { setStatus: (k: string, v?: string) => set.push([k, v]) } };
  await h.handlers["session_start"]({ type: "session_start", reason: "startup" }, ctx);
  assert.ok(set.find(([k]) => k === "beril-connection"));
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**
```ts
// extensions/beril-env.ts
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { berilExec } from "../lib/beril-exec.ts";
import type { BerdlEnv } from "../lib/readiness.ts";

const STATUS_KEY = "beril-connection";

function statusLine(env: BerdlEnv, ctx: ExtensionContext): string {
  const ok = env.ready;
  const label = `BERDL ${env.location}${ok ? " ✓ ready" : " ✗ not ready"}`;
  if (!ctx.hasUI) return label;
  const color = ok ? "success" : "warning";
  return ctx.ui.theme.fg(color, label);
}

async function refreshStatus(pi: ExtensionAPI, ctx: ExtensionContext): Promise<BerdlEnv | undefined> {
  if (!ctx.hasUI) return undefined;
  try {
    const env = await berilExec<BerdlEnv>(pi, ["env", "--json"]);
    ctx.ui.setStatus(STATUS_KEY, statusLine(env, ctx));
    return env;
  } catch (e) {
    ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("error", "BERDL status unknown"));
    return undefined;
  }
}

export default function berilEnv(pi: ExtensionAPI) {
  pi.registerTool({
    name: "berdl_env_check",
    label: "Check BERDL environment",
    description: "Report whether the BERDL connection (on/off-cluster, tunnels, pproxy, token) is ready, with next steps.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, _ctx) {
      const env = await berilExec<BerdlEnv>(pi, ["env", "--json"]);
      const text = `BERDL ${env.location}: ${env.ready ? "ready" : "NOT ready"}`
        + (env.next_steps?.length ? `\nNext steps:\n- ${env.next_steps.join("\n- ")}` : "");
      return { content: [{ type: "text", text }], details: env };
    },
  });

  pi.registerCommand("berdl-connect", {
    description: "Check the BERDL connection and (re)start pproxy if tunnels are up.",
    async handler(_args: string, ctx: ExtensionContext) {
      const env = await refreshStatus(pi, ctx);
      if (ctx.hasUI) ctx.ui.notify(env?.ready ? "BERDL ready." : "BERDL not ready — see next steps.", env?.ready ? "info" : "warning");
    },
  });

  pi.registerCommand("berdl-status", {
    description: "Refresh the BERDL connection status indicator.",
    async handler(_args: string, ctx: ExtensionContext) { await refreshStatus(pi, ctx); },
  });

  pi.on("session_start", async (_event, ctx) => { await refreshStatus(pi, ctx); });
  pi.on("session_shutdown", (_event, ctx) => { if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined); });
}
```

- [ ] **Step 4: Run tests** → PASS. `tsc --noEmit` clean.

- [ ] **Step 5: Commit**
```bash
git add extensions/beril-env.ts test/beril-env.test.ts
git commit -m "feat(ext): beril-env connection tool, commands, and status widget"
```

### Task 0.7: `beril start --agent pi`

**Files:** Modify `beril_cli/cli.py` (add `"pi"` to `--agent` choices), `beril_cli/start.py` (pi branch). Test: `tests/cli/test_start_pi.py`.

- [ ] **Step 1: Failing test** (pi path execs `pi`, no Vertex env, no `/berdl_start` injection)
```python
# tests/cli/test_start_pi.py
import beril_cli.start as start

def test_pi_launch_execs_pi(monkeypatch, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(start, "find_repo_root", lambda: tmp_path)
    monkeypatch.setattr(start.shutil, "which", lambda a: f"/usr/bin/{a}")
    monkeypatch.setattr(start, "_checkout_release", lambda root, v: 0)
    monkeypatch.setattr(start, "_sync_auth_token", lambda p: None)
    monkeypatch.setattr(start, "print_jupyterhub_path_hint", lambda r: None)
    monkeypatch.chdir(tmp_path)
    captured = {}
    def fake_execvp(binary, argv): captured["binary"] = binary; captured["argv"] = argv; raise SystemExit(0)
    monkeypatch.setattr(start.os, "execvp", fake_execvp)
    try:
        start.run_start(agent="pi", extra_args=[])
    except SystemExit:
        pass
    assert captured["argv"][0] == "pi"
    assert "/berdl_start" not in captured["argv"]   # onboarding handled by the extension
    assert "--model" not in captured["argv"]         # no claude opus default
```

- [ ] **Step 2: Run → FAIL** (pi not allowed / Vertex+model injected).

- [ ] **Step 3: Implement**
In `cli.py`, change `choices=["claude", "codex", "gemini"]` → `choices=["claude", "codex", "gemini", "pi"]`.
In `start.py`, wrap the Claude-only blocks so they don't run for `pi`. The existing `if agent == "claude":` guards already exclude pi from Vertex + `--model opus`. Add, right before `# Auto-run the onboarding skill`:
```python
    # Pi handles onboarding + status via the beril-env extension's session_start hook,
    # so we do NOT inject /berdl_start for pi.
    if agent == "pi":
        skip_onboard = True
```
(That single guard is sufficient because the Vertex/model blocks are already `agent == "claude"`-gated.)

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**
```bash
git add beril_cli/cli.py beril_cli/start.py tests/cli/test_start_pi.py
git commit -m "feat(cli): support 'beril start --agent pi' (extension-driven onboarding)"
```

### Task 0.8: Phase-0 manual verification + register extension locally

- [ ] **Step 1:** From `beril-pi-agent/`: `pi install -l .` (project-local install) — confirm `pi list` shows the package and `beril-env` extension.
- [ ] **Step 2:** Off-cluster, run `beril env --json` directly → JSON with `ready`/`location`/`next_steps`. (If not connected, expect `ready:false` + tunnel/pproxy steps — that is correct.)
- [ ] **Step 3:** `beril start --agent pi` from inside the BERIL repo → Pi launches; the footer shows `BERDL off-cluster ✓ ready` or `✗ not ready`.
- [ ] **Step 4:** In Pi, run `/berdl-status` → status refreshes; ask the model to "check the BERDL environment" → it calls `berdl_env_check`.
- [ ] **Step 5:** Record results in `docs/superpowers/plans/phase-notes.md` (create) and commit that note.

---

# PHASE 1 — Query

Goal: bounded `berdl_query`/`berdl_discover` from Pi; safety-gate skeleton in place. Verify: a SELECT runs end-to-end and renders a table.

### Task 1.1: `beril query` subcommand (wraps `run_sql.py`, JSON via temp file)

**Files:** Create `beril_cli/query_cmd.py`; modify `cli.py`; Test `tests/cli/test_query_cmd.py`.

- [ ] **Step 1: Failing test**
```python
# tests/cli/test_query_cmd.py
import json, argparse
from beril_cli import query_cmd

def test_query_emits_payload_json(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x"); (tmp_path / "scripts").mkdir()
    monkeypatch.setattr(query_cmd, "find_repo_root", lambda: tmp_path)
    payload = {"returned_rows": 2, "rows": [{"a": 1}, {"a": 2}], "limit_applied": 100}
    def fake_run(argv, **kw):
        # run_sql writes JSON to the --output path
        out = argv[argv.index("--output") + 1]
        from pathlib import Path; Path(out).write_text(json.dumps(payload))
        class R: returncode = 0; stdout = "Wrote 2 rows"; stderr = "[hub] noise"
        return R()
    monkeypatch.setattr(query_cmd.subprocess, "run", fake_run)
    rc = query_cmd.run_query(argparse.Namespace(query="SELECT 1", limit=100, proxy=True))
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and out["returned_rows"] == 2 and out["rows"][0]["a"] == 1
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** (route JSON to temp file, re-emit clean to stdout — per C1)
```python
# beril_cli/query_cmd.py
"""beril query — run a bounded read-only SQL query and emit the result payload as JSON."""
from __future__ import annotations
import argparse, json, subprocess, sys, tempfile
from pathlib import Path
from beril_cli.paths import find_repo_root

def run_query(args: argparse.Namespace) -> int:
    root = find_repo_root()
    if root is None:
        print("BERIL repo not found (no PROJECT.md on path).", file=sys.stderr); return 2
    script = root / "scripts" / "run_sql.py"
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "result.json"
        argv = ["uv", "run", str(script), "--query", args.query,
                "--limit", str(args.limit), "--output", str(out)]
        if getattr(args, "proxy", True):
            argv.append("--berdl-proxy")
        proc = subprocess.run(argv, cwd=str(root), capture_output=True, text=True, check=False)
        if proc.returncode != 0:
            sys.stderr.write(proc.stderr or proc.stdout)
            return proc.returncode if proc.returncode in (1, 2) else 1
        try:
            payload = json.loads(out.read_text())
        except (OSError, json.JSONDecodeError) as exc:
            print(f"query produced no JSON output: {exc}", file=sys.stderr); return 1
    json.dump(payload, sys.stdout, default=str); sys.stdout.write("\n")
    return 0
```

- [ ] **Step 4: Wire `cli.py`**
```python
    query_parser = sub.add_parser("query", help="Run a bounded read-only SQL query")
    query_parser.add_argument("--query", required=True)
    query_parser.add_argument("--limit", type=int, default=100)
    query_parser.add_argument("--no-proxy", dest="proxy", action="store_false", default=True)
```
```python
    if args.command == "query":
        from beril_cli.query_cmd import run_query
        return run_query(args)
```

- [ ] **Step 5: Run tests** → PASS.

- [ ] **Step 6: Commit**
```bash
git add beril_cli/query_cmd.py beril_cli/cli.py tests/cli/test_query_cmd.py
git commit -m "feat(cli): add 'beril query' (bounded SQL, clean JSON stdout)"
```

### Task 1.2: `beril discover` subcommand (wraps `discover_berdl_collections.py`)

**Files:** Create `beril_cli/discover_cmd.py`; modify `cli.py`; Test `tests/cli/test_discover_cmd.py`.

- [ ] **Step 1: Failing test** — `discover` writes a snapshot file; the subcommand reads it and emits the snapshot JSON to stdout.
```python
# tests/cli/test_discover_cmd.py
import json, argparse
from beril_cli import discover_cmd
def test_discover_emits_snapshot(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(discover_cmd, "find_repo_root", lambda: tmp_path)
    snap = {"databases": [{"name": "db1"}]}
    def fake_run(argv, **kw):
        out = argv[argv.index("--output") + 1]
        from pathlib import Path; Path(out).write_text(json.dumps(snap))
        class R: returncode = 0; stdout = "Discovered 1 database"; stderr = ""
        return R()
    monkeypatch.setattr(discover_cmd.subprocess, "run", fake_run)
    rc = discover_cmd.run_discover(argparse.Namespace(max_databases=None))
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and out["databases"][0]["name"] == "db1"
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** (per C5; argv = `["uv","run",str(script),"--output",tmp]`, optional `--max-databases`; read tmp; emit JSON).
- [ ] **Step 4: Wire `cli.py`** (`discover` subparser with `--max-databases` int optional; dispatch).
- [ ] **Step 5: Run tests** → PASS.
- [ ] **Step 6: Commit** `feat(cli): add 'beril discover' (access-aware introspection JSON)`

### Task 1.3: `lib/destructive.ts` + `extensions/beril-safety.ts` (skeleton)

**Files:** Create `lib/destructive.ts`, `extensions/beril-safety.ts`, `test/beril-safety.test.ts`.

- [ ] **Step 1: Failing test**
```ts
// test/beril-safety.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import berilSafety from "../extensions/beril-safety.ts";

function harness() {
  const handlers: any = {};
  const pi: any = { on: (e: string, h: any) => (handlers[e] = h) };
  return { pi, handlers };
}
const ctx = (hasUI: boolean, confirm: boolean) => ({ hasUI, ui: { confirm: async () => confirm } } as any);

test("blocks destructive tool when user declines", async () => {
  const h = harness(); berilSafety(h.pi);
  const r = await h.handlers["tool_call"]({ type: "tool_call", toolName: "berdl_export", input: {} }, ctx(true, false));
  assert.deepEqual(r, { block: true, reason: "User declined berdl_export" });
});

test("allows destructive tool when user confirms", async () => {
  const h = harness(); berilSafety(h.pi);
  const r = await h.handlers["tool_call"]({ type: "tool_call", toolName: "berdl_export", input: {} }, ctx(true, true));
  assert.equal(r, undefined);
});

test("auto-denies destructive tool with no UI", async () => {
  const h = harness(); berilSafety(h.pi);
  const r = await h.handlers["tool_call"]({ type: "tool_call", toolName: "lakehouse_submit", input: {} }, ctx(false, true));
  assert.equal(r?.block, true);
});

test("ignores non-destructive tools", async () => {
  const h = harness(); berilSafety(h.pi);
  const r = await h.handlers["tool_call"]({ type: "tool_call", toolName: "berdl_query", input: {} }, ctx(true, false));
  assert.equal(r, undefined);
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement**
```ts
// lib/destructive.ts
/** Custom tools that mutate remote state irreversibly. */
export const DESTRUCTIVE_TOOLS = new Set(["berdl_export", "lakehouse_submit"]);

/** Bash command fragments we treat as destructive when run via the built-in bash tool. */
const DESTRUCTIVE_BASH = [/\bmc\s+rm\b/, /\brm\s+-rf\b/, /--recursive\s+--force/];

export function isDestructive(toolName: string, input: Record<string, unknown>): boolean {
  if (DESTRUCTIVE_TOOLS.has(toolName)) return true;
  if (toolName === "bash" && typeof input.command === "string") {
    return DESTRUCTIVE_BASH.some((re) => re.test(input.command as string));
  }
  return false;
}
```
```ts
// extensions/beril-safety.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isDestructive } from "../lib/destructive.ts";

export default function berilSafety(pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    const toolName = (event as any).toolName as string | undefined;
    const input = ((event as any).input ?? {}) as Record<string, unknown>;
    if (!toolName || !isDestructive(toolName, input)) return undefined;
    if (!ctx.hasUI) return { block: true, reason: `Destructive tool ${toolName} blocked in non-interactive mode` };
    const ok = await ctx.ui.confirm(`Allow ${toolName}?`, `This will irreversibly modify remote data. Proceed?`);
    return ok ? undefined : { block: true, reason: `User declined ${toolName}` };
  });
}
```

- [ ] **Step 4: Run tests** → PASS. `tsc --noEmit` clean.
- [ ] **Step 5: Commit** `feat(ext): central destructive-action gate (tool_call → confirm)`

### Task 1.4: `lib/render.ts` + `extensions/beril-data.ts` (`berdl_query`, `berdl_discover`)

**Files:** Create `lib/render.ts`, `extensions/beril-data.ts`, `test/beril-data.test.ts`.

- [ ] **Step 1: Failing test** — registers `berdl_query`/`berdl_discover`; query tool calls `requireReady` then `beril query` and returns rows in `details`.
```ts
// test/beril-data.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import berilData from "../extensions/beril-data.ts";

function harness(execImpl: any) {
  const tools: any = {};
  const pi: any = { registerTool: (t: any) => (tools[t.name] = t), exec: execImpl };
  berilData(pi); return tools;
}
const ctx: any = { hasUI: false, mode: "json" };

test("berdl_query returns rows after readiness check", async () => {
  const calls: string[][] = [];
  const tools = harness(async (_c: string, args: string[]) => {
    calls.push(args);
    if (args[0] === "env") return { stdout: JSON.stringify({ ready: true, location: "off-cluster", checks: {}, next_steps: [] }), stderr: "", code: 0, killed: false };
    return { stdout: JSON.stringify({ returned_rows: 1, rows: [{ a: 1 }], limit_applied: 100 }), stderr: "", code: 0, killed: false };
  });
  const res = await tools["berdl_query"].execute("id", { query: "SELECT 1", limit: 100 }, undefined, undefined, ctx);
  assert.equal((res.details as any).returned_rows, 1);
  assert.deepEqual(calls[0], ["env", "--json"]);          // readiness first
  assert.equal(calls[1][0], "query");
});

test("berdl_query throws guidance when not ready", async () => {
  const tools = harness(async () => ({ stdout: JSON.stringify({ ready: false, location: "off-cluster", checks: {}, next_steps: ["start pproxy"] }), stderr: "", code: 0, killed: false }));
  await assert.rejects(() => tools["berdl_query"].execute("id", { query: "SELECT 1", limit: 100 }, undefined, undefined, ctx), /start pproxy/);
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement render + data**
```ts
// lib/render.ts
/** Render up to `maxRows` of tabular data as a monospace text block. Pure; UI-agnostic. */
export function renderTable(rows: Record<string, unknown>[], maxRows = 20): string {
  if (rows.length === 0) return "(0 rows)";
  const cols = Object.keys(rows[0]);
  const head = cols.join(" | ");
  const body = rows.slice(0, maxRows).map((r) => cols.map((c) => String(r[c] ?? "")).join(" | "));
  const more = rows.length > maxRows ? `\n… ${rows.length - maxRows} more rows` : "";
  return [head, cols.map(() => "---").join(" | "), ...body].join("\n") + more;
}
```
```ts
// extensions/beril-data.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { berilExec } from "../lib/beril-exec.ts";
import { requireReady } from "../lib/readiness.ts";
import { renderTable } from "../lib/render.ts";

interface QueryPayload { returned_rows: number; rows: Record<string, unknown>[]; limit_applied: number | null; }

export default function berilData(pi: ExtensionAPI) {
  pi.registerTool({
    name: "berdl_query",
    label: "Query BERDL",
    description: "Run a bounded, read-only SQL SELECT against the BERDL lakehouse. Returns up to `limit` rows (default 100).",
    parameters: Type.Object({
      query: Type.String({ description: "A single read-only SQL statement." }),
      limit: Type.Optional(Type.Integer({ description: "Row cap (default 100; -1 disables).", default: 100 })),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      await requireReady(pi);
      const limit = params.limit ?? 100;
      const payload = await berilExec<QueryPayload>(pi, ["query", "--query", params.query, "--limit", String(limit)]);
      const text = `${payload.returned_rows} row(s)` + (payload.limit_applied != null ? ` (limit ${payload.limit_applied})` : "")
        + `\n${renderTable(payload.rows)}`;
      return { content: [{ type: "text", text }], details: payload };
    },
  });

  pi.registerTool({
    name: "berdl_discover",
    label: "Discover BERDL collections",
    description: "List accessible BERDL databases/collections (access-aware). Use before querying to find tables.",
    parameters: Type.Object({
      max_databases: Type.Optional(Type.Integer({ description: "Cap databases scanned." })),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      await requireReady(pi);
      const args = ["discover"];
      if (params.max_databases != null) args.push("--max-databases", String(params.max_databases));
      const snap = await berilExec<Record<string, unknown>>(pi, args);
      return { content: [{ type: "text", text: JSON.stringify(snap, null, 2) }], details: snap };
    },
  });
}
```

- [ ] **Step 4: Run tests** → PASS. `tsc --noEmit` clean.
- [ ] **Step 5: Commit** `feat(ext): beril-data berdl_query + berdl_discover tools`

### Task 1.5: Phase-1 verification
- [ ] Reinstall package (`pi install -l .`), enable `beril-data` + `beril-safety`. In Pi: "discover BERDL collections" → `berdl_discover`; "query the first 5 rows of <table>" → `berdl_query` renders a table. Try an `export` (next phase) to confirm the safety gate prompts. Append results to `phase-notes.md`; commit.

---

# PHASE 2 — Governance core (the lift)

Goal: build `beril lifecycle` (state machine), `beril hash`, guarded `berdl_export`, and the `/synthesize` `/berdl-review` `/submit` commands with the ORCID gate. This is the riskiest, most-tested phase.

### Task 2.1: `beril_cli/lifecycle.py` — state-machine core (pure, no I/O)

**Files:** Create `beril_cli/lifecycle.py`, `tests/cli/test_lifecycle_core.py`.

The state machine (reference §B4): `exploration → proposed → active → analysis → reviewed → complete`; demotes `reviewed→analysis`, `complete→analysis`.

- [ ] **Step 1: Failing test**
```python
# tests/cli/test_lifecycle_core.py
import pytest
from beril_cli.lifecycle import next_state, LifecycleError, FORWARD, can_transition

@pytest.mark.parametrize("frm,to", [
    ("exploration","proposed"), ("proposed","active"), ("active","analysis"),
    ("analysis","reviewed"), ("reviewed","complete"),
])
def test_legal_forward(frm, to):
    assert next_state(frm, to) == to

@pytest.mark.parametrize("frm,to", [("reviewed","analysis"), ("complete","analysis")])
def test_legal_demote(frm, to):
    assert next_state(frm, to) == to

@pytest.mark.parametrize("frm,to", [("exploration","complete"), ("active","reviewed"), ("complete","reviewed")])
def test_illegal_rejected(frm, to):
    with pytest.raises(LifecycleError):
        next_state(frm, to)

def test_unknown_state_rejected():
    with pytest.raises(LifecycleError):
        next_state("active", "bogus")
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement**
```python
# beril_cli/lifecycle.py
"""BERIL project lifecycle state machine (pure transitions; persistence in lifecycle_cmd)."""
from __future__ import annotations

STATES = ("exploration", "proposed", "active", "analysis", "reviewed", "complete")
FORWARD = {
    "exploration": "proposed", "proposed": "active", "active": "analysis",
    "analysis": "reviewed", "reviewed": "complete",
}
DEMOTE = {"reviewed": "analysis", "complete": "analysis"}

class LifecycleError(ValueError):
    """Raised on an illegal lifecycle transition."""

def can_transition(frm: str, to: str) -> bool:
    return FORWARD.get(frm) == to or DEMOTE.get(frm) == to

def next_state(frm: str, to: str) -> str:
    if frm not in STATES:
        raise LifecycleError(f"unknown current state: {frm!r}")
    if to not in STATES:
        raise LifecycleError(f"unknown target state: {to!r}")
    if not can_transition(frm, to):
        raise LifecycleError(f"illegal transition {frm} → {to}")
    return to
```

- [ ] **Step 4: Run tests** → PASS.
- [ ] **Step 5: Commit** `feat(cli): lifecycle state-machine core with legal/illegal transitions`

### Task 2.2: `beril.yaml` read/write + canonical serializer

**Files:** Modify `beril_cli/lifecycle.py` (add `load_project`/`save_project`/`set_status`); Test `tests/cli/test_lifecycle_io.py`.

- [ ] **Step 1: Failing test**
```python
# tests/cli/test_lifecycle_io.py
from pathlib import Path
from beril_cli.lifecycle import load_project, save_project, set_status, LifecycleError
import pytest

def write_yaml(d: Path, status="active"):
    (d / "beril.yaml").write_text(
        f'project_id: demo\nstatus: {status}\nbranch: projects/demo\nengine:\n  name: pi\n'
        'authors:\n  - name: "A"\n    affiliation: "LBL"\n    orcid: "0000-0001-0000-0000"\n'
        'artifacts:\n  readme: true\n  research_plan: true\n  report: false\n  review: false\n')

def test_round_trip(tmp_path):
    write_yaml(tmp_path)
    proj = load_project(tmp_path)
    assert proj["status"] == "active" and proj["project_id"] == "demo"
    proj["status"] = "analysis"; save_project(tmp_path, proj)
    assert load_project(tmp_path)["status"] == "analysis"

def test_set_status_enforces_machine(tmp_path):
    write_yaml(tmp_path, status="active")
    set_status(tmp_path, "analysis")            # legal
    assert load_project(tmp_path)["status"] == "analysis"
    with pytest.raises(LifecycleError):
        set_status(tmp_path, "complete")        # illegal from analysis
```

- [ ] **Step 2: Run → FAIL** (functions missing; also needs a YAML lib — use `ruamel.yaml` or stdlib? BERIL CLI is stdlib-only).
- [ ] **Step 3: Implement** — keep stdlib-only with a **minimal flow-YAML** load via `tomllib`? No. Decision: add `pyyaml` as a test+runtime dep for the lifecycle module only (the rest of beril_cli stays stdlib). Add to `pyproject.toml` `dependencies = ["pyyaml>=6"]`.
```python
# append to beril_cli/lifecycle.py
from pathlib import Path
from typing import Any
import yaml

def load_project(project_dir: Path) -> dict[str, Any]:
    path = Path(project_dir) / "beril.yaml"
    if not path.exists():
        raise LifecycleError(f"no beril.yaml in {project_dir}")
    return yaml.safe_load(path.read_text()) or {}

# Canonical key order keeps diffs stable across writes.
_KEY_ORDER = ["project_id", "status", "created_at", "last_session_at", "branch",
              "engine", "authors", "artifacts", "approval", "previous_approvals", "submissions"]

def save_project(project_dir: Path, proj: dict[str, Any]) -> None:
    ordered = {k: proj[k] for k in _KEY_ORDER if k in proj}
    for k, v in proj.items():
        if k not in ordered:
            ordered[k] = v
    (Path(project_dir) / "beril.yaml").write_text(
        yaml.safe_dump(ordered, sort_keys=False, default_flow_style=False, allow_unicode=True))

def set_status(project_dir: Path, to: str) -> str:
    proj = load_project(project_dir)
    proj["status"] = next_state(proj.get("status", ""), to)
    save_project(project_dir, proj)
    return proj["status"]
```

- [ ] **Step 4: Run tests** → PASS.
- [ ] **Step 5: Commit** `feat(cli): beril.yaml load/save + machine-enforced set_status`

### Task 2.3: `beril hash` subcommand (wraps `notebook_hash.py`)

**Files:** Create `beril_cli/hash_cmd.py`; modify `cli.py`; Test `tests/cli/test_hash_cmd.py`.

- [ ] **Step 1: Failing test** — `beril hash <project>` shells `notebook_hash.py compute-hashes` and re-emits its single-line JSON (already `sha256:`-prefixed) to stdout.
```python
# tests/cli/test_hash_cmd.py
import json, argparse
from beril_cli import hash_cmd
def test_hash_passthrough(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(hash_cmd, "find_repo_root", lambda: tmp_path)
    hashes = {"notebooks/01.ipynb": "sha256:" + "a"*64}
    def fake_run(argv, **kw):
        class R: returncode = 0; stdout = json.dumps(hashes); stderr = ""
        return R()
    monkeypatch.setattr(hash_cmd.subprocess, "run", fake_run)
    rc = hash_cmd.run_hash(argparse.Namespace(project="demo"))
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and out["notebooks/01.ipynb"].startswith("sha256:")
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** (per C5; argv `[sys.executable, str(root/"tools"/"notebook_hash.py"), "compute-hashes", str(project_dir)]`; passthrough stdout JSON; map exit 0/1/2).
- [ ] **Step 4: Wire `cli.py`** (`hash` subparser, positional `project`).
- [ ] **Step 5: Run tests** → PASS.
- [ ] **Step 6: Commit** `feat(cli): add 'beril hash' notebook-hash passthrough`

### Task 2.4: `beril export` subcommand (DESTRUCTIVE; wraps `export_sql.py`)

**Files:** Create `beril_cli/export_cmd.py`; modify `cli.py`; Test `tests/cli/test_export_cmd.py`.

- [ ] **Step 1: Failing test** — passes `--path`/`--format`/`--mode`; emits the manifest JSON; maps exit codes.
```python
# tests/cli/test_export_cmd.py
import json, argparse
from beril_cli import export_cmd
def test_export_emits_manifest(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(export_cmd, "find_repo_root", lambda: tmp_path)
    manifest = {"path": "s3a://x/y", "format": "parquet", "mode": "overwrite", "count": 10}
    def fake_run(argv, **kw):
        out = argv[argv.index("--manifest") + 1]
        from pathlib import Path; Path(out).write_text(json.dumps(manifest))
        class R: returncode = 0; stdout = "[hub] noise"; stderr = ""
        return R()
    monkeypatch.setattr(export_cmd.subprocess, "run", fake_run)
    rc = export_cmd.run_export(argparse.Namespace(query="SELECT 1", path="s3a://x/y", format="parquet", mode="overwrite", proxy=True))
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and out["mode"] == "overwrite" and out["count"] == 10
```

- [ ] **Step 2–6:** Implement (route `--manifest` to temp file; argv includes `--query/--path/--format/--mode` + `--berdl-proxy`); wire `cli.py` (`export` subparser: `--query` req, `--path` req, `--format` default parquet, `--mode` default overwrite, `--no-proxy`); test PASS; commit `feat(cli): add 'beril export' (destructive MinIO write, manifest JSON)`.

### Task 2.5: `beril user`/`review`/`submit` subcommands

`beril user --json` already exists. Add `beril review` (wraps `tools/review.sh`) and `beril submit` (wraps `tools/lakehouse_upload.py`, 0/1/2 with **2=partial=failure**).

- [ ] **Task 2.5a `beril review`:** Create `beril_cli/review_cmd.py`; wraps `tools/review.sh <project> --type --reviewer --model`; emits JSON `{review_file, report_hash}` parsed from review.sh output (review.sh writes `REVIEW_N.md`; the subcommand returns its path + the footer hash). Test with a fake `subprocess.run` returning a known review path; assert JSON. Wire `cli.py`. Commit.
- [ ] **Task 2.5b `beril submit`:** Create `beril_cli/submit_cmd.py`; wraps `tools/lakehouse_upload.py <project>`; **map child exit 2 → emit success JSON + `"partial": true` and return 2**; exit 1 → stderr only, return 1; exit 0 → manifest JSON, return 0. Test all three exit paths with fake `subprocess.run`. Wire `cli.py`. Commit `feat(cli): add 'beril review' + 'beril submit' (2=partial=failure)`.

### Task 2.6: `beril lifecycle` subcommand (commands the engine)

**Files:** Create `beril_cli/lifecycle_cmd.py`; modify `cli.py`; Test `tests/cli/test_lifecycle_cmd.py`.

Exposes: `beril lifecycle status <project>` (emit current `beril.yaml` as JSON), `beril lifecycle set <project> <state>` (machine-checked transition; emit new status JSON), `beril lifecycle approve <project> --orcid --report-hash --review --review-hash` (write the `approval` block; verified key order), `beril lifecycle marker <project> --kind submitted|failed`.

- [ ] **Step 1: Failing test**
```python
# tests/cli/test_lifecycle_cmd.py
import json, argparse
from beril_cli import lifecycle_cmd

def _proj(tmp_path, status="analysis"):
    d = tmp_path / "projects" / "demo"; d.mkdir(parents=True)
    (d / "beril.yaml").write_text(f"project_id: demo\nstatus: {status}\nengine:\n  name: pi\n")
    return d

def test_set_emits_new_status(monkeypatch, capsys, tmp_path):
    d = _proj(tmp_path, "analysis")
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(argparse.Namespace(action="set", project="demo", state="reviewed"))
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and out["status"] == "reviewed"

def test_illegal_set_returns_2(monkeypatch, capsys, tmp_path):
    _proj(tmp_path, "analysis")
    monkeypatch.setattr(lifecycle_cmd, "find_repo_root", lambda: tmp_path)
    rc = lifecycle_cmd.run_lifecycle(argparse.Namespace(action="set", project="demo", state="complete"))
    assert rc == 2  # LifecycleError → usage error
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** (resolve `root/"projects"/project`; dispatch on `args.action`; catch `LifecycleError` → print to stderr, return 2; `status`/`set` emit JSON per C1; `approve`/`marker` write files).
- [ ] **Step 4: Wire `cli.py`** (`lifecycle` subparser with `action` positional `{status,set,approve,marker}`, `project` positional, optional `state`, `--orcid`, `--report-hash`, `--review`, `--review-hash`, `--kind`).
- [ ] **Step 5: Run tests** → PASS.
- [ ] **Step 6: Commit** `feat(cli): add 'beril lifecycle' (status/set/approve/marker)`

### Task 2.7: `extensions/beril-governance.ts` — tools

**Files:** Create `extensions/beril-governance.ts`, `test/beril-governance.test.ts`.

Tools: `notebook_hash`→`beril hash`; `lifecycle_transition`→`beril lifecycle set`; `beril_user`→`beril user --json`; `lakehouse_submit`→`beril submit` (destructive; gated by beril-safety).

- [ ] **Step 1: Failing test** (each tool registers; `beril_user` returns identity; `lakehouse_submit` is in the destructive set so the safety gate guards it — assert the tool simply shells `submit` and surfaces partial as error).
```ts
// test/beril-governance.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import berilGov from "../extensions/beril-governance.ts";
function harness(execImpl: any) {
  const tools: any = {}, commands: any = {};
  const pi: any = { registerTool: (t: any) => (tools[t.name] = t), registerCommand: (n: string, o: any) => (commands[n] = o), exec: execImpl, on: () => {} };
  berilGov(pi); return { tools, commands };
}
const ctx: any = { hasUI: false, mode: "json" };

test("beril_user returns identity", async () => {
  const { tools } = harness(async () => ({ stdout: JSON.stringify({ name: "A", affiliation: "LBL", orcid: "0000" }), stderr: "", code: 0, killed: false }));
  const r = await tools["beril_user"].execute("id", {}, undefined, undefined, ctx);
  assert.equal((r.details as any).orcid, "0000");
});

test("lakehouse_submit throws on partial (exit 2)", async () => {
  const { tools } = harness(async () => ({ stdout: JSON.stringify({ partial: true }), stderr: "partial archive", code: 2, killed: false }));
  await assert.rejects(() => tools["lakehouse_submit"].execute("id", { project: "demo" }, undefined, undefined, ctx));
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** the four tools (params via `Type.Object`; `notebook_hash` param `project`; `lifecycle_transition` params `project`,`state` via `StringEnum` of the 6 states; `beril_user` no params; `lakehouse_submit` param `project`). Each `await requireReady(pi)` where it touches BERDL (`lakehouse_submit` yes; `notebook_hash`/`beril_user`/`lifecycle_transition` no). Let `berilExec` throw on non-zero (covers the partial=2 case).
- [ ] **Step 4: Run tests** → PASS. `tsc --noEmit` clean.
- [ ] **Step 5: Commit** `feat(ext): beril-governance tools (hash, lifecycle, user, submit)`

### Task 2.8: Governance commands `/synthesize` `/berdl-review` `/submit`

**Files:** Modify `extensions/beril-governance.ts`; extend `test/beril-governance.test.ts`.

Each command orchestrates tools + references the matching skill. `/submit` enforces the ORCID gate before the destructive upload.

- [ ] **Step 1: Failing test** — `/submit` aborts (no upload) when `beril_user` reports an empty ORCID.
```ts
test("/submit aborts when ORCID missing", async () => {
  const calls: string[][] = [];
  const { commands } = harness(async (_c: string, args: string[]) => {
    calls.push(args);
    if (args[0] === "user") return { stdout: JSON.stringify({ name: "A", affiliation: "LBL", orcid: "" }), stderr: "", code: 1, killed: false };
    return { stdout: "{}", stderr: "", code: 0, killed: false };
  });
  const notes: string[] = [];
  const cctx: any = { hasUI: true, mode: "tui", ui: { notify: (m: string) => notes.push(m), confirm: async () => true } };
  await commands["submit"].handler("demo", cctx);
  assert.ok(!calls.find((a) => a[0] === "submit"));            // never reached upload
  assert.ok(notes.join(" ").match(/ORCID/i));
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** the three `registerCommand`s. `/submit` handler: `beril user --json` (exit≠0 or empty orcid → notify + abort) → `beril hash` (record) → call `lakehouse_submit` tool path via `berilExec(["submit","--project",p])` (safety gate still applies to the model-tool path; for the command path, confirm inline when `hasUI`) → on success `beril lifecycle marker --kind submitted`. `/synthesize`: guide via skill + `lifecycle set <p> analysis`. `/berdl-review`: `beril review <p>` + `lifecycle set <p> reviewed`.
- [ ] **Step 4: Run tests** → PASS.
- [ ] **Step 5: Commit** `feat(ext): /synthesize /berdl-review /submit commands with ORCID gate`

### Task 2.9: Phase-2 verification (end-to-end lifecycle on a scratch project)
- [ ] Create a throwaway `projects/_smoke/beril.yaml` (`status: active`). In Pi: drive `active → analysis` (`/synthesize`), `analysis → reviewed` (`/berdl-review`, mock reviewer), attempt `/submit` with empty ORCID (must abort), set ORCID via `beril setup`, retry `/submit` (mock `lakehouse_upload`), confirm `SUBMITTED.md` + `submissions[]`. Confirm the safety gate prompts on `berdl_export`. Append to `phase-notes.md`; commit; delete the scratch project.

---

# PHASE 3 — Literature

Goal: `beril lit search|fetch` (direct PubMed/Semantic Scholar HTTP) + `lit_search`/`lit_fetch` tools + `/literature-review` with sub-agent fan-out → `references.md`.

### Task 3.1: `beril_cli/lit_client.py` — HTTP client (mocked tests)

**Files:** Create `beril_cli/lit_client.py`, `tests/cli/test_lit_client.py`. Add `httpx` to deps (per global pref httpx > requests).

- [ ] **Step 1: Failing test** (mock httpx; `search_pubmed` builds esearch+esummary, returns normalized records).
```python
# tests/cli/test_lit_client.py
from beril_cli.lit_client import normalize_pubmed_summary
def test_normalize_pubmed():
    raw = {"uid": "123", "title": "X", "fulljournalname": "J", "pubdate": "2024", "authors": [{"name": "Doe J"}]}
    rec = normalize_pubmed_summary(raw)
    assert rec == {"pmid": "123", "title": "X", "journal": "J", "year": "2024", "authors": ["Doe J"]}
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `normalize_pubmed_summary` (pure) first; then `search_pubmed(query, retmax)`/`fetch_article(pmid)` using `httpx` against E-utilities (`esearch.fcgi`/`esummary.fcgi`/`efetch.fcgi`). Keep network functions thin; unit-test only the pure normalizer + URL builder.
- [ ] **Step 4: Run tests** → PASS.
- [ ] **Step 5: Commit** `feat(cli): PubMed/Semantic Scholar lit client (pure normalizers tested)`

### Task 3.2: `beril lit search|fetch` subcommands
- [ ] Create `beril_cli/lit_cmd.py` with `run_lit(args)` dispatching `search`(`--query`,`--max`) → JSON list of records; `fetch`(`--pmid`) → JSON record. Emit JSON per C1; map errors to exit 1/2. Mocked test asserting JSON shape. Wire `cli.py` (`lit` subparser with `action` `{search,fetch}`). Commit `feat(cli): add 'beril lit search|fetch'`.

### Task 3.3: `extensions/beril-literature.ts` — tools + `/literature-review`
- [ ] Create `extensions/beril-literature.ts`: `lit_search`(params `query`,`max?`)→`beril lit search`; `lit_fetch`(param `pmid`)→`beril lit fetch`. `/literature-review` command: read the rubric skill, fan out N sub-queries via `pi.exec("pi", ["--mode","json","--no-session", subPrompt])` parsing JSONL **split on `\n` only**, dedupe, write `references.md`. Test: tools register + return parsed records (mock `exec`); fan-out parser splits a 2-line JSONL fixture correctly. Commit `feat(ext): beril-literature tools + /literature-review fan-out`.

### Task 3.4: Phase-3 verification
- [ ] In Pi: "review the literature on <topic>" → `/literature-review` produces `references.md` with ranked, deduped citations. Append to `phase-notes.md`; commit.

---

# PHASE 4 — Polish

### Task 4.1: Pi-optimize skills
- [ ] Port the 8 in-scope skills to `skills/<name>/SKILL.md` (valid frontmatter: `name`, `description`). Strip Claude-Code execution prose; reference the Pi tools/commands by name (e.g. synthesize SKILL.md says "use `/synthesize`; state transitions are handled by the `lifecycle_transition` tool"). Keep ONLY judgment/rubrics. Run `node` smoke: `pi list` shows `/skill:berdl-query` etc. Commit per skill or in one `docs(skills): pi-optimized SKILL.md set`.

### Task 4.2: `/berdl-start` prompt + theme
- [ ] Create `prompts/berdl-start.md` (frontmatter `description`; body greets, calls `berdl_env_check`, summarizes connection + next steps; uses `$@` for optional focus). Create `themes/beril.json` (minimal palette). Commit.

### Task 4.3: Packaging + install docs + isolation guidance
- [ ] Verify `package.json` peer/bundled deps per reference §A5 (pi-core in peerDeps `*`). Write `README.md`: install (`pi install git:…`), `beril start --agent pi`, the connection prerequisites (SSH tunnels 1337/1338 + pproxy — user-run), the `models.json` org-provider template, and a **Safety/Isolation** section (Docker/OpenShell; destructive tools are gated but Pi has no sandbox). Commit `docs: install + provider + isolation guide`.

### Task 4.4: Full-package integration smoke (mock `beril` on PATH)
- [ ] Create `test/integration/mock-beril` (a shell/Node script answering `env`/`query`/`user`/`hash`/`lifecycle`/`submit` with canned JSON) and a test that puts it on `PATH` and runs `pi --mode json --no-session` through a query→synthesize→review→submit happy path, asserting the JSONL agent_end. Commit `test: end-to-end smoke against a mock beril CLI`.

### Task 4.5: Final verification + branch finish
- [ ] `bun run check` (tsc + biome) clean; `bun test` green; `uv run pytest` green in BERIL repo. Update `phase-notes.md`. Use superpowers:finishing-a-development-branch to open PRs for both branches (`feat/mvp` here; `feat/beril-pi-subcommands` in BERIL).

---

## Self-Review

**Spec coverage:** §2.1 file structure → Tasks 0.3/0.6/1.x/2.x/3.x/4.x. §2.2 boundary/C1/C2 → Task 0.4 + every wrapper. §2.3 launch → Task 0.7. §2.4 skill/command/tool → Tasks 4.1 + governance commands. §3.1 beril-env → 0.6. §3.2 beril-data → 1.4. §3.3 governance/lift → 2.1–2.8. §3.4 literature → 3.x. §3.5 safety → 1.3. §4 additive subcommands → all `*_cmd` tasks. §5 cross-cutting → 0.4/0.5/2.x. §6 error handling → 0.4 (BerilError) + submit 2=partial. §7 testing → tests in every task + 4.4. §8 phasing → phase headers. **No gaps found.**

**Placeholder scan:** No "TBD/TODO/handle edge cases"; every code step has real code; the one design fork (env exit-code) is resolved inline in Task 0.5 with an explicit decision.

**Type consistency:** `berilExec`/`BerilError` (0.4) used uniformly; `BerdlEnv`/`requireReady` (0.5) reused in 0.6/1.4/2.7; `next_state`/`set_status`/`load_project`/`save_project` consistent across 2.1/2.2/2.6; tool names match the destructive registry (1.3) and governance tools (2.7). `find_repo_root` (0.1) used by every subcommand.
