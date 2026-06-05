import assert from "node:assert/strict";
import { test } from "node:test";
import { lastAssistantText, parseJsonl } from "../lib/jsonl.ts";

test("parseJsonl splits on newline only and skips bad lines", () => {
  const text = '{"a":1}\n\nnot json\n{"b":2}\n';
  assert.deepEqual(parseJsonl(text), [{ a: 1 }, { b: 2 }]);
});

test("parseJsonl keeps U+2028 inside a JSON string intact", () => {
  const text = `{"t":"line break"}\n{"x":1}`;
  const out = parseJsonl(text);
  assert.equal(out.length, 2);
  assert.equal(out[0].t, "line break");
});

test("lastAssistantText extracts from agent_end.messages", () => {
  const events = [
    { type: "session" },
    {
      type: "agent_end",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: [{ type: "text", text: "answer" }] },
      ],
    },
  ];
  assert.equal(lastAssistantText(events), "answer");
});

test("lastAssistantText falls back to message_end", () => {
  const events = [
    { type: "message_start" },
    { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "fallback" }] } },
  ];
  assert.equal(lastAssistantText(events), "fallback");
});

test("lastAssistantText returns empty on no assistant output", () => {
  assert.equal(lastAssistantText([{ type: "session" }]), "");
});
