// A per-isolate cache for GitHub answers that every dashboard request would otherwise ask for again
// (the user's repos, installation tokens, whether a workflow is switched off). An isolate serves many
// requests in a row, so most of them skip GitHub; a cold one just asks.
//
// Only finished answers are kept. A request can't wait on a promise another request started: if that
// request is cancelled (the page reloaded), the promise dies with it and everyone waiting on it fails.
const entries = new Map<string, { until: number; value: unknown }>();

export async function memo<T>(key: string, ttlMs: number | ((value: T) => number), load: () => Promise<T>): Promise<T> {
  const hit = entries.get(key);
  if (hit && hit.until > Date.now()) return hit.value as T;
  const value = await load();
  entries.set(key, { until: Date.now() + (typeof ttlMs === "number" ? ttlMs : ttlMs(value)), value });
  return value;
}

export const forget = (key: string) => entries.delete(key);
