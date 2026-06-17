/**
 * Pure, UI-agnostic next-step advisories for BERDL tool results. These produce
 * short model-visible nudges; they never touch the structured `details` payload
 * and never recompute anything reproducibility-sensitive.
 */

/**
 * Advise raising the limit when a query returned exactly as many rows as the
 * applied cap (a strong signal the result set was truncated). Returns undefined
 * when no limit was applied or the result is comfortably under the cap.
 */
export function queryHint(returnedRows: number, limitApplied: number | null): string | undefined {
  if (limitApplied != null && returnedRows === limitApplied) {
    return `Result may be truncated (returned ${returnedRows} = limit ${limitApplied}). Raise \`limit\` or filter further to see more.`;
  }
  return undefined;
}

/**
 * Nudge the model to sample a freshly discovered collection. Matches the real
 * `berdl_discover` snapshot shape — `{ tenants: [{ collections: [...] }] }` —
 * and returns undefined unless at least one tenant exposes a collection.
 */
export function discoverHint(snapshot: unknown): string | undefined {
  if (snapshot && typeof snapshot === "object") {
    const tenants = (snapshot as { tenants?: unknown }).tenants;
    if (Array.isArray(tenants)) {
      const hasCollection = tenants.some((tenant) => {
        const collections = (tenant as { collections?: unknown })?.collections;
        return Array.isArray(collections) && collections.length > 0;
      });
      if (hasCollection) {
        return "Use `berdl_peek` to preview a table (schema + sample rows), then frame and select candidate research questions grounded in the collections you just discovered before querying them.";
      }
    }
  }
  return undefined;
}
