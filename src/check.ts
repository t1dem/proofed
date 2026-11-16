// `proofed check`: the PR check, run on this machine against the local change. Picks the scenarios
// the change touches, skips the passes it already paid for, makes sure the app answers, runs the
// rest with Kane in Chrome and says what broke: drawn live in a terminal, as plain lines in a pipe,
// as one JSON document with --json.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Flags } from "./args.ts";
import { CACHE_FILE, cacheKey, estimate, readCache, writeCache, type CachedPass } from "./cache.ts";
import { findBase, localChanges } from "./changes.ts";
import { killChildren, stopChildren } from "./children.ts";
import { findChrome } from "./chrome.ts";
import { setLog } from "./log.ts";
import { runAll } from "./pipeline.ts";
import { colorOn, LiveView, PlainView, type Plan, type Stream, type View } from "./render.ts";
import { askedScenario } from "./requests.ts";
import { buildDoc, errorDoc, quote, scenarioDoc, type Doc, type ErrorDoc, type Item, type RerunContext, type Skipped } from "./result.ts";
import type { RunEvent, ScenarioResult } from "./run.ts";
import { affectedBy, readScenarios, type Scenario } from "./scenarios.ts";
import { answers, startApp, type RunningApp } from "./serve.ts";
import { SetupError } from "./setuperror.ts";
import { resolveTarget, type Setting } from "./target.ts";
import { findKane } from "./which.ts";

export type Io = {
  stdout: Stream & { isTTY?: boolean; on?: (event: "resize", fn: () => void) => unknown };
  stderr: Stream;
  env: NodeJS.ProcessEnv;
  cwd: string;
};

export const RESULT_FILE = "result.json";

export const outDirOf = (flags: Pick<Flags, "out">, io: Pick<Io, "env" | "cwd">) => resolve(io.cwd, flags.out || io.env.PROOFED_OUT?.trim() || ".proofed-out");
export const scenariosDirOf = (flags: Pick<Flags, "scenarios">, io: Pick<Io, "env">) => flags.scenarios || io.env.PROOFED_SCENARIOS?.trim() || ".proofed/scenarios";

// Clips must never end up committed in the app's repo.
export function ensureOut(out: string) {
  if (existsSync(out)) return;
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, ".gitignore"), "*\n");
}

export function makeView(flags: Flags, io: Io): View {
  if (flags.json) return new PlainView(io.stderr, { color: colorOn(io.env, false) });
  if (io.stdout.isTTY && io.env.TERM !== "dumb") {
    const view = new LiveView(io.stdout, { color: colorOn(io.env, true), err: io.stderr });
    io.stdout.on?.("resize", () => view.draw());
    return view;
  }
  return new PlainView(io.stdout, { color: colorOn(io.env, false), err: io.stderr });
}

const fromNote = (s: Setting) => (s.from.startsWith("--") ? "" : ` (url from ${s.from})`);

// Flags that say where the app and the scenarios are, so a re-run command runs the same way.
function rerunFlags(flags: Flags) {
  const pass: [string, string | undefined][] = [
    ["--url", flags.url],
    ["--serve", flags.serve],
    ["--build", flags.build],
    ["--scenarios", flags.scenarios],
    ["--out", flags.out],
  ];
  return [...pass.flatMap(([name, v]) => (v ? [`${name} ${quote(v)}`] : [])), ...(flags.json ? ["--json"] : [])];
}

export async function check(flags: Flags, text: string | undefined, io: Io, view = makeView(flags, io)): Promise<number> {
  const started = Date.now();
  const out = outDirOf(flags, io);
  const dir = scenariosDirOf(flags, io);
  const rerun: RerunContext = { text, flags: rerunFlags(flags) };
  const finished = new Map<string, ScenarioResult>();
  let app: RunningApp | undefined;

  const write = (doc: Doc | ErrorDoc) => {
    ensureOut(out);
    writeFileSync(join(out, RESULT_FILE), `${JSON.stringify(doc, null, 2)}\n`);
    if (flags.json) io.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
  };

  // Ctrl-C (or a kill) mid-run: Kane, every Chrome and the app go first, then the exit.
  // The run that was going ends on its own once Kane is killed; its result is dropped, the
  // interrupt writes the document and sets the exit code.
  let selected: Scenario[] = [];
  let interrupted: Promise<number> | undefined;
  const interrupt = (signal: NodeJS.Signals) => {
    // A second Ctrl-C doesn't wait for anything.
    if (interrupted) {
      killChildren();
      process.exit(130);
    }
    view.close();
    io.stderr.write(`\nInterrupted (${signal}): stopping Kane, Chrome and the app.\n`);
    interrupted = (async () => {
      await stopChildren();
      await app?.stop();
      const done = selected.filter((s) => finished.has(s.id)).map((s) => scenarioDoc({ scenario: s, result: finished.get(s.id)! }, rerun));
      write(errorDoc(new SetupError("interrupted", `Stopped by ${signal} before the check finished.`, "Run the check again and let it finish; passes so far are cached."), 130, done));
      return 130;
    })();
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);

  try {
    const doc = await run();
    if (interrupted) return await interrupted;
    write(doc);
    if (doc.dryRun) {
      for (const d of doc.scenarios) view.info(`${d.cached ? "cached:   " : "would run:"} ${d.id} (${d.name})${d.cached ? "" : `, about ${d.estimatedCredits} credits`}`);
      view.info(`${doc.summary}. Dry run: nothing ran, no credits spent.`);
      view.info(doc.next);
      view.close();
    } else if (doc.scenarios.length === 0) {
      // Nothing to run; the reason is already on screen.
      view.close();
    } else {
      view.done(doc);
    }
    return doc.exitCode;
  } catch (e) {
    if (interrupted) return await interrupted;
    if (!(e instanceof SetupError)) throw e;
    const doc = errorDoc(e);
    write(doc);
    view.fail(doc);
    return 3;
  } finally {
    await app?.stop();
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }

  async function run(): Promise<Doc> {
    const loaded = readScenarios(dir);
    if (!text && loaded.missing) {
      throw new SetupError("scenarios_missing", `No scenarios: ${dir} doesn't exist here (${io.cwd}).`, `Run proofed in the app's repo, pass --scenarios <dir>, or check one thing: proofed check "the cart total updates"`);
    }
    if (!text && loaded.errors.length) {
      const [first] = loaded.errors;
      throw new SetupError("scenario_invalid", loaded.errors.map((e) => `${e.file}: ${e.message}`).join("\n"), `Fix the frontmatter of ${first!.file} (see proofed list).`);
    }
    const all = loaded.scenarios;

    const base = text ? undefined : findBase(io.cwd, flags.base);
    const changed = base?.rev ? localChanges(io.cwd, base.rev) : undefined;
    const common = {
      base: base?.rev ?? null,
      changedFiles: changed?.length ?? null,
      seconds: 0,
      out,
      rerun,
      estimatedCredits: 0,
    };

    let skipped: Skipped[];
    let selection: string;
    if (text) {
      selected = [askedScenario("terminal", text)];
      skipped = all.map((s) => ({ id: s.id, name: s.name, why: "only your text is checked" }));
      selection = "your text";
    } else if (flags.only) {
      const unknown = flags.only.filter((id) => !all.some((s) => s.id === id));
      if (unknown.length) {
        throw new SetupError("unknown_scenario", `No scenario ${unknown.join(", ")} in ${dir}. Scenarios: ${all.map((s) => s.id).join(", ") || "none"}.`, `Use ids from proofed list, e.g. proofed check --only ${all[0]?.id ?? "<id>"}`);
      }
      selected = all.filter((s) => flags.only!.includes(s.id));
      skipped = all.filter((s) => !selected.includes(s)).map((s) => ({ id: s.id, name: s.name, why: "not in --only" }));
      selection = "--only";
    } else if (flags.all || !changed) {
      selected = all;
      skipped = [];
      selection = flags.all ? "--all" : `every scenario, ${base?.why ?? "no base branch"}`;
    } else if (changed.length === 0) {
      const summary = `Nothing changed against ${base!.rev}.`;
      view.info(`${summary} Use --all to run every scenario.`);
      return buildDoc({ ...common, items: [], skipped: all.map((s) => ({ id: s.id, name: s.name, why: "nothing changed" })), url: null, idle: { summary, next: "Nothing to check. To run every scenario anyway: proofed check --all" } });
    } else {
      selected = affectedBy(all, changed);
      skipped = all.filter((s) => !selected.includes(s)).map((s) => ({ id: s.id, name: s.name, why: "the change does not touch its paths" }));
      selection = `changes against ${base!.rev} (${changed.length} file${changed.length === 1 ? "" : "s"})`;
      if (selected.length === 0) {
        const summary = `No scenario covers the ${changed.length} changed file${changed.length === 1 ? "" : "s"}.`;
        view.info(`${summary} Use --all to run every scenario.`);
        return buildDoc({ ...common, items: [], skipped, url: null, idle: { summary, next: "Nothing to check. To run every scenario anyway: proofed check --all" } });
      }
    }

    const target = resolveTarget({ flags: { url: flags.url, serve: flags.serve, build: flags.build }, env: io.env, cwd: io.cwd });
    const url = target.url?.value;
    if (url !== undefined && !URL.canParse(url)) {
      throw new SetupError("url_invalid", `"${url}" (${target.url!.from}) is not a URL.`, "Pass a full URL, e.g. --url http://localhost:5173");
    }

    const cacheFile = join(out, CACHE_FILE);
    const cache = readCache(cacheFile);
    const keys = new Map<string, string>();
    const items = new Map<string, Item>();
    for (const s of selected) {
      if (s.file && url && changed && !flags.noCache) {
        const key = cacheKey(s, new URL(s.url, url).href, changed);
        keys.set(s.id, key);
        const hit = cache.passes[s.id];
        if (hit?.key === key) items.set(s.id, { scenario: s, cached: hit });
      }
      if (!items.has(s.id)) items.set(s.id, { scenario: s, estimate: s.file ? estimate(cache, s.id) : 25 });
    }
    const toRun = selected.filter((s) => "estimate" in items.get(s.id)!);
    const cachedPasses = selected.flatMap((s) => {
      const item = items.get(s.id)!;
      return "cached" in item ? [{ id: s.id, name: s.name, cachedAt: item.cached.passedAt }] : [];
    });
    const estimatedCredits = toRun.reduce((sum, s) => sum + (items.get(s.id) as { estimate: number }).estimate, 0);
    const plan: Plan = {
      run: toRun,
      cached: cachedPasses,
      total: text ? 1 : all.length,
      selection,
      url,
      estimate: estimatedCredits,
      concurrency: flags.concurrency ?? (Number(io.env.PROOFED_CONCURRENCY) || 3),
      dryRun: flags.dryRun,
    };
    const showPlan = () => {
      view.plan(plan);
      if (target.url && !target.url.from.startsWith("--")) view.info(`url ${target.url.value} from ${target.url.from}`);
    };
    const docOf = (list: Item[], extra: Partial<Parameters<typeof buildDoc>[0]> = {}) =>
      buildDoc({ ...common, items: list, skipped, url: url ?? null, estimatedCredits, seconds: Math.round((Date.now() - started) / 1000), ...extra });

    if (flags.dryRun) {
      showPlan();
      return docOf(selected.map((s) => items.get(s.id)!), { dryRun: true });
    }
    if (toRun.length === 0) {
      showPlan();
      return docOf(selected.map((s) => items.get(s.id)!));
    }

    // The cheap checks first: nothing starts unless Kane and Chrome are both there.
    const kane = findKane(io.env);
    if (!kane.path) {
      throw new SetupError("kane_missing", `Kane CLI not found (${kane.from}).`, io.env.KANE_CLI ? "Point KANE_CLI at the kane-cli binary, or unset it." : "npm install -g @testmuai/kane-cli, then kane-cli login");
    }
    if (!findChrome()) throw new SetupError("chrome_missing", "Chrome not found.", "Install Google Chrome, or set CHROME_PATH to its binary.");
    if (!url) {
      throw new SetupError("no_url", "Proofed doesn't know where the app runs.", `Pass --url http://localhost:5173 (and --serve "npm run dev" to have Proofed start it), set PROOFED_URL, or write .proofed/config.json: { "url": "http://localhost:5173", "serve": "npm run dev" }`);
    }

    ensureOut(out);
    const runLog = join(out, "run.log");
    writeFileSync(runLog, "");
    setLog((line) => {
      appendFileSync(runLog, `${line}\n`);
      if (flags.verbose) view.log(line);
    });

    showPlan();
    if (await answers(url)) {
      view.info(`The app answers at ${url}; using it as it is.`);
    } else if (target.serve) {
      const logFile = join(out, "serve.log");
      writeFileSync(logFile, "");
      const t0 = Date.now();
      app = await startApp({
        url,
        serve: target.serve.value,
        build: target.build?.value,
        cwd: target.dir,
        logFile,
        timeoutSeconds: flags.serveTimeout ?? 60,
        onPhase: (line) => view.phase(line),
      });
      const from = [target.build && `build from ${target.build.from}`, `serve from ${target.serve.from}`].filter(Boolean).join(", ");
      view.info(`Started the app in ${Math.round((Date.now() - t0) / 1000)} s (${from}); its output is in ${logFile}`);
    } else {
      throw new SetupError("app_not_reachable", `Nothing answers at ${url}${fromNote(target.url!)}.`, `Start the app first, or pass the command that serves it: proofed check --serve "npm run dev"`);
    }

    view.start();
    const onEvent = (e: RunEvent) => {
      view.event(e);
      if (e.type !== "finished") return;
      finished.set(e.id, e.result);
      const key = keys.get(e.id);
      if (!key) return;
      const credits = e.result.end?.credits_consumed;
      if (credits !== undefined) cache.last[e.id] = { credits };
      if (e.result.outcome === "passed") {
        const clip = e.result.clip && { ...(e.result.clip.mp4 && { mp4: resolve(e.result.clip.mp4) }), jpg: resolve(e.result.clip.jpg) };
        cache.passes[e.id] = { key, passedAt: new Date().toISOString(), seconds: e.result.seconds, ...(clip && { clip }) } satisfies CachedPass;
      } else {
        delete cache.passes[e.id];
      }
      writeCache(cacheFile, cache);
    };
    const results = await runAll(toRun, out, plan.concurrency, { baseUrl: url, headless: !flags.headed, onEvent });
    const byId = new Map(results.map((r) => [r.scenario.id, r]));
    return docOf(selected.map((s) => {
      const r = byId.get(s.id);
      return r ? { scenario: s, result: r } : items.get(s.id)!;
    }));
  }
}

export const readResult = (out: string) => JSON.parse(readFileSync(join(out, RESULT_FILE), "utf8")) as Doc | ErrorDoc;
