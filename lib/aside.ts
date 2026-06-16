import { complete } from "@earendil-works/pi-ai";
import type { AssistantMessage, Context, Message, Model, ProviderStreamOptions } from "@earendil-works/pi-ai";
import { convertToLlm } from "@earendil-works/pi-coding-agent";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

/**
 * The pure, testable core of `/aside` — the off-the-record side channel.
 *
 * The whole point is **zero leak**: a `/aside` question and its answer must never
 * enter the session JSONL the model replays next turn, and must never enter the
 * claim ledger. So the command writes NOTHING to the session — no `sendMessage`,
 * no `sendUserMessage`, no `appendEntry` — and renders only via `ctx.ui.custom`.
 * (`convertToLlm` maps a `custom` message to a `role:"user"` LLM message
 * regardless of `display`, see `session-manager.d.ts:85-99`, so even a
 * `display:false` injected message would silently leak; the only safe route is to
 * persist nothing at all.) This module owns the prompt const, the branch→context
 * projection, and the model call — each injectable so tests run with no network.
 */

/** Cap on how many recent message entries we re-send as context to the aside model. */
export const BRANCH_CAP = 40;

/** System prompt for the off-the-record model call — a TS const, mirroring CONDUCT_CONTRACT. */
export const ASIDE_SYSTEM = `You are answering an off-the-record side question from the scientist driving a research session.

This exchange is NOT part of the session: your answer is shown once in an overlay and then discarded — the agent running the session will never see this question or your answer, and nothing you write here enters the research record or the claim ledger.

Answer the question directly and concisely, using the conversation so far only as background. Do not propose tool calls, do not start an analysis, and do not assume your answer will be acted on — it is for the scientist's eyes only.`;

/** The model + auth + completion the aside needs — injectable so tests need no network. */
export interface AsideDeps {
  model: Model<any>;
  getApiKeyAndHeaders: ExtensionCommandContext["modelRegistry"]["getApiKeyAndHeaders"];
  complete?: (model: Model<any>, ctx: Context, opts: ProviderStreamOptions) => Promise<AssistantMessage>;
}

/** The outcome of one aside: an answer, or a typed failure the overlay can show. */
export type AsideResult = { ok: true; answer: string } | { ok: false; aborted?: boolean; error?: string };

/**
 * Project a session branch into LLM context for the aside: keep only `message`
 * entries (`session-manager.d.ts:23-26` — thinking/model-change/custom entries
 * carry no LLM message), take the last {@link BRANCH_CAP}, and map their
 * `.message` through `convertToLlm` (the same transform the agent uses). Nothing
 * is written back — this is a read-only projection.
 */
export function branchToContext(entries: readonly SessionEntry[]): Message[] {
  const messages = entries
    .filter((e): e is Extract<SessionEntry, { type: "message" }> => e.type === "message")
    .slice(-BRANCH_CAP)
    .map((e) => e.message);
  return convertToLlm(messages);
}

/** Extract the assistant text from a completed message (joined, trimmed). */
function answerText(response: AssistantMessage): string {
  return response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("")
    .trim();
}

/**
 * Run one off-the-record completion: resolve the model's auth, call `complete`
 * with NO tools, the {@link ASIDE_SYSTEM} prompt, the branch context, and the
 * caller's own abort signal, then map the result. There is no `"endTurn"` stop
 * reason — the union is `stop|length|toolUse|error|aborted` (`pi-ai`), so
 * `"aborted"`/`"error"` become typed failures and everything else extracts text.
 */
export async function runAside(
  deps: AsideDeps,
  question: string,
  context: Message[],
  controller: AbortController,
): Promise<AsideResult> {
  const completeFn = deps.complete ?? complete;
  const auth = await deps.getApiKeyAndHeaders(deps.model);
  if (!auth.ok) return { ok: false, error: auth.error };

  let response: AssistantMessage;
  try {
    response = await completeFn(
      deps.model,
      {
        systemPrompt: ASIDE_SYSTEM,
        messages: [...context, { role: "user", content: question, timestamp: Date.now() }],
        tools: [],
      },
      { apiKey: auth.apiKey, headers: auth.headers, signal: controller.signal },
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  if (response.stopReason === "aborted") return { ok: false, aborted: true };
  if (response.stopReason === "error")
    return { ok: false, error: response.errorMessage ?? "the model returned an error" };
  return { ok: true, answer: answerText(response) };
}
