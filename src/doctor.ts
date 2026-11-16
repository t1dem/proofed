// `proofed doctor`: whether `proofed check` can run here, and the exact fix for what can't. It only
// calls Kane's free commands (--version, whoami, balance); no run, no credits.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Flags } from "./args.ts";
import { DEFAULT_CREDITS } from "./cache.ts";
import { scenariosDirOf, type Io } from "./check.ts";
import { findBase } from "./changes.ts";
import { findChrome } from "./chrome.ts";
import { colorOn, palette, stripAnsi } from "./render.ts";
import { readScenarios } from "./scenarios.ts";
import { answers } from "./serve.ts";
import { SetupError } from "./setuperror.ts";
import { isHttpUrl, resolveTarget } from "./target.ts";
import { findKane, findOnPath } from "./which.ts";

export type Status = "ok" | "warn" | "fail";
export type DoctorCheck = { name: string; status: Status; detail: string; fix?: string };

const run = promisify(execFile);

// Kane prints update notices around its answer; only the answer counts.
async function kane(bin: string, args: string[], env: NodeJS.ProcessEnv) {
  try {
    const { stdout, stderr } = await run(bin, args, { env, timeout: 20_000 });
    return { ok: true, text: stripAnsi(`${stdout}\n${stderr}`) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, text: stripAnsi(`${err.stdout ?? ""}\n${err.stderr ?? ""}`) };
  }
}

export async function doctorChecks(flags: Flags, io: Io): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const add = (name: string, status: Status, detail: string, fix?: string) => checks.push({ name, status, detail, ...(fix && { fix }) });

  const major = Number(process.versions.node.split(".")[0]);
  add("Node", major >= 24 ? "ok" : "fail", `v${process.versions.node}`, major >= 24 ? undefined : "Install Node 24 or newer from https://nodejs.org/.");

  try {
    const base = findBase(io.cwd, flags.base);
    if (base.rev) add("Git", "ok", `changes are taken against ${base.rev}`);
    else add("Git", "warn", `${base.why}: proofed check runs every scenario`, "Run proofed in the app's git repository, or pass --base <rev>.");
  } catch (e) {
    add("Git", "fail", e instanceof Error ? e.message : String(e), e instanceof SetupError ? e.fix : undefined);
  }

  const dir = scenariosDirOf(flags, io);
  const loaded = readScenarios(dir);
  if (loaded.missing) add("Scenarios", "fail", `${dir} doesn't exist`, `Write one Markdown file per flow in ${dir}/ (see the Scenarios section of Proofed's README), or pass --scenarios <dir>.`);
  else if (loaded.scenarios.length === 0 && loaded.errors.length === 0) add("Scenarios", "fail", `${dir} has no .md files`, `Write one Markdown file per flow in ${dir}/.`);
  else add("Scenarios", "ok", `${loaded.scenarios.length} in ${dir}`);
  for (const e of loaded.errors) add("Scenario", "fail", `${e.file}: ${e.message}`, `Fix the frontmatter of ${e.file}: --- name, paths, url --- then the objective.`);

  const found = findKane(io.env);
  const creds = io.env.LT_USERNAME && io.env.LT_ACCESS_KEY ? ["--username", io.env.LT_USERNAME, "--access-key", io.env.LT_ACCESS_KEY] : [];
  if (!found.path) {
    add("Kane CLI", "fail", `not found (${found.from})`, io.env.KANE_CLI ? "Point KANE_CLI at the kane-cli binary, or unset it." : "npm install -g @testmuai/kane-cli");
  } else {
    const [version, who, balance] = await Promise.all([
      kane(found.path, ["--version"], io.env),
      kane(found.path, ["whoami"], io.env),
      kane(found.path, ["balance", ...creds], io.env),
    ]);
    add("Kane CLI", "ok", `${found.path}, ${/\d+\.\d+\.\d+\S*/.exec(version.text)?.[0] ?? "version unknown"}`);
    if (creds.length) add("Kane login", "ok", "LT_USERNAME and LT_ACCESS_KEY are set; Kane uses them");
    else if (who.ok) add("Kane login", "ok", "signed in");
    else add("Kane login", "fail", "not signed in", "kane-cli login (or export LT_USERNAME and LT_ACCESS_KEY from TestMu: Settings → Keys)");
    const left = /credits:\s*([\d.,]+)/i.exec(balance.text)?.[1];
    if (balance.ok && left) {
      const n = Number(left.replace(/,/g, ""));
      add("Credits", n >= DEFAULT_CREDITS ? "ok" : "warn", `${Math.floor(n)} available; a first run is estimated at ${DEFAULT_CREDITS} credits`, n >= DEFAULT_CREDITS ? undefined : "Top up your TestMu account before running scenarios.");
    } else {
      add("Credits", "warn", "couldn't read the balance", "kane-cli balance");
    }
  }

  const chrome = findChrome();
  add("Chrome", chrome ? "ok" : "fail", chrome ?? "not found", chrome ? undefined : "Install Google Chrome, or set CHROME_PATH to its binary.");

  const ffmpeg = findOnPath("ffmpeg", io.env);
  add("ffmpeg", ffmpeg ? "ok" : "warn", ffmpeg ?? "not found: no clips, the verdicts still work", ffmpeg ? undefined : process.platform === "darwin" ? "brew install ffmpeg" : "sudo apt-get install ffmpeg");

  try {
    const target = resolveTarget({ flags: { url: flags.url, serve: flags.serve, build: flags.build }, env: io.env, cwd: io.cwd });
    const url = target.url;
    if (!url) {
      add("App", "fail", "no URL", 'Pass --url http://localhost:5173 to proofed check, set PROOFED_URL, or write .proofed/config.json: { "url": "http://localhost:5173", "serve": "npm run dev" }');
    } else if (!isHttpUrl(url.value)) {
      add("App", "fail", `"${url.value}" from ${url.from} is not an http(s) URL`, "Use a full URL, e.g. http://localhost:5173");
    } else {
      add("App URL", "ok", `${url.value} (from ${url.from})`);
      if (target.build) add("Build", "ok", `${target.build.value} (from ${target.build.from})`);
      if (target.serve) add("Serve", "ok", `${target.serve.value} (from ${target.serve.from}${target.dir !== io.cwd ? `, in ${target.dir}` : ""})`);
      const up = await answers(url.value);
      if (up && target.build) add("App", "warn", `${url.value} answers now, maybe from an old build: proofed check stops rather than test it`, "Stop that server so Proofed builds and serves the current code, or pass --reuse to proofed check.");
      else if (up) add("App", "ok", `${url.value} answers now`);
      else if (target.serve) add("App", "warn", `${url.value} doesn't answer now; proofed check starts it with the serve command`);
      else add("App", "fail", `${url.value} doesn't answer and there is no serve command`, 'Start the app, or tell Proofed how: --serve "npm run dev", PROOFED_SERVE, or "serve" in .proofed/config.json');
    }
  } catch (e) {
    if (!(e instanceof SetupError)) throw e;
    add("App", "fail", e.message, e.fix);
  }
  return checks;
}

export async function doctor(flags: Flags, io: Io) {
  const checks = await doctorChecks(flags, io);
  const exitCode = checks.some((c) => c.status === "fail") ? 3 : 0;
  if (flags.json) {
    io.stdout.write(`${JSON.stringify({ ok: exitCode === 0, exitCode, checks }, null, 2)}\n`);
    return exitCode;
  }
  const c = palette(colorOn(io.env, !!io.stdout.isTTY));
  const mark = { ok: c.green("✓"), warn: c.yellow("!"), fail: c.red("✗") };
  const width = Math.max(...checks.map((k) => k.name.length));
  for (const k of checks) {
    io.stdout.write(`${mark[k.status]} ${k.name.padEnd(width)}  ${k.detail}\n`);
    if (k.fix && k.status !== "ok") io.stdout.write(`  ${" ".repeat(width)}  ${c.dim("Fix:")} ${k.fix}\n`);
  }
  io.stdout.write(exitCode === 0 ? `\n${c.green("Ready:")} proofed check can run here.\n` : `\n${c.red("Not ready:")} fix the ✗ lines above.\n`);
  return exitCode;
}
