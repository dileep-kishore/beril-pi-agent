/**
 * Parse a JSONL stream from `pi --mode json`. Splits on "\n" ONLY — Node's
 * readline also breaks on U+2028/U+2029, which are valid inside JSON strings.
 * Unparseable lines are skipped.
 */
export function parseJsonl(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as Record<string, unknown>);
    } catch {
      // ignore partial/non-JSON lines
    }
  }
  return out;
}

interface TextBlock {
  type?: string;
  text?: string;
}
interface Message {
  role?: string;
  content?: TextBlock[] | string;
}

function messageText(msg: Message | undefined): string {
  if (!msg) return "";
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("");
  }
  return "";
}

/**
 * Extract the final assistant text from a parsed `pi --mode json` event stream.
 * Prefers the last `agent_end` (with `messages`), falling back to the last
 * assistant `message_end`.
 */
export function lastAssistantText(events: Record<string, unknown>[]): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "agent_end" && Array.isArray(e.messages)) {
      const msgs = e.messages as Message[];
      for (let j = msgs.length - 1; j >= 0; j--) {
        if (msgs[j].role === "assistant") return messageText(msgs[j]);
      }
    }
  }
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "message_end") {
      const msg = (e.message ?? e) as Message;
      if (msg.role === "assistant" || !msg.role) return messageText(msg);
    }
  }
  return "";
}
