import { executableCommand } from "../process.ts";
import { targetChecks } from "../targets/targetchecks.ts";
// `proofed doctor`: whether `proofed check` can run here, and the exact fix for what can't. It only
// calls Kane's free commands (--version, balance, doctor); no run, no credits.
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import type { Flags } from "./args.ts";
import { DEFAULT_CREDITS } from "./cache.ts";
import { scenariosDirOf, type Io } from "./check.ts";
import { findBase } from "../changes.ts";
import { findChrome } from "../targets/chrome.ts";
import { depsMissing, installCommand } from "../targets/deps.ts";
import { KEYS_FIX, kaneLogin, LOGIN_FIX } from "../kane/kaneauth.ts";
import { colorOn, palette, stripAnsi } from "./render.ts";
import { readScenarios } from "../scenarios.ts";
import { answers } from "../targets/serve.ts";
import { SetupError } from "../setuperror.ts";
import { isHttpUrl, resolveTarget, resolveScenarioTarget } from "../targets/target.ts";
import { findKane, findOnPath } from "../which.ts";

// "warn" and "fail" always carry a fix. A state proofed check resolves itself (an app it starts,
// an artifact it builds) is "ok": agents treat a warning as work to do.
export type Status = "ok" | "warn" | "fail";
export type DoctorCheck = { name: string; status: Status; detail: string; fix?: string };

const run = promisify(execFile);

// The launcher's own gate, from bin/ next to both src/ and dist/.
const { supported: nodeSupported, NEED: NODE_NEED } = createRequire(import.meta.url)("../../bin/node-version.cjs") as { supported: (version: string) => boolean; NEED: string };

// Kane prints update notices around its answer; only the answer counts.
async function kane(bin: string, args: string[], env: NodeJS.ProcessEnv) {
  try {
    const cmd = executableCommand(bin, args, env);
    const { stdout, stderr } = await run(cmd.file, cmd.args, { env, windowsHide: true, timeout: 20_000 });
    return { ok: true, text: stripAnsi(`${stdout}\n${stderr}`) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, text: stripAnsi(`${err.stdout ?? ""}\n${err.stderr ?? ""}`) };
  }
}

export const ffmpegInstallHint = (platform = process.platform) => platform === "darwin" ? "brew install ffmpeg" : platform === "win32" ? "winget install Gyan.FFmpeg" : "sudo apt-get install ffmpeg";

export async function doctorChecks(flags: Flags, io: Io): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const add = (name: string, status: Status, detail: string, fix?: string) => checks.push({ name, status, detail, ...(fix && { fix }) });

  const nodeOk = nodeSupported(process.versions.node);
  add("Node", nodeOk ? "ok" : "fail", `v${process.versions.node}`, nodeOk ? undefined : `Install ${NODE_NEED} from https://nodejs.org/ (any current LTS).`);

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
  for (const e of loaded.errors) add("Scenario", "fail", `${e.file}: ${e.message}`, `Correct the frontmatter of ${e.file}: --- name, paths, url --- then the objective.`);

  const filter = flags.target ?? io.env.PROOFED_TARGET;
  const targets = loaded.scenarios.filter((s) => !filter || (s.target ?? "web") === filter).map((s) => resolveScenarioTarget(s, flags, io.env, io.cwd));
  if (!targets.length) targets.push(resolveScenarioTarget({}, flags, io.env, io.cwd));
  const needsWeb = targets.some((t) => t.kind === "web");
  const found = findKane(io.env);
  if (!found.path) {
    add("Kane CLI", "fail", `not found (${found.from})`, io.env.KANE_CLI ? "Point KANE_CLI at the kane-cli binary, or unset it." : "npm install -g @testmuai/kane-cli");
  } else {
    const [version, login] = await Promise.all([kane(found.path, ["--version"], io.env), kaneLogin(found.path, io.env)]);
    add("Kane CLI", "ok", `${found.path}, ${/\d+\.\d+\.\d+\S*/.exec(version.text)?.[0] ?? "version unknown"}`);
    if (login.state === "not_signed_in") add("Kane login", "fail", login.detail, LOGIN_FIX);
    else if (login.state === "keys_rejected") add("Kane login", "fail", login.detail, KEYS_FIX);
    else if (login.state === "unknown") add("Kane login", "warn", login.detail, "kane-cli balance");
    else add("Kane login", "ok", login.detail);
    const left = /credits:\s*([\d.,]+)/i.exec(login.balance ?? "")?.[1];
    if (login.state === "not_signed_in" || login.state === "keys_rejected") {
      add("Credits", "warn", "unknown until Kane accepts the login", login.state === "keys_rejected" ? KEYS_FIX : LOGIN_FIX);
    } else if (left) {
      const n = Number(left.replace(/,/g, ""));
      add("Credits", n >= DEFAULT_CREDITS ? "ok" : "warn", `${Math.floor(n)} available; ${needsWeb ? `a first web run is estimated at ${DEFAULT_CREDITS} credits` : "the cost of a first mobile or desktop run is unknown"}`, n >= DEFAULT_CREDITS ? undefined : "Top up your TestMu account before running scenarios.");
    } else {
      add("Credits", "warn", "couldn't read the balance", "kane-cli balance");
    }
  }

  for (const target of targets) {
    for (const check of await targetChecks(target, { env: io.env, pendingBuild: !!resolveTarget({ flags, env: io.env, cwd: io.cwd }).build, launchPending: true })) checks.push({ ...check, name: `${target.kind}: ${check.name}` });
  }
  if (targets.some((t) => ["web", "desktop"].includes(t.kind))) {
    const chrome = findChrome(io.env);
    add("Chrome", chrome ? "ok" : "fail", chrome ?? "not found", chrome ? undefined : "Install Google Chrome, or set CHROME_PATH to its binary.");
  }
  if (!needsWeb) return checks;

  const ffmpeg = findOnPath("ffmpeg", io.env);
  add("ffmpeg", ffmpeg ? "ok" : "warn", ffmpeg ?? "not found: no clips, the verdicts still work", ffmpeg ? undefined : ffmpegInstallHint());

  try {
    const target = resolveTarget({ flags: { url: flags.url, serve: flags.serve, build: flags.build, install: flags.install }, env: io.env, cwd: io.cwd });
    const url = target.url;
    if (!url) {
      add("App", "fail", "no URL", 'Pass --url http://localhost:5173 to proofed check, set PROOFED_URL, or write .proofed/config.json: { "url": "http://localhost:5173", "serve": "npm run dev" }');
    } else if (!isHttpUrl(url.value)) {
      add("App", "fail", `"${url.value}" from ${url.from} is not an http(s) URL`, "Use a full URL, e.g. http://localhost:5173");
    } else {
      add("App URL", "ok", `${url.value} (from ${url.from})`);
      const missing = target.serve && depsMissing(target.dir);
      if (missing) {
        const install = installCommand(target.dir, target.install);
        add("Install", "ok", `${missing}: proofed check runs ${install.value} (from ${install.from}) before the build`);
      } else if (target.install) {
        add("Install", "ok", `${target.install.value} (from ${target.install.from}), run when node_modules is missing or out of date`);
      }
      if (target.build) add("Build", "ok", `${target.build.value} (from ${target.build.from})`);
      if (target.serve) add("Serve", "ok", `${target.serve.value} (from ${target.serve.from}${target.dir !== io.cwd ? `, in ${target.dir}` : ""})`);
      const up = await answers(url.value);
      if (up && target.build) add("App", "warn", `${url.value} answers now, maybe from an old build: proofed check stops rather than test it`, "Stop that server so Proofed builds and serves the current code, or pass --reuse to proofed check.");
      else if (up) add("App", "ok", `${url.value} answers now`);
      else if (target.serve) add("App", "ok", `not running, as expected: proofed check ${target.build ? "builds and starts" : "starts"} it at ${url.value}`);
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
    io.stdout.write(`${JSON.stringify({ ok: exitCode === 0, exitCode, checks })}\n`);
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
