// A per-isolate cache for GitHub answers that every dashboard request would otherwise ask for again
// (the user's repos, installation tokens, whether a workflow is switched off). An isolate serves many
// requests in a row, so most of them skip GitHub; a cold one just asks. Requests that arrive while
// an answer is on its way share it.
const entries = new Map<string, { until: number; value: Promise<unknown> }>();

export function memo<T>(key: string, ttlMs: number | ((value: T) => number), load: () => Promise<T>): Promise<T> {
  const hit = entries.get(key);
  if (hit && hit.until > Date.now()) return hit.value as Promise<T>;
  const value = load();
  // Until it settles, the entry only dedupes; a failure is never kept.
  entries.set(key, { until: Date.now() + 30_000, value });
  value.then(
    (v) => entries.get(key)?.value === value && entries.set(key, { until: Date.now() + (typeof ttlMs === "number" ? ttlMs : ttlMs(v)), value }),
    () => entries.get(key)?.value === value && entries.delete(key),
  );
  return value;
}

export const forget = (key: string) => entries.delete(key);
