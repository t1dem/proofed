import { matchesPath } from "../paths.ts";
// Passes Proofed doesn't pay for twice. A coding agent runs the check again after each fix, and a
// scenario it didn't touch would cost another 20 to 30 credits to come out the same. A pass stays
// good while its scenario file, its start URL, the commit the change is measured from and the
// changed files in its `paths` (every changed file, when it has none) stay as they were. Only
// passes are kept; everything else runs again.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, lstatSync, readlinkSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Scenario } from "../scenarios.ts";
import type { WebService } from "../targets/target.ts";

export type CachedPass = {
  key: string;
  passedAt: string;
  seconds?: number;
  clip?: { mp4?: string; jpg?: string };
};

// `last`: the credits each scenario's latest run took, pass or not, for the estimate.
export type Cache = { version: 1; passes: Record<string, CachedPass>; last: Record<string, { credits: number }> };

export const CACHE_FILE = "cache.json";
// The demo-store runs reported 27 to 30 credits without accounting for the balance change.
export const DEFAULT_CREDITS = 30;

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

// Web runs have a known typical cost; native and desktop targets have none until their first run.
export const estimate = (cache: Cache, s: Scenario, kaneVersion: string) =>
  cache.last[historyKey(s, kaneVersion)]?.credits ?? ((s.resolvedTarget?.kind ?? "web") === "web" ? DEFAULT_CREDITS : null);

// The changed files a scenario depends on.
export const relevantChanges = (s: Scenario, changed: string[]) =>
  s.paths.length ? changed.filter((f) => s.paths.some((glob) => matchesPath(f, glob))) : changed;

const readOrUndefined = (file: string) => {
  try {
    return readFileSync(file);
  } catch {
    return undefined; // Deleted in the change.
  }
};

// `base`: the commit the change is measured from (mergeBaseOf).
export function cacheKey(s: Scenario, startUrl: string, changed: string[], read: (file: string) => Uint8Array | string | undefined = readOrUndefined, base = "", kaneVersion = "", service?: WebService) {
  const hash = createHash("sha256");
  // Length-prefixed, so no two different lists of parts hash the same.
  const add = (part: Uint8Array | string) => hash.update(`${typeof part === "string" ? Buffer.byteLength(part) : part.length}:`).update(part);
  add(read(s.file) ?? s.objective);
  add(startUrl);
  if (s.resolvedTarget) {
    const { sources, ...target } = s.resolvedTarget;
    add(JSON.stringify(target));
    add(kaneVersion);
    if ("app" in target && target.app && !/^APP[\w-]+$/.test(target.app)) {
      const digest = (file: string, appRoot = false) => {
        try {
          let stat = lstatSync(file);
          if (stat.isSymbolicLink()) {
            add(readlinkSync(file));
            if (!appRoot) return;
            // Follow the app path itself. Links inside the artifact remain leaves.
            stat = statSync(file);
          }
          if (stat.isDirectory()) for (const name of readdirSync(file).sort()) { add(name); digest(join(file, name)); }
          else add(readFileSync(file));
        } catch { add("missing"); }
      };
      digest(target.app, true);
    }
  }
  if (service && (s.resolvedTarget?.kind ?? s.target ?? "web") === "web" && (service.build || service.install)) {
    add(JSON.stringify([service.build?.value, service.install?.value]));
  }
  add(base);
  for (const file of relevantChanges(s, changed).toSorted()) {
    add(file);
    add(read(file) ?? "\0deleted");
  }
  return hash.digest("hex");
}

export function historyKey(s: Scenario, version: string) {
  return cacheKey({ ...s, file: "", paths: [], objective: s.id }, "", [], () => undefined, "", version);
}

// A configured native build must run before we know its artifact. Looking up the old artifact's
// pass first can skip the rebuild altogether, even when the fixer changed a file outside paths.
export const canReusePass = (s: Scenario, build?: string) => (s.resolvedTarget?.kind ?? s.target ?? "web") === "web" || !build?.trim();
