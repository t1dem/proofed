import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cacheKey, estimate, historyKey, readCache, relevantChanges, writeCache } from "./cache.ts";
import { gitPath } from "../paths.ts";
import type { Scenario } from "../scenarios.ts";

const scenario = (paths: string[]): Scenario => ({ id: "promo", file: ".proofed/scenarios/promo.md", name: "Promo", paths, url: "/", objective: "Apply welcome10." });

test("a pass stays good until its file, its URL or a changed file in its paths changes", () => {
  const files: Record<string, string> = { ".proofed/scenarios/promo.md": "v1", "src/pricing.ts": "a", "src/other.ts": "x" };
  const read = (f: string) => files[f];
  const s = scenario(["src/pricing.ts"]);
  const changed = ["src/pricing.ts", "src/other.ts"];
  const key = cacheKey(s, "http://localhost:4173/", changed, read);

  files["src/other.ts"] = "y";
  assert.equal(cacheKey(s, "http://localhost:4173/", changed, read), key, "a file outside its paths doesn't count");
  assert.notEqual(cacheKey(s, "http://localhost:5173/", changed, read), key);
  files["src/pricing.ts"] = "b";
  assert.notEqual(cacheKey(s, "http://localhost:4173/", changed, read), key);
  files["src/pricing.ts"] = "a";
  files[".proofed/scenarios/promo.md"] = "v2";
  assert.notEqual(cacheKey(s, "http://localhost:4173/", changed, read), key);
  files[".proofed/scenarios/promo.md"] = "v1";
  assert.equal(cacheKey(s, "http://localhost:4173/", changed, read), key, "back as it was, the pass is good again");
  assert.notEqual(cacheKey(s, "http://localhost:4173/", ["src/other.ts"], read), key, "pricing.ts no longer changed");
});

test("a scenario without paths depends on every changed file", () => {
  const files: Record<string, string> = { ".proofed/scenarios/promo.md": "v1", "README.md": "a" };
  const s = scenario([]);
  const key = cacheKey(s, "http://x/", ["README.md"], (f) => files[f]);
  files["README.md"] = "b";
  assert.notEqual(cacheKey(s, "http://x/", ["README.md"], (f) => files[f]), key);
});

test("a POSIX filename with a backslash keeps its own cache identity", { skip: process.platform === "win32" }, () => {
  const nested = "src/config.ts";
  const flat = gitPath("src\\config.ts");
  assert.notEqual(flat, nested);
  assert.deepEqual(relevantChanges(scenario(["src/**"]), [flat, nested]), [nested]);
  const files = { [flat]: "before", [nested]: "same" };
  const key = () => cacheKey(scenario(["**/*.ts"]), "http://x/", [flat], (f) => files[f]);
  const before = key();
  files[flat] = "after";
  assert.notEqual(key(), before);
});

test("the cache file round-trips; without history a web run is estimated at 30 credits and a desktop one is unknown", () => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-cache-"));
  try {
    const file = join(dir, "cache.json");
    const empty = readCache(file);
    assert.deepEqual(empty, { version: 1, passes: {}, last: {} });
    const web = scenario([]);
    const desktop = { ...web, resolvedTarget: { kind: "desktop", execution: "local", launch: "app", cdp_endpoint: "http://127.0.0.1:9223", reuse: false, sources: {}, dir: "." } } as unknown as Scenario;
    assert.equal(estimate(empty, web, "0.10.4"), 30);
    assert.equal(estimate(empty, desktop, "0.10.4"), null);
    writeCache(file, { version: 1, passes: { promo: { key: "k", passedAt: "2026-11-16T10:00:00.000Z" } }, last: { [historyKey(web, "0.10.4")]: { credits: 27 } } });
    const back = readCache(file);
    assert.equal(back.passes.promo?.key, "k");
    assert.equal(estimate(back, web, "0.10.4"), 27);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a pass doesn't survive a new base commit: a pull or a rebase changes code that isn't in the local change", () => {
  const s = scenario(["src/**"]);
  const read = (f: string) => ({ [s.file]: "scenario", "src/a.ts": "1" })[f];
  const key = cacheKey(s, "http://x/", ["src/a.ts"], read, "base-1");
  assert.equal(cacheKey(s, "http://x/", ["src/a.ts"], read, "base-1"), key);
  assert.notEqual(cacheKey(s, "http://x/", ["src/a.ts"], read, "base-2"), key);
});

test("globs cover changed dotfiles in the cache key", () => {
  const s = scenario(["src/**"]);
  const files: Record<string, string> = { "src/.config/settings": "before" };
  const changed = Object.keys(files);
  const read = (file: string) => files[file];
  const key = cacheKey(s, "http://x/", changed, read);
  files["src/.config/settings"] = "after";
  assert.notEqual(cacheKey(s, "http://x/", changed, read), key);
  const workflow = ".github/workflows/check.yml";
  assert.deepEqual(relevantChanges(scenario(["**/check.yml"]), [workflow]), [workflow]);
  assert.deepEqual(relevantChanges(scenario([".github/**"]), [workflow]), [workflow]);
  assert.deepEqual(relevantChanges(scenario(["{src/app,src/server}/**"]), ["src/app/.env", "src/server/.env", "src/vendor/.env"]), ["src/app/.env", "src/server/.env"]);
  assert.deepEqual(relevantChanges(scenario(["src/{**,test}/.env"]), ["src/.app/frontend/.env"]), ["src/.app/frontend/.env"]);
  assert.deepEqual(relevantChanges(scenario(["src/?.env"]), ["src/.env", "src/..env", "src/sub/a.env"]), ["src/..env"]);
});

test("the cache follows a symlinked app directory without following the links within it", { skip: process.platform === "win32" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-cache-"));
  try {
    const app = join(dir, "current.app");
    const bundle = join(dir, "build.app");
    mkdirSync(bundle);
    symlinkSync(bundle, app);
    symlinkSync(bundle, join(bundle, "loop"));
    const contents = join(bundle, "executable");
    writeFileSync(contents, "before");
    const s: Scenario = { ...scenario([]), resolvedTarget: { kind: "desktop", execution: "local", app, reuse: false, sources: {}, dir } };
    const key = cacheKey(s, "", []);
    writeFileSync(contents, "after");
    assert.notEqual(cacheKey(s, "", []), key);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
