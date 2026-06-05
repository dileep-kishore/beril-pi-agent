import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverHint, queryHint } from "../lib/hints.ts";

/**
 * Append a short advisory next-step hint to a successful BERDL tool result so the
 * model tightens its analysis loop (e.g. raise `limit` on a truncated query, or
 * sample a table it just discovered).
 *
 * The patch returns ONLY `content` — the structured `details` payload is never
 * included, so the byte-identical result payload (Inv 2) is preserved. The hint
 * runs on `tool_result`, after a SUCCESSFUL result, so it never bypasses the
 * `tool_call` safety gate (Inv 5).
 */
export default function berilHints(pi: ExtensionAPI) {
  pi.on("tool_result", (event, _ctx) => {
    if (event.isError) return undefined;

    let hint: string | undefined;
    if (event.toolName === "berdl_query") {
      const details = event.details as { returned_rows?: number; limit_applied?: number | null } | undefined;
      hint = queryHint(details?.returned_rows ?? 0, details?.limit_applied ?? null);
    } else if (event.toolName === "berdl_discover") {
      hint = discoverHint(event.details);
    } else {
      return undefined;
    }

    if (!hint) return undefined;
    return { content: [...event.content, { type: "text", text: hint }] };
  });
}
