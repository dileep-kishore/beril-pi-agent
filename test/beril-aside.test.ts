import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import berilAside from "../extensions/beril-aside.ts";
import { ASIDE_SYSTEM, type AsideDeps, BRANCH_CAP, branchToContext, runAside } from "../lib/aside.ts";
import { glyph } from "../lib/ui/glyphs.ts";

const MODEL = { id: "claude-opus-4-8" } as unknown as AsideDeps["model"];

/** A finished AssistantMessage with the given stop reason + text content. */
function assistant(text: string, stopReason: AssistantMessage["stopReason"], errorMessage?: string): AssistantMessage {
  return {
    role: "assistant",
    content: text ? [{ type: "text", text }] : [],
    api: "anthropic-messages" as AssistantMessage["api"],
    provider: "anthropic" as AssistantMessage["provider"],
    model: "claude-opus-4-8",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    errorMessage,
    timestamp: Date.now(),
  };
}

/** A `message` session entry wrapping a plain user message. */
function msgEntry(id: string, text: string): SessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: new Date().toISOString(),
    message: { role: "user", content: text, timestamp: Date.now() },
  };
}

/** A non-message session entry that branchToContext must drop. */
function modelChangeEntry(id: string): SessionEntry {
  return {
    type: "model_change",
    id,
    parentId: null,
    timestamp: new Date().toISOString(),
    provider: "anthropic",
    modelId: "x",
  };
}

// ── branchToContext ─────────────────────────────────────────────────────────

test("branchToContext keeps only message entries", () => {
  const entries: SessionEntry[] = [msgEntry("a", "hello"), modelChangeEntry("b"), msgEntry("c", "world")];
  const ctx = branchToContext(entries);
  assert.equal(ctx.length, 2);
  assert.deepEqual(
    ctx.map((m) => (typeof m.content === "string" ? m.content : "")),
    ["hello", "world"],
  );
});

test("branchToContext caps to the last BRANCH_CAP entries", () => {
  const entries: SessionEntry[] = Array.from({ length: BRANCH_CAP + 10 }, (_, i) => msgEntry(`e${i}`, `m${i}`));
  const ctx = branchToContext(entries);
  assert.equal(ctx.length, BRANCH_CAP);
  // The last entry survives; the first (m0) is dropped by the cap.
  assert.equal(typeof ctx[0].content === "string" ? ctx[0].content : "", "m10");
  assert.equal(
    typeof ctx[ctx.length - 1].content === "string" ? ctx[ctx.length - 1].content : "",
    `m${BRANCH_CAP + 9}`,
  );
});

// ── runAside ────────────────────────────────────────────────────────────────

const okAuth = async () => ({ ok: true as const, apiKey: "k", headers: {} });

test("runAside happy path returns the answer and calls complete with no tools + a system prompt", async () => {
  let seen: { systemPrompt?: string; tools?: unknown[]; messageCount: number } | undefined;
  const deps: AsideDeps = {
    model: MODEL,
    getApiKeyAndHeaders: okAuth,
    complete: async (_m, c) => {
      seen = { systemPrompt: c.systemPrompt, tools: c.tools, messageCount: c.messages.length };
      return assistant("the answer", "stop");
    },
  };
  const context: Message[] = [{ role: "user", content: "prior", timestamp: Date.now() }];
  const res = await runAside(deps, "why?", context, new AbortController());
  assert.deepEqual(res, { ok: true, answer: "the answer" });
  assert.equal(seen?.systemPrompt, ASIDE_SYSTEM);
  assert.deepEqual(seen?.tools, []);
  // prior context + the appended question.
  assert.equal(seen?.messageCount, 2);
});

test("runAside on auth failure returns {ok:false} and never calls complete", async () => {
  let called = false;
  const deps: AsideDeps = {
    model: MODEL,
    getApiKeyAndHeaders: async () => ({ ok: false as const, error: "no key" }),
    complete: async () => {
      called = true;
      return assistant("nope", "stop");
    },
  };
  const res = await runAside(deps, "q", [], new AbortController());
  assert.equal(res.ok, false);
  assert.equal(called, false);
});

test("runAside maps stopReason 'error' to a typed failure", async () => {
  const deps: AsideDeps = {
    model: MODEL,
    getApiKeyAndHeaders: okAuth,
    complete: async () => assistant("", "error", "boom"),
  };
  const res = await runAside(deps, "q", [], new AbortController());
  assert.deepEqual(res, { ok: false, error: "boom" });
});

test("runAside maps stopReason 'aborted' to {ok:false, aborted:true}", async () => {
  const deps: AsideDeps = {
    model: MODEL,
    getApiKeyAndHeaders: okAuth,
    complete: async () => assistant("", "aborted"),
  };
  const res = await runAside(deps, "q", [], new AbortController());
  assert.deepEqual(res, { ok: false, aborted: true });
});

// ── the headline NO-SESSION-WRITE invariant + guards ──────────────────────────

/**
 * Drive the registered `/aside` handler with a fake pi + ctx, capturing every
 * session-write method. The invariant: across a full run NONE of
 * sendMessage/sendUserMessage/appendEntry are ever called — a `display:false`
 * injected message would still leak into LLM context because `convertToLlm` maps
 * a `custom` message to `role:"user"` regardless of `display`
 * (session-manager.d.ts:85-99), so the only zero-leak route is to write nothing.
 */
function harness(
  overrides: Partial<{
    hasUI: boolean;
    mode: string;
    model: unknown;
    args: string;
    complete: AsideDeps["complete"];
    // Default true: dismiss (Esc) as soon as the overlay opens, mimicking the
    // scientist. Set false to drive the answer-then-dismiss path by hand.
    autoDismiss: boolean;
  }> = {},
) {
  const writes = { sendMessage: 0, sendUserMessage: 0, appendEntry: 0 };
  const notifies: { message: string; type?: string }[] = [];
  let handler: ((args: string, ctx: any) => Promise<void>) | undefined;
  let customShown = false;
  // The async-push repaint: the overlay must ask the TUI to render when the answer
  // lands (invalidate() alone never schedules a frame). Spy on requestRender.
  let renders = 0;
  const tuiSpy = {
    requestRender: () => {
      renders++;
    },
  };
  let comp: { handleInput?(data: string): void } | undefined;

  const pi = {
    registerCommand(_name: string, opts: { handler: (args: string, ctx: any) => Promise<void> }) {
      handler = opts.handler;
    },
    sendMessage() {
      writes.sendMessage++;
    },
    sendUserMessage() {
      writes.sendUserMessage++;
    },
    appendEntry() {
      writes.appendEntry++;
    },
  } as unknown as Parameters<typeof berilAside>[0];

  const ctx = {
    hasUI: overrides.hasUI ?? true,
    mode: overrides.mode ?? "tui",
    model: "model" in overrides ? overrides.model : MODEL,
    cwd: "/tmp",
    sessionManager: { getBranch: () => [msgEntry("a", "hi")] },
    modelRegistry: { getApiKeyAndHeaders: okAuth },
    signal: undefined,
    // Injectable completer seam: keeps the run network-free (no module mocks).
    __asideComplete: overrides.complete,
    // Session-write methods also exist on the command context; spy on them too.
    sendMessage() {
      writes.sendMessage++;
    },
    sendUserMessage() {
      writes.sendUserMessage++;
    },
    appendEntry() {
      writes.appendEntry++;
    },
    ui: {
      notify(message: string, type?: string) {
        notifies.push({ message, type });
      },
      // Invoke the factory (passing a tui with a requestRender spy), then by
      // default mimic the scientist dismissing once the answer is in.
      async custom<T>(factory: (tui: any, theme: any, kb: any, done: (r: T) => void) => any) {
        customShown = true;
        let resolve!: (r: T) => void;
        const p = new Promise<T>((r) => {
          resolve = r;
        });
        comp = factory(tuiSpy, fakeTheme, {}, resolve);
        if (overrides.autoDismiss !== false) {
          Promise.resolve().then(() => comp?.handleInput?.("\x1b")); // Esc
        }
        return p;
      },
    },
  };

  return {
    pi,
    ctx,
    writes,
    notifies,
    run: async () => handler?.(overrides.args ?? "what is X?", ctx),
    wasShown: () => customShown,
    renders: () => renders,
    dismiss: () => comp?.handleInput?.("\x1b"),
  };
}

const fakeTheme = {
  fg: (_c: string, s: string) => s,
  bold: (s: string) => s,
  getColorMode: () => "truecolor" as const,
} as any;

test("NO-SESSION-WRITE: a full /aside run never writes to the session", async () => {
  // Inject a fake completer via the ctx seam (no module mocks, no network); the
  // overlay path renders the answer and the run must persist nothing.
  const h = harness({ complete: async () => assistant("answer", "stop") });
  berilAside(h.pi);
  await h.run();
  assert.deepEqual(h.writes, { sendMessage: 0, sendUserMessage: 0, appendEntry: 0 });
  assert.equal(h.wasShown(), true);
});

test("repaints the overlay when the answer arrives (requestRender, not on next keystroke)", async () => {
  // Hold the overlay open so the answer push runs while it is still visible.
  const h = harness({ complete: async () => assistant("the answer", "stop"), autoDismiss: false });
  berilAside(h.pi);
  const runP = h.run();
  // Let runAside resolve and the answer push (setAnswer + requestRender) run.
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(h.renders() >= 1, "the overlay requests a repaint when the answer lands");
  h.dismiss(); // Esc — release the awaiting handler
  await runP;
});

test("guard: headless (non-tui) /aside notifies and writes nothing", async () => {
  const h = harness({ hasUI: false, mode: "print" });
  berilAside(h.pi);
  await h.run();
  assert.deepEqual(h.writes, { sendMessage: 0, sendUserMessage: 0, appendEntry: 0 });
  assert.equal(h.wasShown(), false);
  assert.equal(h.notifies[0]?.type, "error");
});

test("guard: empty-arg /aside notifies usage and writes nothing", async () => {
  const h = harness({ args: "   " });
  berilAside(h.pi);
  await h.run();
  assert.deepEqual(h.writes, { sendMessage: 0, sendUserMessage: 0, appendEntry: 0 });
  assert.equal(h.wasShown(), false);
  assert.equal(h.notifies[0]?.type, "warning");
});

test("guard: no-model /aside notifies and writes nothing", async () => {
  const h = harness({ model: undefined });
  berilAside(h.pi);
  await h.run();
  assert.deepEqual(h.writes, { sendMessage: 0, sendUserMessage: 0, appendEntry: 0 });
  assert.equal(h.wasShown(), false);
  assert.equal(h.notifies[0]?.type, "error");
});

// ── glyph NO_COLOR downgrade ──────────────────────────────────────────────────

test("glyph downgrades to ASCII under NO_COLOR (overlay banner glyph)", () => {
  const prev = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  try {
    assert.equal(glyph("here"), ">");
    assert.equal(glyph("inProgress"), "[.]");
  } finally {
    // Restore: "" is falsy for the `if (process.env.NO_COLOR)` gate, so it
    // reads as unset without using `delete` (which biome flags).
    process.env.NO_COLOR = prev ?? "";
  }
});
