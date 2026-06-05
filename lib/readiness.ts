import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { berilExec } from "./beril-exec.ts";

export interface BerdlEnv {
  location: "on-cluster" | "off-cluster" | "unknown";
  ready: boolean;
  checks: Record<string, boolean>;
  next_steps: string[];
}

/** How long a ready readiness verdict is trusted before re-execing `beril env`. */
const TTL_MS = 30_000;

let cached: { env: BerdlEnv; at: number } | undefined;

/** Fresh-or-undefined: the cached env if within TTL, else undefined. */
export function readCachedEnv(): BerdlEnv | undefined {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.env;
  return undefined;
}

/** Seed the cache (e.g. from `beril-env.ts:refreshStatus` after its own exec). */
export function setCachedEnv(env: BerdlEnv): void {
  cached = { env, at: Date.now() };
}

/** Drop the cache. Tests call this in `beforeEach` so each test starts cold. */
export function resetReadinessCache(): void {
  cached = undefined;
}

/**
 * Resolve to the BERDL readiness report, or throw a guidance error when not connected.
 *
 * `beril env --json` always exits 0 and carries readiness in the `ready` field, so a
 * not-ready environment surfaces here as a thrown Error containing the actionable
 * next steps (SSH tunnels / pproxy / token) rather than a failed subprocess.
 *
 * A fresh, ready cache short-circuits the exec; a not-ready state is never served as a
 * fast path (it is re-verified on every call so a recovered tunnel is picked up).
 */
export async function requireReady(pi: Pick<ExtensionAPI, "exec">): Promise<BerdlEnv> {
  const fresh = readCachedEnv();
  if (fresh?.ready) return fresh;
  const env = await berilExec<BerdlEnv>(pi, ["env", "--json"]);
  setCachedEnv(env);
  if (!env.ready) {
    const steps = (env.next_steps ?? []).join("\n- ");
    throw new Error(`BERDL not ready (${env.location}). Next steps:\n- ${steps}`);
  }
  return env;
}
