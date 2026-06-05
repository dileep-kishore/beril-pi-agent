import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { berilExec } from "./beril-exec.ts";

export interface BerdlEnv {
  location: "on-cluster" | "off-cluster" | "unknown";
  ready: boolean;
  checks: Record<string, boolean>;
  next_steps: string[];
}

/**
 * Resolve to the BERDL readiness report, or throw a guidance error when not connected.
 *
 * `beril env --json` always exits 0 and carries readiness in the `ready` field, so a
 * not-ready environment surfaces here as a thrown Error containing the actionable
 * next steps (SSH tunnels / pproxy / token) rather than a failed subprocess.
 */
export async function requireReady(pi: Pick<ExtensionAPI, "exec">): Promise<BerdlEnv> {
  const env = await berilExec<BerdlEnv>(pi, ["env", "--json"]);
  if (!env.ready) {
    const steps = (env.next_steps ?? []).join("\n- ");
    throw new Error(`BERDL not ready (${env.location}). Next steps:\n- ${steps}`);
  }
  return env;
}
