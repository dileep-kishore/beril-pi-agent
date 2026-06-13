/**
 * A tiny bounded worker pool over Promise.allSettled semantics: run `fn` over
 * `items` with at most `limit` in flight, returning per-item tagged results IN
 * INPUT ORDER so a failure never sinks the batch (mirrors PromiseSettledResult
 * intent with a smaller `{ ok, value | error }` shape). Zero dependencies,
 * strip-safe (plain function, no enum/class/param-props).
 */

export type Settled<T> = { ok: true; value: T } | { ok: false; error: Error };

export async function parallelMap<I, O>(
  items: readonly I[],
  limit: number,
  fn: (item: I, index: number) => Promise<O>,
): Promise<Settled<O>[]> {
  const out: Settled<O>[] = new Array(items.length);
  let next = 0;
  const workers = Math.max(1, Math.min(limit, items.length || 1));
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        out[i] = { ok: true, value: await fn(items[i], i) };
      } catch (e) {
        out[i] = { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
      }
    }
  };
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}
