// Passes Proofed doesn't pay for twice. A coding agent runs the check again after each fix, and a
// scenario it didn't touch would cost another 20 to 30 credits to come out the same. A pass stays
// good while its scenario file, its start URL and the changed files in its `paths` (every changed
// file, when it has none) stay as they were. Only passes are kept; everything else runs again.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { matchesGlob } from "node:path";
import type { Scenario } from "./scenarios.ts";

export type CachedPass = {
  key: string;
  passedAt: string;
  seconds?: number;
  clip?: { mp4?: string; jpg?: string };
};

// `last`: the credits each scenario's latest run took, pass or not, for the estimate.
export type Cache = { version: 1; passes: Record<string, CachedPass>; last: Record<string, { credits: number }> };

export const CACHE_FILE = "cache.json";
// Until a scenario has run once, the estimate takes the middle of Kane's usual 20 to 30.
export const DEFAULT_CREDITS = 25;

export function readCache(file: string): Cache {
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as Partial<Cache>;
    if (data.version === 1) return { version: 1, passes: data.passes ?? {}, last: data.last ?? {} };
  } catch {
    // Missing or unreadable: start over, the worst case is paying for a run again.
  }
  return { version: 1, passes: {}, last: {} };
}

export const writeCache = (file: string, cache: Cache) => writeFileSync(file, `${JSON.stringify(cache, null, 2)}\n`);

export const estimate = (cache: Cache, id: string) => cache.last[id]?.credits ?? DEFAULT_CREDITS;

// The changed files a scenario depends on.
export const relevantChanges = (s: Scenario, changed: string[]) =>
  s.paths.length ? changed.filter((f) => s.paths.some((glob) => matchesGlob(f, glob))) : changed;

const readOrUndefined = (file: string) => {
  try {
    return readFileSync(file);
  } catch {
    return undefined; // Deleted in the change.
  }
};

export function cacheKey(s: Scenario, startUrl: string, changed: string[], read: (file: string) => Uint8Array | string | undefined = readOrUndefined) {
  const hash = createHash("sha256");
  // Length-prefixed, so no two different lists of parts hash the same.
  const add = (part: Uint8Array | string) => hash.update(`${typeof part === "string" ? Buffer.byteLength(part) : part.length}:`).update(part);
  add(read(s.file) ?? s.objective);
  add(startUrl);
  for (const file of relevantChanges(s, changed).toSorted()) {
    add(file);
    add(read(file) ?? "\0deleted");
  }
  return hash.digest("hex");
}
