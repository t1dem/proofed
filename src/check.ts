// `proofed check`: the PR check, run on this machine against the local change. Picks the scenarios
// the change touches, skips the passes it already paid for, makes sure the app answers, runs the
// rest with Kane in Chrome and says what broke: drawn live in a terminal, as plain lines in a pipe,
// as one JSON document with --json.
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Flags } from "./args.ts";
import { CACHE_FILE, canReusePass, DEFAULT_CREDITS, cacheKey, historyKey, estimate, readCache, writeCache, type CachedPass } from "./cache.ts";
import { findBase, localChanges, mergeBaseOf, repoRoot } from "./changes.ts";
import { killChildren, stopChildren } from "./children.ts";
import { findChrome } from "./chrome.ts";
import { KEYS_FIX, kaneLogin, LOGIN_FIX } from "./kaneauth.ts";
import { setLog } from "./log.ts";
import { runAll, runConcurrency } from "./pipeline.ts";
import { colorOn, LiveView, PlainView, type Plan, type Stream, type View } from "./render.ts";
import { askedScenario } from "./requests.ts";
import { buildDoc, errorDoc, quote, sameCommand, scenarioDoc, type Doc, type ErrorDoc, type Item, type RerunContext, type Skipped } from "./result.ts";
import { creditsOf, type RunEvent, type ScenarioResult } from "./run.ts";
import { affectedBy, readScenarios, type Scenario } from "./scenarios.ts";
import { answers, buildApp, startApp, type RunningApp } from "./serve.ts";
import { SetupError } from "./setuperror.ts";
import { isHttpUrl, resolveTarget, resolveScenarioTarget, type Setting } from "./target.ts";
import { readKaneVersion } from "./kaneversion.ts";
import { targetChecks } from "./targetchecks.ts";
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
  mkdirSync(out, { recursive: true });
  const ignore = join(out, ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
}

// Run from a folder inside the repo, the default scenarios folder isn't there; say where it is.
export function scenariosMissing(dir: string, flags: Pick<Flags, "scenarios">, io: Pick<Io, "cwd">, command: string) {
  const root = flags.scenarios ? undefined : repoRoot(io.cwd);
  if (root && root !== realpathSync(io.cwd) && existsSync(join(root, dir))) {
    return new SetupError("wrong_directory", `${dir} is at the repository root, not in ${io.cwd}.`, `Run it from the root: cd ${quote(root)} && proofed ${command}`);
  }
  return new SetupError("scenarios_missing", `No scenarios: ${dir} doesn't exist here (${io.cwd}).`, `Run proofed in the app's repo, pass --scenarios <dir>, or check one thing: proofed check "the cart total updates"`);
}

export function makeView(flags: Flags, io: Io): View {
  // An agent's shell shows stderr next to stdout: with --json, only progress goes there, since
  // the details and the summary are in the document.
  if (flags.json) return new PlainView(io.stderr, { color: colorOn(io.env, false), brief: true });
  if (io.stdout.isTTY && io.env.TERM !== "dumb") {
    const view = new LiveView(io.stdout, { color: colorOn(io.env, true), err: io.stderr });
    io.stdout.on?.("resize", () => view.draw());
    return view;
  }
  return new PlainView(io.stdout, { color: colorOn(io.env, false), err: io.stderr });
}

const notSignedIn = (message = "Kane CLI is not signed in, so it can't run the scenarios. Nothing was built or run.") =>
  new SetupError("kane_not_signed_in", message, `${LOGIN_FIX}, then run the check again.`);

const keysRejected = (detail: string) =>
  new SetupError("kane_keys_rejected", `${detail}, so Kane can't run the scenarios. Nothing was built or run.`, `${KEYS_FIX}, then run the check again.`);

const fromNote = (s: Setting) => (s.from.startsWith("--") ? "" : ` (url from ${s.from})`);

// Flags that say where the app and the scenarios are and how to run, so a printed command runs
// the same way. Not --no-cache or --dry-run: those were about this run.
function rerunFlags(flags: Flags) {
  const pass: [string, string | undefined][] = [
    ["--target", flags.target],
    ["--execution", flags.execution],
    ["--app", flags.app],
    ["--device", flags.device],
    ["--os-version", flags.os_version],
    ["--launch", flags.launch],
    ["--cdp-endpoint", flags.cdp_endpoint],

    ["--url", flags.url],
    ["--serve", flags.serve],
    ["--build", flags.build],
    ["--install", flags.install],
    ["--serve-timeout", flags.serveTimeout?.toString()],
    ["--base", flags.base],
    ["--scenarios", flags.scenarios],
    ["--out", flags.out],
    ["--concurrency", flags.concurrency?.toString()],
  ];
  const on = [flags.reuse && "--reuse", flags.noRetry && "--no-retry", flags.headed && "--headed", flags.json && "--json"].filter((f): f is string => !!f);
  return [...pass.flatMap(([name, v]) => (v ? [`${name} ${quote(v)}`] : [])), ...on];
}

export async function check(flags: Flags, text: string | undefined, io: Io, view = makeView(flags, io)): Promise<number> {
  const started = Date.now();
  const out = outDirOf(flags, io);
  const dir = scenariosDirOf(flags, io);
  const rerun: RerunContext = { text, flags: rerunFlags(flags), selection: flags.only ? `--only ${flags.only.join(",")}` : flags.all ? "--all" : undefined };
  const finished = new Map<string, ScenarioResult>();
  let app: RunningApp | undefined;

  const write = (doc: Doc | ErrorDoc) => {
    ensureOut(out);
    writeFileSync(join(out, RESULT_FILE), `${JSON.stringify(doc, null, 2)}\n`);
    if (flags.json) io.stdout.write(`${JSON.stringify(doc)}\n`);
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
    io.stderr.write(`\nInterrupted (${signal}): stopping Kane, Chrome and the app. Kane may have spent credits before reporting them.\n`);
    interrupted = (async () => {
      await stopChildren();
      await app?.stop();
      const done = selected.filter((s) => finished.has(s.id)).map((s) => scenarioDoc({ scenario: s, result: finished.get(s.id)! }, rerun));
      write(errorDoc(new SetupError("interrupted", `Stopped by ${signal} before the check finished. Kane may have spent credits before reporting them.`, "Run the check again and let it finish; passes so far are cached."), 130, done));
      return 130;
    })();
  };
  // SIGHUP: a closed terminal tab or a dropped SSH session. Unhandled, it ends Node without
  // stopping Kane, which runs on in its own process group and keeps spending credits.
  const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
  for (const signal of SIGNALS) process.on(signal, interrupt);

  try {
    const doc = await run();
    if (interrupted) return await interrupted;
    write(doc);
    if (doc.dryRun && flags.json) {
      view.close();
    } else if (doc.dryRun) {
      for (const d of doc.scenarios) view.info(`${d.cached ? "cached:   " : "would run:"} ${d.id} (${d.name})${d.cached ? "" : `, ${d.estimatedCredits === null ? "unknown" : Math.round((d.estimatedCredits ?? 0) * 100) / 100} credits`}`);
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
    // Anything unexpected is exit 3 with a document too: exit 1 means "a scenario failed", and an
    // old result.json left in place would say the previous run's verdict.
    const known = e instanceof SetupError;
    if (!known && flags.verbose && e instanceof Error) io.stderr.write(`${e.stack}\n`);
    const doc = errorDoc(
      known ? e : new SetupError("internal", `Proofed hit an unexpected error: ${e instanceof Error ? e.message : String(e)}`, "Run it again with --verbose for the stack; nothing was checked."),
    );
    write(doc);
    view.fail(doc);
    return 3;
  } finally {
    await app?.stop();
    for (const signal of SIGNALS) process.off(signal, interrupt);
  }

  async function run(): Promise<Doc> {
    const loaded = readScenarios(dir);
    if (!text && loaded.missing) throw scenariosMissing(dir, flags, io, "check");
    if (!text && loaded.errors.length) {
      const [first] = loaded.errors;
      throw new SetupError("scenario_invalid", loaded.errors.map((e) => `${e.file}: ${e.message}`).join("\n"), `Correct the frontmatter of ${first!.file} (see proofed list).`);
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
      // A scenario's id or name as the text would otherwise pay for a vague check of those words.
      const named = all.find((s) => [s.id, s.name].some((n) => n.toLowerCase() === text.trim().toLowerCase()));
      if (named) throw new SetupError("text_is_scenario", `"${text}" is the scenario ${named.id} in ${dir}, not a behavior to check.`, `Run that scenario: proofed check --only ${named.id}. Or describe the behavior in words: proofed check "<what to check>".`);
      selected = [askedScenario("terminal", text, resolveScenarioTarget({}, flags, io.env, io.cwd))];
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
      return buildDoc({ ...common, items: [], skipped: all.map((s) => ({ id: s.id, name: s.name, why: "nothing changed" })), url: null, idle: { summary, next: `Nothing to check. To run every scenario anyway: ${sameCommand(rerun, "--all")}` } });
    } else {
      selected = affectedBy(all, changed);
      skipped = all.filter((s) => !selected.includes(s)).map((s) => ({ id: s.id, name: s.name, why: "the change does not touch its paths" }));
      selection = `changes against ${base!.rev} (${changed.length} file${changed.length === 1 ? "" : "s"})`;
      if (selected.length === 0) {
        const summary = `No scenario covers the ${changed.length} changed file${changed.length === 1 ? "" : "s"}.`;
        view.info(`${summary} Use --all to run every scenario.`);
        return buildDoc({ ...common, items: [], skipped, url: null, idle: { summary, next: `Nothing to check. To run every scenario anyway: ${sameCommand(rerun, "--all")}` } });
      }
    }

    const targetFilter = flags.target ?? io.env.PROOFED_TARGET;
    selected = selected.map((s) => ({ ...s, resolvedTarget: resolveScenarioTarget(s, flags, io.env, io.cwd) }));
    if (targetFilter && !text) {
      const matches = (s: Scenario) => (s.target ?? "web") === targetFilter;
      if (flags.only && selected.some((s) => !matches(s))) throw new SetupError("target_selection", "--only contains scenarios incompatible with --target", "Select ids with the requested target.");
      skipped.push(...selected.filter((s) => !matches(s)).map((s) => ({ id: s.id, name: s.name, why: "different target" })));
      selected = selected.filter(matches);
    }
    const needsWeb = selected.some((s) => s.resolvedTarget!.kind === "web");
    const target = resolveTarget({ flags: { url: flags.url, serve: flags.serve, build: flags.build, install: flags.install }, env: io.env, cwd: io.cwd });
    const needsHttp = needsWeb;
    const url = target.url?.value;
    if (needsHttp && url !== undefined && !isHttpUrl(url)) {
      throw new SetupError("url_invalid", `"${url}" (${target.url!.from}) is not an http(s) URL.`, "Pass a full URL, e.g. --url http://localhost:5173");
    }
    const baseId = base?.rev ? mergeBaseOf(io.cwd, base.rev) : "";
    let appState: "started" | "reused" | undefined;

    const concurrency = runConcurrency(io.env, flags.concurrency);
    const kaneBin = findKane(io.env).path;
    const kaneVersion = kaneBin ? readKaneVersion(kaneBin, io.env) : "unknown";
    const cacheFile = join(out, CACHE_FILE);
    const cache = readCache(cacheFile);
    const keys = new Map<string, string>();
    const items = new Map<string, Item>();
    for (const s of selected) {
      if (s.file && (s.resolvedTarget!.kind !== "web" || url) && changed && !flags.noCache && kaneVersion !== "unknown") {
        const key = cacheKey(s, s.resolvedTarget!.kind === "web" ? new URL(s.url, url!).href : "", changed, undefined, baseId, kaneVersion);
        keys.set(s.id, key);
        const hit = cache.passes[s.id];
        if (canReusePass(s, target.build?.value) && hit?.key === key) items.set(s.id, { scenario: s, cached: hit });
      }
      if (!items.has(s.id)) items.set(s.id, { scenario: s, estimate: estimate(cache, s, kaneVersion) });
    }
    const toRun = selected.filter((s) => "estimate" in items.get(s.id)!);
    const cachedPasses = selected.flatMap((s) => {
      const item = items.get(s.id)!;
      return "cached" in item ? [{ id: s.id, name: s.name, cachedAt: item.cached.passedAt }] : [];
    });
    const estimates = toRun.map((s) => (items.get(s.id) as { estimate: number | null }).estimate);
    const estimatedCredits = estimates.includes(null) ? null : estimates.reduce<number>((sum, n) => sum + (n ?? 0), 0);
    const plan: Plan = {
      run: toRun,
      cached: cachedPasses,
      total: text ? 1 : all.length,
      selection,
      url,
      estimate: estimatedCredits,
      concurrency,
      dryRun: flags.dryRun,
    };
    const showPlan = () => {
      view.plan(plan);
      if (target.url && !target.url.from.startsWith("--")) view.info(`url ${target.url.value} from ${target.url.from}`);
    };
    const docOf = (list: Item[], extra: Partial<Parameters<typeof buildDoc>[0]> = {}) =>
      buildDoc({ ...common, items: list, skipped, url: url ?? null, app: appState, estimatedCredits, seconds: Math.round((Date.now() - started) / 1000), ...extra });

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
    if (selected.some((s) => ["web", "desktop"].includes(s.resolvedTarget!.kind)) && !findChrome()) throw new SetupError("chrome_missing", "Chrome not found.", "Install Google Chrome, or set CHROME_PATH to its binary.");
    if (needsHttp && !url) {
      throw new SetupError("no_url", "Proofed doesn't know where the app runs.", `Pass --url http://localhost:5173 (and --serve "npm run dev" to have Proofed start it), set PROOFED_URL, or write .proofed/config.json: { "url": "http://localhost:5173", "serve": "npm run dev" }`);
    }
    const login = await kaneLogin(kane.path, io.env);
    if (login.state === "not_signed_in") throw notSignedIn(login.detail === "not signed in" ? undefined : `Kane CLI can't run the scenarios: ${login.detail}. Nothing was built or run.`);
    if (login.state === "keys_rejected") throw keysRejected(login.detail);

    ensureOut(out);
    const runLog = join(out, "run.log");
    writeFileSync(runLog, "");
    setLog((line) => {
      appendFileSync(runLog, `${line}\n`);
      if (flags.verbose) view.log(line);
    });

    showPlan();
    if (needsHttp && await answers(url!)) {
      // With a build configured, what answers was built from some earlier code, and a pass on it
      // would be a pass nobody saw.
      if (target.build && !flags.reuse) {
        throw new SetupError(
          "app_already_running",
          `Something already answers at ${url}, so Proofed can't build and serve the current code there (build: ${target.build.value}). It may be serving an old build.`,
          `Stop the server on that port and run the check again, or pass --reuse to test what is running as it is.`,
        );
      }
      appState = "reused";
      view.info(`The app answers at ${url}; using it as it is${target.build ? " (--reuse: not rebuilt, passes are not cached)" : ""}.`);
    } else if (needsHttp && target.serve) {
      const logFile = join(out, "serve.log");
      writeFileSync(logFile, "");
      const t0 = Date.now();
      app = await startApp({
        url: url!,
        serve: target.serve.value,
        build: target.build?.value,
        install: target.install,
        cwd: target.dir,
        logFile,
        timeoutSeconds: flags.serveTimeout ?? 60,
        onPhase: (line) => view.phase(line),
      });
      appState = "started";
      const from = [target.build && `build from ${target.build.from}`, `serve from ${target.serve.from}`].filter(Boolean).join(", ");
      view.info(`Started the app in ${Math.round((Date.now() - t0) / 1000)} s (${from}); its output is in ${logFile}`);
    } else if (needsHttp) {
      throw new SetupError("app_not_reachable", `Nothing answers at ${url}${fromNote(target.url!)}.`, `Start the app first, or pass the command that serves it: proofed check --serve "npm run dev"`);
    }

    if (appState !== "started" && toRun.some((s) => s.resolvedTarget!.kind !== "web") && (target.build || target.install)) {
      await buildApp({ build: target.build?.value, install: target.install, cwd: target.dir, logFile: join(out, "build.log"), onPhase: (line) => view.phase(line) });
    }
    for (const s of toRun) {
      if (s.resolvedTarget!.kind !== "web" && keys.has(s.id)) keys.set(s.id, cacheKey(s, "", changed ?? [], undefined, baseId, kaneVersion));
      const checks = await targetChecks(s.resolvedTarget!, { env: io.env, launchPending: true });
      const failed = checks.filter((c) => c.status === "fail");
      if (failed.length) throw new SetupError("target_not_ready", failed.map((c) => `${c.name}: ${c.detail}`).join("\n"), failed.map((c) => c.fix).join("\n"));
    }
    view.start();
    const cacheable = !(appState === "reused" && target.build);
    const onEvent = (e: RunEvent) => {
      view.event(e);
      if (e.type !== "finished") return;
      finished.set(e.id, e.result);
      const key = keys.get(e.id);
      if (e.result.end?.credits_consumed !== undefined) cache.last[historyKey(selected.find((s) => s.id === e.id)!, kaneVersion)] = { credits: creditsOf(e.result) };
      if (!key) { writeCache(cacheFile, cache); return; }
      if (e.result.outcome === "passed" && cacheable) {
        const clip = e.result.clip && { ...(e.result.clip.mp4 && { mp4: resolve(e.result.clip.mp4) }), jpg: resolve(e.result.clip.jpg) };
        cache.passes[e.id] = { key, passedAt: new Date().toISOString(), seconds: e.result.seconds, ...(clip && { clip }) } satisfies CachedPass;
      } else {
        delete cache.passes[e.id];
      }
      writeCache(cacheFile, cache);
    };
    const results = await runAll(toRun, out, plan.concurrency, { baseUrl: url ?? "", headless: !flags.headed, noRetry: flags.noRetry, onEvent });
    // A login can run out between the login check and the runs; running the check again wouldn't help then either.
    if (results.some((r) => r.notSignedIn)) throw notSignedIn("Kane CLI refused to run a scenario: it is not signed in. The scenarios it refused weren't checked.");
    const byId = new Map(results.map((r) => [r.scenario.id, r]));
    return docOf(selected.map((s) => {
      const r = byId.get(s.id);
      return r ? { scenario: s, result: r } : items.get(s.id)!;
    }));
  }
}

export const readResult = (out: string) => JSON.parse(readFileSync(join(out, RESULT_FILE), "utf8")) as Doc | ErrorDoc;
