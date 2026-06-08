<!--
Provenance: extracted by parallel sub-agents reading the LOCALLY INSTALLED
@earendil-works/pi-coding-agent@0.78.1 (dist/*.d.ts, docs/, examples/) and the
BERIL-research-observatory repo (beril_cli, scripts/, tools/, .claude/skills/).
Quotes are verbatim from those sources. Companion to 2026-06-05-beril-pi-agent-design.md.
-->

# beril-pi-agent — Implementation Reference (verified against Pi 0.78.1)

Package paths: Pi install at `/Users/g8k/npm-global/lib/node_modules/@earendil-works/pi-coding-agent`; BERIL repo scripts/tools under `BERIL-research-observatory/`. Import root is `@earendil-works/pi-coding-agent`; tool param schemas use `import { Type } from "typebox"`.

---

## Part A — Pi Extension API (verified)

### A1. Extension entry point & ExtensionAPI methods

Entry point is a **default-exported factory** `(pi: ExtensionAPI) => void | Promise<void>`. Verified across all `examples/extensions/*.ts`.

```ts
// Source: dist/core/extensions/types.d.ts
export type ExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>;
```

```ts
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
export default function myExtension(pi: ExtensionAPI) { /* ... */ }
```

> CAUTION: `package.json` declares a `"./hooks"` subpath export but **that file does not exist on disk**. Import all types from the package root, NOT from `/hooks`.

`ExtensionAPI` interface (verbatim, `dist/core/extensions/types.d.ts:790-944`) — the load-bearing methods:

```ts
export interface ExtensionAPI {
    on(event: "session_start", handler: ExtensionHandler<SessionStartEvent>): void;
    on(event: "session_shutdown", handler: ExtensionHandler<SessionShutdownEvent>): void;
    on(event: "tool_call", handler: ExtensionHandler<ToolCallEvent, ToolCallEventResult>): void;
    on(event: "tool_result", handler: ExtensionHandler<ToolResultEvent, ToolResultEventResult>): void;
    on(event: "input", handler: ExtensionHandler<InputEvent, InputEventResult>): void;
    on(event: "context", handler: ExtensionHandler<ContextEvent, ContextEventResult>): void;
    on(event: "agent_start", handler: ExtensionHandler<AgentStartEvent>): void;
    on(event: "agent_end", handler: ExtensionHandler<AgentEndEvent>): void;
    // ... (full event set in A4)
    /** Register a tool that the LLM can call. */
    registerTool<TParams extends TSchema = TSchema, TDetails = unknown, TState = any>(tool: ToolDefinition<TParams, TDetails, TState>): void;
    /** Register a custom command. */
    registerCommand(name: string, options: Omit<RegisteredCommand, "name" | "sourceInfo">): void;
    /** Register a keyboard shortcut. */
    registerShortcut(shortcut: KeyId, options: { description?: string; handler: (ctx: ExtensionContext) => Promise<void> | void; }): void;
    /** Register a CLI flag. */
    registerFlag(name: string, options: { description?: string; type: "boolean" | "string"; default?: boolean | string; }): void;
    /** Get the value of a registered CLI flag. */
    getFlag(name: string): boolean | string | undefined;
    registerMessageRenderer<T = unknown>(customType: string, renderer: MessageRenderer<T>): void;
    /** Send a custom message to the session. */
    sendMessage<T = unknown>(message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">, options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn"; }): void;
    /** Send a user message to the agent. Always triggers a turn. */
    sendUserMessage(content: string | (TextContent | ImageContent)[], options?: { deliverAs?: "steer" | "followUp"; }): void;
    /** Append a custom entry to the session for state persistence (not sent to LLM). */
    appendEntry<T = unknown>(customType: string, data?: T): void;
    setSessionName(name: string): void;
    getSessionName(): string | undefined;
    setLabel(entryId: string, label: string | undefined): void;
    /** Execute a shell command. */
    exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult>;
    getActiveTools(): string[];
    getAllTools(): ToolInfo[];
    setActiveTools(toolNames: string[]): void;
    getCommands(): SlashCommandInfo[];
    setModel(model: Model<any>): Promise<boolean>;
    getThinkingLevel(): ThinkingLevel;
    setThinkingLevel(level: ThinkingLevel): void;
    registerProvider(name: string, config: ProviderConfig): void;
    unregisterProvider(name: string): void;
    events: EventBus;
}
```

```ts
export type ExtensionHandler<E, R = undefined> = (event: E, ctx: ExtensionContext) => Promise<R | void> | R | void;
// exec() options/result (dist/core/exec.d.ts) — `code` not `exitCode`; timeout is MILLISECONDS
export interface ExecOptions { signal?: AbortSignal; timeout?: number; cwd?: string; }
export interface ExecResult { stdout: string; stderr: string; code: number; killed: boolean; }
// EventBus
export interface EventBus { emit(channel: string, data: unknown): void; on(channel: string, handler: (data: unknown) => void): () => void; }
```

Command handlers receive `(args: string, ctx: ExtensionCommandContext)`; event handlers receive `(event, ctx: ExtensionContext)`.

### A2. Tool config + execute() + ToolResult + renderResult

```ts
// Source: dist/core/extensions/types.d.ts:333-364
export interface ToolDefinition<TParams extends TSchema = TSchema, TDetails = unknown, TState = any> {
    name: string;
    label: string;
    description: string;
    promptSnippet?: string;        // one-line for "Available tools" section; omitted when absent
    promptGuidelines?: string[];   // bullets appended to Guidelines when active
    parameters: TParams;           // TypeBox schema
    renderShell?: "default" | "self";
    prepareArguments?: (args: unknown) => Static<TParams>;
    executionMode?: ToolExecutionMode;  // "sequential" | "parallel"
    execute(toolCallId: string, params: Static<TParams>, signal: AbortSignal | undefined, onUpdate: AgentToolUpdateCallback<TDetails> | undefined, ctx: ExtensionContext): Promise<AgentToolResult<TDetails>>;
    renderCall?: (args: Static<TParams>, theme: Theme, context: ToolRenderContext<TState, Static<TParams>>) => Component;
    renderResult?: (result: AgentToolResult<TDetails>, options: ToolRenderResultOptions, theme: Theme, context: ToolRenderContext<TState, Static<TParams>>) => Component;
}
```

> CRITICAL: `execute` arg order is `(toolCallId, params, signal, onUpdate, ctx)`. The README's `(toolCallId, params, onUpdate, ctx, signal)` is WRONG/outdated. Trust the `.d.ts`. Trailing args are optional when unused (e.g. `async execute(_id, params)`).

```ts
// AgentToolResult — Source: pi-agent-core/dist/types.d.ts:305-317
export interface AgentToolResult<T> {
    content: (TextContent | ImageContent)[];  // {type:"text", text} | image
    details: T;                                // REQUIRED; use {} when empty
    terminate?: boolean;                       // stop after batch if every result sets true
}
export type AgentToolUpdateCallback<T = any> = (partialResult: AgentToolResult<T>) => void;
export type ToolExecutionMode = "sequential" | "parallel";
export interface ToolRenderResultOptions { expanded: boolean; isPartial: boolean; }
```

> `AgentToolResult` has **NO `isError` field**. Tools report failure by **throwing**. `isError` lives only on the `tool_result` event (A4).

Minimal template (verbatim core, `shutdown-command.ts`):

```ts
import { Type } from "typebox";
pi.registerTool({
    name: "deploy_and_exit",
    label: "Deploy and Exit",
    description: "Deploy the application and exit pi",
    parameters: Type.Object({
        environment: Type.String({ description: "Target environment" }),
    }),
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
        onUpdate?.({ content: [{ type: "text", text: `Deploying to ${params.environment}...` }], details: {} });
        return {
            content: [{ type: "text", text: "Done!" }],
            details: { environment: params.environment },
        };
    },
});
```

`renderResult` destructures `{ expanded, isPartial }` and returns a `Component` (e.g. `new Text(text, 0, 0)` from `@earendil-works/pi-tui`). Style via `theme.fg(colorKey, str)` / `theme.bold(str)`; observed keys: `accent`, `muted`, `dim`, `success`, `warning`, `error`, `toolTitle`, `text`. For **string-enum params** use `StringEnum(["a","b"] as const)` from `@earendil-works/pi-ai`, NOT `Type.Union([Type.Literal(...)])` (Google API compat).

### A3. ctx + ctx.ui + status/widget/footer with hasUI/mode gating

```ts
// Source: dist/core/extensions/types.d.ts:207-239
export type ExtensionMode = "tui" | "rpc" | "json" | "print";
export interface ExtensionContext {
    ui: ExtensionUIContext;
    mode: ExtensionMode;          // "tui" guards terminal-only custom components
    hasUI: boolean;               // true in TUI AND RPC (dialog-capable)
    cwd: string;
    sessionManager: ReadonlySessionManager;
    modelRegistry: ModelRegistry;
    model: Model<any> | undefined;
    isIdle(): boolean;
    signal: AbortSignal | undefined;
    abort(): void;
    hasPendingMessages(): boolean;
    shutdown(): void;
    getContextUsage(): ContextUsage | undefined;
    compact(options?: CompactOptions): void;
    getSystemPrompt(): string;
}
```

`ExtensionCommandContext extends ExtensionContext` adds: `waitForIdle()`, `newSession(...)`, `fork(...)`, `navigateTree(...)`, `switchSession(...)`, `reload()`, `getSystemPromptOptions()`.

`ctx.ui` (`ExtensionUIContext`, verbatim subset):

```ts
select(title: string, options: string[], opts?: ExtensionUIDialogOptions): Promise<string | undefined>;
confirm(title: string, message: string, opts?: ExtensionUIDialogOptions): Promise<boolean>;
input(title: string, placeholder?: string, opts?: ExtensionUIDialogOptions): Promise<string | undefined>;
notify(message: string, type?: "info" | "warning" | "error"): void;
setStatus(key: string, text: string | undefined): void;          // undefined clears; keyed; appears in footer
setWidget(key: string, content: string[] | undefined, options?: ExtensionWidgetOptions): void;  // + factory overload
setFooter(factory: ((tui, theme, footerData: ReadonlyFooterDataProvider) => Component & {dispose?():void}) | undefined): void;
setHeader(factory | undefined): void;
editor(title: string, prefill?: string): Promise<string | undefined>;
custom<T>(factory, options?): Promise<T>;                        // TUI-only; overlay via options.overlay
readonly theme: Theme;
export interface ExtensionUIDialogOptions { signal?: AbortSignal; timeout?: number; }
export type WidgetPlacement = "aboveEditor" | "belowEditor";
export interface ExtensionWidgetOptions { placement?: WidgetPlacement; }  // default "aboveEditor"
```

**No-op fallback defaults when `hasUI === false`** (print/json modes; `runner.js`): `confirm → false` (auto-DENY), `select/input/editor/custom → undefined`, `notify/setStatus/setWidget/setFooter → no-op`, `getEditorText → ""`.

**Gating rules:**
- `ctx.hasUI` (TUI+RPC): gate `confirm`/`select`/`input`/`editor`, `setStatus`/`setWidget`/`notify`.
- `ctx.mode === "tui"` (stricter): gate `ui.custom(...)`, `setHeader`/`setFooter`/`setEditorComponent`, `onTerminalInput`.

Status widget pattern: `ctx.ui.setStatus("beril-connection", ctx.ui.theme.fg(color, label))`; clear with `setStatus(key, undefined)`. To push async state changes, hold the `TUI` handle and call `tui.requestRender()` (from `border-status-editor.ts`).

### A4. Event hooks: full union; tool_call BLOCK; tool_result rewrite; session_start; input/context

```ts
// Full union — dist/core/extensions/types.d.ts:716
export type ExtensionEvent = ResourcesDiscoverEvent | SessionEvent | ContextEvent | BeforeProviderRequestEvent | AfterProviderResponseEvent | BeforeAgentStartEvent | AgentStartEvent | AgentEndEvent | TurnStartEvent | TurnEndEvent | MessageStartEvent | MessageUpdateEvent | MessageEndEvent | ToolExecutionStartEvent | ToolExecutionUpdateEvent | ToolExecutionEndEvent | ModelSelectEvent | ThinkingLevelSelectEvent | UserBashEvent | InputEvent | ToolCallEvent | ToolResultEvent;
// SessionEvent = SessionStartEvent | SessionBeforeSwitchEvent | SessionBeforeForkEvent | SessionBeforeCompactEvent | SessionCompactEvent | SessionShutdownEvent | SessionBeforeTreeEvent | SessionTreeEvent
```

Event string literals: `resources_discover`, `session_start`, `session_before_switch`, `session_before_fork`, `session_before_compact`, `session_compact`, `session_shutdown`, `session_before_tree`, `session_tree`, `context`, `before_provider_request`, `after_provider_response`, `before_agent_start`, `agent_start`, `agent_end`, `turn_start`, `turn_end`, `message_start`, `message_update`, `message_end`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, `model_select`, `thinking_level_select`, `tool_call`, `tool_result`, `user_bash`, `input`.

**`tool_call` — BLOCK semantics (THE safety lever):**

```ts
interface ToolCallEventBase { type: "tool_call"; toolCallId: string; }
export interface CustomToolCallEvent extends ToolCallEventBase { toolName: string; input: Record<string, unknown>; }
export type ToolCallEvent = BashToolCallEvent | ReadToolCallEvent | EditToolCallEvent | WriteToolCallEvent | GrepToolCallEvent | FindToolCallEvent | LsToolCallEvent | CustomToolCallEvent;
export interface ToolCallEventResult { block?: boolean; reason?: string; }
```
Built-in tool names: `"bash"`, `"read"`, `"edit"`, `"write"`, `"grep"`, `"find"`, `"ls"`. **Block** → `return { block: true, reason }`; **rewrite args** → mutate `event.input` in place (no re-validation); **allow** → `return undefined`. Narrow with `event.toolName === "bash"` or `isToolCallEventType(name, event)`. The `{ cancel: true }` form is for `session_before_*` only, NOT `tool_call`. (UNVERIFIED whether throwing inside a `tool_call` handler blocks vs crashes.)

**`tool_result` — rewrite:**

```ts
interface ToolResultEventBase { type: "tool_result"; toolCallId: string; input: Record<string, unknown>; content: (TextContent | ImageContent)[]; isError: boolean; }
export interface CustomToolResultEvent extends ToolResultEventBase { toolName: string; details: unknown; }
export interface ToolResultEventResult { content?: (TextContent | ImageContent)[]; details?: unknown; isError?: boolean; }
```

**`session_start` / `session_shutdown`:**

```ts
export interface SessionStartEvent { type: "session_start"; reason: "startup" | "reload" | "new" | "resume" | "fork"; previousSessionFile?: string; }
export interface SessionShutdownEvent { type: "session_shutdown"; reason: "quit" | "reload" | "new" | "resume" | "fork"; targetSessionFile?: string; }
```
`session_start` handler returns `void`. Register persistent UI here; dispose timers/watchers/connections in `session_shutdown`.

**`input` / `context`:**

```ts
export interface InputEvent { type: "input"; text: string; images?: ImageContent[]; source: "interactive"|"rpc"|"extension"; streamingBehavior?: "steer"|"followUp"; }
export type InputEventResult = { action: "continue" } | { action: "transform"; text: string; images?: ImageContent[] } | { action: "handled" };
export interface ContextEvent { type: "context"; messages: AgentMessage[]; }
export interface ContextEventResult { messages?: AgentMessage[]; }
```

Other returns: `before_agent_start → { message?; systemPrompt? }`; `message_end → { message? }`; `session_before_switch → { cancel? }`; `session_before_fork → { cancel?; skipConversationRestore? }`; `session_before_compact → { cancel?; compaction? }`.

### A5. Packaging: `pi` manifest, auto-discovery, deps, trust

```json
// Source: docs/packages.md — paths relative to package root; arrays support globs + !exclusions
{
  "name": "beril-pi-agent",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  }
}
```
Four resource keys exactly: `extensions`, `skills`, `prompts`, `themes` (+ optional gallery `video`/`image`).

Auto-discovery when no `pi` manifest: `extensions/` loads `.ts`/`.js`; `skills/` recursively finds `SKILL.md` folders + loads top-level `.md`; `prompts/` loads `.md` (non-recursive); `themes/` loads `.json`. Extension dirs also: `~/.pi/agent/extensions/*.ts` (global), `.pi/extensions/*.ts` (project), plus `*/index.ts` subdir forms.

**Dependencies (CRITICAL):**
- Pi-core pkgs → `peerDependencies` with `"*"`, do NOT bundle: `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `typebox`.
- Other third-party runtime deps → `dependencies` (installed via `npm install --omit=dev` at install).
- Other pi packages → MUST be `dependencies` + `bundledDependencies`, referenced via `node_modules/` paths.

**Trust model:** No sandboxing. "Extensions run with your full system permissions and can execute arbitrary code. Only install from sources you trust." Review-before-install only.

Settings-level filtering layers ON TOP of manifest (narrows): `!pattern` excludes, `+path`/`-path` exact force-include/exclude. Project settings entry wins over global for the same package.

### A6. Skills + prompt templates → /commands

SKILL.md frontmatter (`docs/skills.md`):

| Field | Required | Notes |
|---|---|---|
| `name` | Yes | ≤64 chars, lowercase a-z/0-9/hyphens, no leading/trailing/double hyphens. Need NOT match dir. |
| `description` | Yes | ≤1024 chars. **Missing → skill NOT loaded.** |
| `license` / `compatibility` / `metadata` | No | |
| `allowed-tools` | No | Space-delimited pre-approval list (experimental; enforcement UNVERIFIED). |
| `disable-model-invocation` | No | `true` → hidden from model; user must use `/skill:name`. |

Skills register as **`/skill:name`** (namespaced, NOT bare `/name`). Args after the command appended as `User: <args>`. Global on/off via `enableSkillCommands` setting (default `true`). `pi.getCommands()` returns `SlashCommandInfo { name, description?, source: "extension"|"prompt"|"skill", sourceInfo }`.

Prompt templates (`docs/prompt-templates.md`): filename `review.md` → `/review`. Frontmatter `description` (falls back to first non-empty line) + `argument-hint`. **Substitution is `$`-style, NOT `{{var}}`:** `$1 $2` positional, `$@`/`$ARGUMENTS` all-joined, `${@:N}`, `${@:N:L}`. `{{var}}` mustache does NOT exist.

### A7. Settings + providers + modes

**Settings scopes (deep-merge, project wins):** global `~/.pi/agent/settings.json`, project `.pi/settings.json`. Nested objects merge by key. Paths resolve relative to the settings file's dir. `defaultProvider`/`defaultModel` override the CLI default (`google`).

**Secret resolution** (`apiKey`/`headers` in `models.json`, `auth.json`, `registerProvider`): `"$VAR"`/`"${VAR}"` env interpolation; `"!command"` (prefix) runs shell, uses stdout; `"$$"`→`$`, `"$!"`→`!`. In `models.json`, `!command` runs **per-request (no caching)**; in `auth.json` cached for process lifetime. Auth priority: CLI `--api-key` → `auth.json` → env → `models.json` custom keys.

**models.json template for an org Anthropic/Vertex/proxy endpoint** (`docs/models.md`):

```json
{
  "providers": {
    "anthropic-proxy": {
      "baseUrl": "https://proxy.example.com",
      "api": "anthropic-messages",
      "apiKey": "$ANTHROPIC_PROXY_KEY",
      "compat": {
        "supportsEagerToolInputStreaming": false,
        "supportsLongCacheRetention": true,
        "forceAdaptiveThinking": true,
        "allowEmptySignature": true
      },
      "models": [
        { "id": "claude-opus-4-7", "reasoning": true, "input": ["text", "image"] }
      ]
    }
  }
}
```
To reuse built-in Anthropic models through a gateway, override only `{"providers":{"anthropic":{"baseUrl":"https://gateway/v1"}}}`. Supported `models.json` APIs: `openai-completions`, `openai-responses`, `anthropic-messages`, `google-generative-ai`. **`google-vertex` is NOT a valid `models.json` api** — use env-var ADC (`gcloud auth application-default login` + `GOOGLE_CLOUD_PROJECT`/`GOOGLE_CLOUD_LOCATION`) or an extension `registerProvider({ api: "google-vertex" })` (extension API table is a superset). Note: BERIL's existing Vertex path (from `start.py`) is the Claude-Code-style env injection (`CLAUDE_CODE_USE_VERTEX=1`, `ANTHROPIC_VERTEX_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS`), which is NOT how Pi consumes Vertex — Pi needs ADC env or an extension provider.

**Sub-agent subprocess (`pi -p` / `--mode json`) JSONL contract:**

| Mode | `ctx.mode` | `hasUI` |
|---|---|---|
| `--mode rpc` | `"rpc"` | true |
| `--mode json` | `"json"` | false |
| `-p`/`--print` | `"print"` | false |

`-p` emits **plain text** (assistant response only). For machine-parseable output use `pi --mode json --no-session "<prompt>"` → JSONL to stdout. First line `{"type":"session",...}`, then `agent_start`/`turn_start`/`message_start`/`message_update`/`message_end`/`turn_end`/`agent_end`. Consume final `{"type":"agent_end","messages":[...]}` or last assistant `message_end`. **JSONL framing: split on `\n` ONLY** (Node `readline` is non-compliant; it splits on U+2028/U+2029 valid inside JSON strings). Stop reasons on `stopReason`: `stop`/`length`/`toolUse`/`error`/`aborted`.

**MCP: NOT supported.** Confirmed — "intentionally does not include built-in MCP, sub-agents, permission popups..." Extend only via extensions/`registerTool`/`registerProvider`/packages.

---

## Part B — BERIL interfaces to wrap (verified)

### B1. beril_cli architecture + adding a subcommand + start/user contract

`beril_cli/cli.py`: argparse `add_subparsers(dest="command")`, dispatch via if-chain in `main()`, handlers **lazily imported** inside each branch. Uses `parser.parse_known_args(argv)` → unknown trailing args land in `remaining`, forwarded to `start` as `extra_args`. Handlers return `int`; `sys.exit(main())`.

**To add `beril <name>`:** (1) `xyz_parser = sub.add_parser("xyz", ...)` + `add_argument`s; (2) dispatch branch `if args.command == "xyz": from beril_cli.xyz_cmd import run_xyz; return run_xyz(args)`; (3) create `beril_cli/xyz_cmd.py` with `def run_xyz(args) -> int`. Two handler conventions coexist: no-arg (`run_doctor()`), `Namespace` (`run_user(args)`), explicit kwargs (`run_start(agent=..., extra_args=..., skip_onboard=..., version=...)`).

**`beril start`** (the launch model for `pi`): `agent = agent or get_default_agent()` (→ `"claude"`); `binary = shutil.which(agent)` (missing → stderr + return 1); `os.chdir(_find_repo_root())` (walks up for `PROJECT.md`); version/tag checkout via git; `_sync_auth_token(.env)` writes `KBASE_AUTH_TOKEN=`; injects `/berdl_start` into `extra_args` only when empty and not `--skip-onboard`; Claude-only Vertex env injection + `--model opus` prepend; then:

```python
os.execvp(binary, [agent, *extra_args])  # argv[0] is the agent NAME, not binary path
```
For pi the analogue is `os.execvp(shutil.which("pi"), ["pi", *extra_args])` after `os.chdir(repo_root)`.

**`beril user --json`** (the identity oracle): emits compact single-line JSON + `\n` to stdout with exactly three always-present keys (empty string when missing), values `.strip()`-ed:
```json
{"name": "...", "affiliation": "...", "orcid": "..."}
```
"Missing field(s): ..." notice goes to **stderr** (does not pollute JSON). **Exit 0 iff all three non-empty, else 1.** Config at `~/.config/beril/config.toml` read via `tomllib`; `save()` is hand-rolled and only emits `[user]`/`[defaults]`/`[vertex]` — unknown sections are silently dropped.

> UNVERIFIED: console-script binding `[project.scripts] beril = beril_cli.cli:main` (pyproject not in scope).

### B2. Data scripts (run_sql/export_sql/discover/inventory)

All scripts under `BERIL-research-observatory/scripts/`. Token: `--kbase-token` or `KBASE_AUTH_TOKEN` env/`.env`. `--berdl-proxy` (only run_sql/export_sql) forces host `metrics.berdl.kbase.us`, grpc/https proxy `http://127.0.0.1:8123`, and triggers `ensure_hub()` JH auto-spawn. **stdout hazard:** `ensure_hub()` prints `[hub]` lines to stdout, which can pollute JSON parsing.

**`run_sql.py` → `beril query`:** `--query`/`--query-file` (exactly one), `--limit` (default **100**; `-1` disables — the only result cap), `--output`, proxy flags. Query `.strip().rstrip(";")`, single statement. Output: pretty JSON (`indent=2`) to stdout, payload `{query, host_template, port, use_ssl, ...proxies, limit_applied, returned_rows, rows}`; with `--output` writes file + prints `Wrote N rows`. Exit: 0 ok / 1 query failure / 2 token-missing|import-fail|bad-query. **Read-only** (no lakehouse writes).

**`export_sql.py` → `beril export` (DESTRUCTIVE):** `--query`/`--query-file`, `--path` **REQUIRED** (`s3a://...`), `--format` (parquet/delta/json/csv), **`--mode` default `overwrite`** (silently replaces existing data — gate this), `--partition-by`, `--coalesce`, `--count`, `--manifest`. **No `--limit` rail** (full result set). Writes to MinIO; prints JSON manifest to stdout. Exit: 0/1/2 same shape. MinIO creds NOT passed as args — must be in Spark `s3a://` config.

**`discover_berdl_collections.py` → `beril discover`:** NO `--berdl-proxy`. `--output` (default `ui/config/berdl_collections_snapshot.json`), `--base-url` (default `https://hub.berdl.kbase.us/apis/mcp`), `--database` (scoped: one DB's tables, no schema crawl; omit for the databases inventory), `--max-databases`, `--include-non-user-facing`. Two cheap depths, neither scans every table: inventory (databases→tenants) or scoped (`--database` → that DB's table list). Columns come from `berdl_peek`, not here. On-cluster uses `berdl_notebook_utils` (no token); off-cluster REST POST with `Bearer` token. Writes JSON snapshot atomically to file (NOT stdout); stdout = summary line. Exit 0 / 2 (RuntimeError off-cluster no-token). Per-item errors accumulate, don't fail.

**`berdl_inventory.py` → `beril inventory`:** plain `python` (NOT `uv run --script`, by design). NO `--berdl-proxy` (inherits from imported `get_spark_session(berdl_proxy=True)`). `--sample` (default 3, display-only), `--with-members`, `--no-emoji`, `--off-cluster`, `--output` (default `data/berdl_inventory.md`), `--no-file`, `--full`. Output: **markdown** report to file + compact summary to stdout. Exit 0 / 1 / 2 (missing module / on-cluster-but-utils-missing).

**Exit-code map across data scripts:** 2 = config/usage (missing token, bad query, missing module, REST-unavailable); 1 = runtime failure; 0 = success.

### B3. Repro/governance executables

All under `BERIL-research-observatory/tools/`.

**`notebook_hash.py` → `beril hash`:** Canonical JSON `json.dumps(canonical, sort_keys=True, separators=(",",":"), ensure_ascii=False).encode("utf-8")` then SHA-256. Whitelisted fields only; `.ipynb_checkpoints/` pruned. `hash_notebook()` returns **bare hex**; `prefixed()`/`unprefixed()` add/strip `sha256:` (idempotent; reject non-`sha256` algos with `ValueError`). **Comparison convention:** `computed_hex == unprefixed(stored_value)`. CLI: `python /abs/tools/notebook_hash.py compute-hashes <project_dir>` → single-line JSON `{"<relpath>": "sha256:<hex>", ...}` (prefixed); `hash-notebook <path>` → `sha256:<hex>`. Exit **0** success (incl `{}`) / **1** usage|FS error / **2** corrupt notebook.

**`lakehouse_upload.py` → `beril submit`:** Destination `MC_ALIAS="berdl-minio"`, `S3A_BASE="s3a://cdm-lake/tenant-general-warehouse/microbialdiscoveryforge/projects"`. CLI: positional `project_id`, `--all`, `--list`, `--validate`, `--base-path`. **Destructive pre-clear**: when remote prefix non-empty, runs `mc rm --recursive --force <remote_path>` before per-file `mc cp` (so re-submit doesn't leave stale objects); if rm fails, aborts (returns None). SKIP_PATTERNS exclude `.submit.lock`, `project_metadata.json`, `__pycache__`, `.ipynb_checkpoints`, etc. **Exit/JSON contract (single-project path):** **0** = full success, JSON `{archive_key, file_count, byte_total, duration_seconds}`; **1** = hard failure, NO JSON (stderr only); **2** = partial success, success JSON PLUS `"error"` field — archive incomplete, **treat as failure**.

**`review.sh` → `beril review`:** `tools/review.sh <project_id> [--type project|plan] [--reviewer claude|codex] [--model <id>] [--output <path>]`. Defaults: `--type project`, `--reviewer claude`, model `claude-sonnet-4-20250514` (claude) / `gpt-5.4` (codex). Auto-numbers `REVIEW_N.md` (race-safe placeholder claim). Spawns reviewer: Claude `CLAUDECODE= claude -p --model M --system-prompt SP --allowedTools "Read,Write" --dangerously-skip-permissions PROMPT`; Codex `codex exec --model M --sandbox workspace-write --ephemeral` (system prompt prepended with `---`). **Report hash is plain `sha256sum REPORT.md` over RAW bytes** (NOT notebook canonicalization). TOCTOU: compares `REPORT_HASH_PRE`/`POST`, discards on change. **Footer (load-bearing):** `<!-- report_hash: sha256:<hex> -->` — final non-empty line, exactly one occurrence (stripped then re-appended).

> Two distinct `sha256:` primitives: (a) `notebook_hash.py` over canonicalized notebook JSON; (b) raw-file `sha256sum` over REPORT.md for the review footer. NOT interchangeable.

### B4. Lifecycle state machine

**State machine** (`PROJECT.md`): `exploration → proposed → active → analysis → reviewed → complete`. Forward: `active→analysis` (`/synthesize` Step 7b), `analysis→reviewed` (`/berdl-review` Step 5), `reviewed→complete` (`/submit` Phase 2c). Demote: `reviewed→analysis` (synthesize, silent), `complete→analysis` (synthesize y/n | berdl-review hash-mismatch | submit Phase 1a reopen) — moves `approval`→`previous_approvals[]` (+`archived_at`), deletes `REVIEW.md` + both markers, rewrites README `## Status`.

**`beril.yaml` core fields (on-disk verified):** `project_id`, `status`, `created_at`, `last_session_at`, `branch`, `engine.name`, `authors[]` (`name`/`affiliation`/`orcid`), `artifacts.{readme,research_plan,report,review}` (bool). **Approval block (skill-text only, key ordering UNVERIFIED):**
```yaml
approval:
  by: "<orcid>"
  at: "<ISO>"
  report_hash: "sha256:<hex>"
  review: "REVIEW_N.md"
  review_hash: "sha256:<hex>"
  notebook_hashes: { "notebooks/01.ipynb": "sha256:<hex>" }   # v5; {} when no notebooks
previous_approvals: []   # each = approval shape + archived_at
submissions: []          # {status, attempted_at, approved_at (join key), archive_key, file_count, byte_total, duration_seconds}
```
**Hash convention:** all stored hashes carry `sha256:`; never compare directly — `computed_hex == unprefixed(stored)`.

**Markers (local-only, written after upload):** `SUBMITTED.md` (success), `SUBMISSION_FAILED.md` (failure), `.submit.lock` (advisory, ISO start ts, acquired Phase 0, deleted every exit path). Invariant: exactly one of SUBMITTED/FAILED after Phase 3; **FAILED always wins**.

**`/submit` gating:** Phase 0 lock → checklist → Phase 1a (complete: existence + REPORT/REVIEW/notebook hash compares, reopen prompt on mismatch, marker branching) → Phase 1b (reviewed: latest `REVIEW_N.md` by numeric N, strict footer `<!-- report_hash: sha256:[0-9a-f]{64} -->` as final non-empty line, exactly one) → **Phase 1c ORCID gate** (`beril user --json`; empty orcid → FAIL "No ORCID configured") → Phase 2b TOCTOU re-check → Phase 2c approval write → Phase 3a pre-upload rehash → Phase 3b upload (0/1/2) → Phase 3b.5 post-upload rehash → Phase 3c (write `submissions[]` FIRST, then marker).

**Memory promotion:** `memories/pitfalls.md` (LIVE, append-only via `/pitfall-capture`); `memories/discoveries.md` + `memories/performance.md` (APPROVAL-GATED — `/synthesize` writes `## Discoveries`/`## Performance Notes` in REPORT.md → `/submit` Phase 2c extracts after approval; section removed → memory file deleted).

**Per-skill LIFT (execution/gating) vs KEEP (judgment):**
| Skill | LIFT to `beril lifecycle` | KEEP as Pi skill |
|---|---|---|
| synthesize | status gate, demote transitions, Step 7b manifest write, README rewrite | interpretation, REPORT.md authoring |
| berdl-review | status precondition, hash-compare/demote, `review.sh` invoke, status=reviewed write, footer validation | review reading, fix guidance |
| submit | lock, status gate, all hash compares, ORCID gate, TOCTOU, approval write, upload bookkeeping | approval-summary wording |
| pitfall-capture | dedup search, placement, append write | ask-user, draft prose |
| suggest-research | inventory walk, dedup, register | scoring/recommendation prose |
| literature-review | `references.md` write | tier selection, synthesis |

---

## Part C — Mapping to our design

| Planned tool/command | Pi API | Shells to | Destructive? (gate) |
|---|---|---|---|
| `berdl_env_check` | `registerTool` + `pi.exec` | `beril doctor` / `detect_berdl_environment.py` (read-only) | No |
| `berdl_query` | `registerTool` (Type.Object query/limit) + `pi.exec`, parse stdout JSON, check `code!==0` | `beril query` (run_sql.py) | No (read-only; `--limit 100` rail) |
| `berdl_export` | `registerTool` + `pi.exec`; **`tool_call` gate `confirm`** before run | `beril export` (export_sql.py) | **YES** — `--mode overwrite` default; gate confirm |
| `berdl_discover` | `registerTool` + `pi.exec` | `beril discover` (discover script) | No (writes snapshot file only) |
| `notebook_hash` | `registerTool` + `pi.exec`, return prefixed JSON | `beril hash` (notebook_hash.py compute-hashes) | No |
| `lifecycle_transition` | `registerTool`; reads/writes `beril.yaml`; enforce state machine + hash compares | `beril lifecycle` (new subcommand to BUILD) | Mutates state — gate demotes via confirm |
| `beril_user` | `pi.exec("beril",["user","--json"])`, `JSON.parse` stdout, check exit | `beril user --json` | No |
| `lakehouse_submit` | `registerTool` + `pi.exec`; **`tool_call` gate**; ORCID gate via `beril_user` first | `beril submit` (lakehouse_upload.py) | **YES** — `mc rm --recursive --force` pre-clear; gate confirm |
| `lit_search`/`lit_fetch` | `registerTool` + `complete()` from `@earendil-works/pi-ai` fan-out (Promise.all), or `pi.exec` to a lit script | LLM `complete()` / external lit CLI | No |
| `/synthesize` | `registerCommand` (judgment prose) + `lifecycle_transition` tool for state | `beril lifecycle` for Step 7b | Demote → confirm |
| `/berdl-review` | `registerCommand` + `pi.exec` | `beril review` (review.sh) | No (writes REVIEW_N.md) |
| `/submit` | `registerCommand`; orchestrates ORCID gate, hash compares, `lakehouse_submit` | `beril user --json`, `beril hash`, `beril submit` | **YES** at upload step |
| `/literature-review` | `registerCommand` + `complete()` fan-out (handoff/summarize pattern) | LLM `complete()` | No (writes references.md) |
| beril-safety gate | `pi.on("tool_call", ...)` → inspect `event.toolName`/`event.input`, `ctx.hasUI`-gated `confirm`/`select`, `return {block,reason}` | n/a (intercepts other tools) | n/a (the gate itself) |
| session_start status widget | `pi.on("session_start", ...)` + `ctx.ui.setStatus("beril-connection", ...)`, `ctx.hasUI` guard, dispose in `session_shutdown` | `beril doctor`/`beril user` for state | No |

Safety-gate blueprint (verbatim `permission-gate.ts` pattern): default-deny when headless (`if (!ctx.hasUI) return { block: true, reason: "...no UI" }`), else `await ctx.ui.select(...)` / `confirm(...)`, block unless approved.

---

## Part D — Corrections & risks

**VERIFIED / corrections to earlier web synthesis:**
1. **Param schema lib is `typebox`** (`import { Type } from "typebox"`), NOT raw JSON Schema and NOT zod. String-enums need `StringEnum([...] as const)` from `@earendil-works/pi-ai`, not `Type.Union([Type.Literal(...)])`.
2. **`execute` arg order is `(toolCallId, params, signal, onUpdate, ctx)`** — the README's `(toolCallId, params, onUpdate, ctx, signal)` is WRONG.
3. **`AgentToolResult` has no `isError`** — tools throw on failure. `isError` is on the `tool_result` event only.
4. **`confirm` returns `Promise<boolean>`** (real awaitable); `select`/`input`/`editor` → `Promise<string|undefined>`. In headless modes `confirm → false` (auto-deny) — branch on `ctx.hasUI` before prompting.
5. **`tool_call` block** is via `return { block: true, reason }`; **rewrite** via mutating `event.input`. The `{ cancel: true }` form is for `session_before_*` ONLY.
6. **Manifest keys are exactly `extensions`/`skills`/`prompts`/`themes`** under `pi`, + `pi-package` keyword. Pi-core deps go in `peerDependencies: "*"`, never bundled.
7. **MCP is NOT available** — extend via `registerTool`/`registerProvider`/packages only.
8. **Sub-agent mechanism:** no nested-agent spawn API; use `pi.exec("pi", ["--mode","json","--no-session", prompt])` + parse JSONL (split on `\n` ONLY), or in-process `complete()` (pi-ai) fan-out, or `createAgentSession()` SDK. `-p` emits plain text, not JSON.
9. **Skill commands are `/skill:name`** (namespaced), NOT bare `/name`. Prompt substitution is `$1`/`$@`/`$ARGUMENTS`, NOT `{{var}}`.
10. **`google-vertex` is NOT a `models.json` api value** — BERIL's existing `CLAUDE_CODE_USE_VERTEX` env injection does NOT apply to Pi; Pi needs ADC env vars or an extension `registerProvider({api:"google-vertex"})`.
11. **Two `sha256:` primitives** in BERIL — canonicalized notebook hash (`beril hash`) vs raw-file `sha256sum` (review footer). Don't conflate.
12. **`./hooks` subpath export is broken** (file absent) — import from package root.

**Residual UNVERIFIED items needing a runtime check:**
- `[project.scripts]` console-script binding for `beril` (pyproject.toml not in scope) — confirm `beril` resolves on PATH and how `pi` would be launched analogously.
- No `beril lifecycle` subcommand exists yet — the entire state machine lives in skill prose + `tools/*.{py,sh}`; this is the surface to BUILD.
- `detect_berdl_environment.py` JSON schema inferred from consumers (`{location, ready, next_steps}`), not read directly.
- How `create_spark_session` picks up MinIO creds for `export_sql.py` (not in the read files).
- SOCKS tunnels (ports 1337/1338) + pproxy (8123) prerequisites for `--berdl-proxy` — how/whether wrappers establish them.
- `beril.yaml` approval/previous_approvals/submissions/notebook_hashes blocks: no on-disk example — exact serialized YAML key ordering unverified.
- No `memories/*.md`, `SUBMITTED.md`, `SUBMISSION_FAILED.md`, `.submit.lock` on disk — formats are from skill templates only.
- Whether throwing inside a `tool_call` handler blocks vs crashes (documented mechanism is `return {block,reason}`).
- Exact `Theme.fg` valid color-key set; full `ReadonlyFooterDataProvider` interface; RPC dialog JSON envelope shapes.
- Whether `spawnProcess`/`waitForChildProcess` (dist/utils/) are re-exported from the public entry (examples use Node's own `node:child_process`).
- `[hub]` stdout chatter from `ensure_hub()` polluting JSON parsing — confirm wrappers redirect/separate stdout when `--berdl-proxy`.