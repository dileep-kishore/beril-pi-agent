import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

/**
 * BERIL model roles. The launcher (`beril start --provider cborg`) exports one
 * env var per role (e.g. `BERIL_REVIEW_MODEL=cborg/lbl/cborg-deepthought`);
 * extensions resolve them here instead of hardcoding a provider. Custom-provider
 * models (CBORG) only exist in `ctx.modelRegistry` — pi-ai's `getModel` sees the
 * built-in catalog only — so all resolution goes through the registry.
 */
export type BerilModelRole = "main" | "fast" | "review" | "vision";

/** Env var carrying the role's model reference, e.g. `BERIL_REVIEW_MODEL`. */
export function roleEnvName(role: BerilModelRole): string {
  return `BERIL_${role.toUpperCase()}_MODEL`;
}

/**
 * The registry surface resolution needs. Both methods are optional because
 * existing test stubs (and defensive callers) may provide only auth methods —
 * a registry without them simply resolves nothing.
 */
export interface ModelLookup {
  find?: (provider: string, modelId: string) => Model<any> | undefined;
  getAll?: () => Model<any>[];
}

/**
 * Resolve a model reference against the registry. References are either
 * `provider/modelId` — split on the FIRST slash only, and the prefix is treated
 * as a provider only when the registry resolves it (model ids may themselves
 * contain slashes: `cborg/lbl/cborg-deepthought`) — or a bare model id, searched
 * under `BERIL_MODEL_PROVIDER`, then `preferredProvider`, then as a unique match
 * across the whole registry. Ambiguous bare ids resolve to nothing.
 */
export function resolveModelReference(
  registry: ModelLookup | undefined,
  reference: string,
  preferredProvider?: string,
): Model<any> | undefined {
  const ref = reference.trim();
  if (!ref || !registry) return undefined;
  const slash = ref.indexOf("/");
  if (slash > 0) {
    const m = registry.find?.(ref.slice(0, slash), ref.slice(slash + 1));
    if (m) return m;
  }
  for (const provider of [process.env.BERIL_MODEL_PROVIDER, preferredProvider]) {
    if (provider) {
      const m = registry.find?.(provider, ref);
      if (m) return m;
    }
  }
  const matches = registry.getAll?.().filter((m) => m.id === ref) ?? [];
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Resolve the model for a BERIL role: the role's env reference if it resolves,
 * else `fallback` (a provider/model pair looked up in the registry), else the
 * session's `ctx.model`. Callers choose the precedence of the session model by
 * passing a fallback or not: review passes its Anthropic default (which should
 * beat the session model, auth permitting, as today), while literature passes
 * none (the session model keeps winning in non-CBORG sessions).
 */
export function resolveRoleModel(
  ctx: Pick<ExtensionCommandContext, "model" | "modelRegistry">,
  role: BerilModelRole,
  fallback?: { provider: string; model: string },
): Model<any> | undefined {
  const registry = ctx.modelRegistry as ModelLookup | undefined;
  const ref = process.env[roleEnvName(role)];
  if (ref?.trim()) {
    const m = resolveModelReference(registry, ref, fallback?.provider);
    if (m) return m;
  }
  if (fallback) {
    const m = registry?.find?.(fallback.provider, fallback.model);
    if (m) return m;
  }
  return ctx.model;
}
