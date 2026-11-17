// `proofed list`: every scenario, whether the local change touches it and whether a pass of it is
// cached. Reads files and git only; spends nothing.
import { join } from "node:path";
import type { Flags } from "./args.ts";
import { CACHE_FILE, cacheKey, estimate, readCache } from "./cache.ts";
import { findBase, localChanges, mergeBaseOf } from "./changes.ts";
import { outDirOf, scenariosDirOf, scenariosMissing, type Io } from "./check.ts";
import { colorOn, palette, since, textWidth, truncate } from "./render.ts";
import { errorDoc } from "./result.ts";
import { affectedBy, readScenarios } from "./scenarios.ts";
import { SetupError } from "./setuperror.ts";
import { isHttpUrl, resolveTarget } from "./target.ts";

export function list(flags: Flags, io: Io): number {
  const c = palette(colorOn(io.env, !!io.stdout.isTTY));
  try {
    return show();
  } catch (e) {
    if (!(e instanceof SetupError)) throw e;
    if (flags.json) io.stdout.write(`${JSON.stringify(errorDoc(e))}\n`);
    else io.stderr.write(`${c.red("✗")} ${e.message}\n  ${c.dim("Fix")} ${e.fix}\n`);
    return 3;
  }

  function show() {
    const dir = scenariosDirOf(flags, io);
    const loaded = readScenarios(dir);
    if (loaded.missing) throw scenariosMissing(dir, flags, io, "list");
    const base = findBase(io.cwd, flags.base);
    const changed = base.rev ? localChanges(io.cwd, base.rev) : undefined;
    const baseId = base.rev ? mergeBaseOf(io.cwd, base.rev) : "";
    const url = resolveTarget({ flags: { url: flags.url }, env: io.env, cwd: io.cwd }).url?.value;
    const cache = readCache(join(outDirOf(flags, io), CACHE_FILE));
    const scenarios = loaded.scenarios.map((s) => {
      const hit = cache.passes[s.id];
      const cached = !!(hit && url && isHttpUrl(url) && changed && hit.key === cacheKey(s, new URL(s.url, url).href, changed, undefined, baseId));
      const touched = changed ? affectedBy([s], changed).length > 0 : null;
      const selected = touched !== false;
      return {
        id: s.id,
        name: s.name,
        file: s.file,
        url: s.url,
        paths: s.paths,
        touched,
        selected,
        estimatedCredits: selected && !cached ? estimate(cache, s.id) : 0,
        cached,
        ...(cached && { cachedAt: hit!.passedAt }),
      };
    });
    const exitCode = loaded.errors.length ? 3 : 0;
    if (flags.json) {
      const doc = { ok: exitCode === 0, exitCode, base: base.rev ?? null, changedFiles: changed?.length ?? null, url: url ?? null, scenarios, errors: loaded.errors, estimatedCredits: scenarios.reduce((sum, s) => sum + s.estimatedCredits, 0) };
      io.stdout.write(`${JSON.stringify(doc)}\n`);
      return exitCode;
    }

    const where = base.rev ? `changes against ${base.rev}: ${changed!.length} file${changed!.length === 1 ? "" : "s"}` : `${base.why}, so every scenario runs`;
    io.stdout.write(`${scenarios.length} scenario${scenarios.length === 1 ? "" : "s"} in ${dir}; ${where}.\n\n`);
    const rows = [
      ["ID", "NAME", "URL", "CHANGED", "CACHED", "PATHS"],
      ...scenarios.map((s) => [
        s.id,
        s.name,
        s.url,
        s.touched === null ? "?" : s.touched ? "yes" : "no",
        s.cachedAt ? `pass ${since(s.cachedAt)}` : "no",
        s.paths.join(", ") || "(every change)",
      ]),
    ];
    const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => textWidth(r[i]!))));
    const room = io.stdout.isTTY ? (io.stdout.columns || 80) - 1 : Infinity;
    for (const [n, r] of rows.entries()) {
      const cells = r.map((cell, i) => (i === r.length - 1 ? cell : cell + " ".repeat(widths[i]! - textWidth(cell))));
      const line = truncate(cells.join("  "), room);
      io.stdout.write(`${n === 0 ? c.dim(line) : line}\n`);
    }
    for (const e of loaded.errors) io.stdout.write(`${c.red("✗")} ${e.file}: ${e.message}\n`);
    if (loaded.errors.length) io.stdout.write(`\n${loaded.errors.length} file(s) don't parse; proofed check stops until they do.\n`);
    return exitCode;
  }
}
