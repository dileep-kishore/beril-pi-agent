import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CONDUCT_CONTRACT } from "../lib/conduct.ts";

/**
 * Inject the always-on research-conduct contract into the system prompt.
 *
 * Pi has no package-level system prompt, so this extension appends the contract
 * on every turn via `before_agent_start`. The event carries the fully assembled
 * `systemPrompt`; returning a new `systemPrompt` replaces it for the turn (Pi
 * chains this across extensions), so we append rather than overwrite. Because the
 * base prompt is re-assembled each turn, the append is idempotent — it never
 * stacks up across turns.
 *
 * Headless runs (`--print`/`--mode json`) get the contract too: it shapes
 * behavior without any UI, so there is no `ctx.hasUI` gate.
 */
export default function berilConduct(pi: ExtensionAPI) {
  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${CONDUCT_CONTRACT}`,
  }));
}
