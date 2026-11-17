import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { test } from "node:test";
import { chromeCandidates } from "./chrome.ts";
import { creditLockPath } from "./creditmeter.ts";
import { ffmpegInstallHint } from "./doctor.ts";
import { offLimits } from "./guard.ts";
import { relevantChanges } from "./cache.ts";
import { executableCommand, findGitBash, killTree, treeKillCommand } from "./process.ts";
import { checkScenarioId, parseScenario, touches } from "./scenarios.ts";
import { targetChecks } from "./targetchecks.ts";
import { resolveScenarioTarget } from "./target.ts";
import { findKane, findOnPath } from "./which.ts";

const temp = () => mkdtempSync(join(tmpdir(), "proofed platform "));

test("Windows PATH uses semicolons, case-insensitive env keys and PATHEXT", () => {
  const dir = temp();
  try {
    const bin = join(dir, "tools with spaces"); mkdirSync(bin);
    const kane = join(bin, "kane-cli.cmd"); writeFileSync(kane, "shim");
    writeFileSync(join(bin, "ffmpeg.exe"), "binary");
    const env = { Path: `${join(dir, "missing")};"${bin}"`, PathExt: ".EXE;.CMD" };
    assert.equal(findOnPath("kane-cli", env, "win32")?.toLowerCase(), kane.toLowerCase());
    assert.equal(findOnPath("ffmpeg", env, "win32")?.toLowerCase(), join(bin, "ffmpeg.exe").toLowerCase());
    assert.equal(findOnPath("kane-cli.cmd", env, "win32"), kane);
    assert.equal(findKane(env, "win32").path?.toLowerCase(), kane.toLowerCase());
    assert.equal(findKane({ ...env, KANE_CLI: join(bin, "kane-cli") }, "win32").path?.toLowerCase(), kane.toLowerCase());
    assert.equal(findOnPath("absent", env, "win32"), undefined);
    assert.equal(findOnPath("kane-cli", env, "linux"), undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("npm Windows shims invoke the Node entry without shell interpretation", () => {
  const dir = temp();
  try {
    const folder = join(dir, "node_modules/kane/bin"); mkdirSync(folder, { recursive: true });
    const entry = join(folder, "kane.cjs");
    writeFileSync(entry, "console.log(JSON.stringify(process.argv.slice(2)))");
    const shim = join(dir, "kane-cli.cmd");
    writeFileSync(shim, '@ECHO off\r\n"%_prog%" "%dp0%\\node_modules\\kane\\bin\\kane.cjs" %*\r\n');
    const args = ['Open "two bags" and the user\'s cart', "%PATH% & echo unsafe | > ^ (x)", "line one\nline two", "C:\\a folder\\"];
    const command = executableCommand(shim, args, {}, "win32");
    assert.equal(command.file, process.execPath);
    assert.deepEqual(command.args, [entry, ...args]);
    assert.deepEqual(JSON.parse(execFileSync(command.file, command.args, { encoding: "utf8" })), args);
    writeFileSync(shim, "echo arbitrary batch command");
    assert.throws(() => executableCommand(shim, args, {}, "win32"), /Cannot resolve Node entry/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Node shebang fixtures run through Node on Windows as well as Unix", () => {
  const dir = temp();
  try {
    const file = join(dir, "fake-kane");
    writeFileSync(file, '#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)))', { mode: 0o755 });
    for (const platform of ["win32", "darwin", "linux"] as const) {
      const cmd = executableCommand(file, ['assert "hello world"'], {}, platform);
      assert.equal(cmd.file, process.execPath);
      assert.deepEqual(JSON.parse(execFileSync(cmd.file, cmd.args, { encoding: "utf8" })), ['assert "hello world"']);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("process tree cleanup selects taskkill on Windows and process groups on Unix", () => {
  assert.deepEqual(treeKillCommand(123, "win32"), { file: "taskkill", args: ["/PID", "123", "/T", "/F"] });
  assert.equal(treeKillCommand(123, "darwin"), undefined);
  assert.equal(treeKillCommand(123, "linux"), undefined);
  assert.throws(() => treeKillCommand(-1, "win32"), /Invalid child pid/);
});

test("process tree cleanup stops a live child's HTTP server", { timeout: 20_000 }, async () => {
  const child = "require('node:http').createServer((q,s)=>s.end('alive')).listen(0,'127.0.0.1',function(){console.log(this.address().port)})";
  const leader = spawn(process.execPath, ["-e", `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(child)}],{stdio:['ignore','inherit','inherit']});setInterval(()=>{},1000)`], { detached: true, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(leader, "exit");
  try {
    const [data] = await once(leader.stdout, "data");
    const url = `http://127.0.0.1:${String(data).trim()}`;
    assert.equal(await fetch(url).then((r) => r.text()), "alive");
    killTree(leader.pid);
    await exited;
    let alive = true;
    for (let i = 0; i < 50 && alive; i++) {
      alive = await fetch(url, { signal: AbortSignal.timeout(200) }).then(() => true, () => false);
      if (alive) await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(alive, false, "the descendant no longer serves requests");
  } finally { killTree(leader.pid, "SIGKILL"); }
});

test("Chrome discovery includes Windows installs and prefers CHROME_PATH", () => {
  const env = { CHROME_PATH: "D:\\custom chrome.exe", ProgramFiles: "D:\\Program Files", "ProgramFiles(x86)": "D:\\Program Files (x86)", LOCALAPPDATA: "C:\\Users\\Jane Doe\\AppData\\Local" };
  assert.deepEqual(chromeCandidates(env, "win32"), [env.CHROME_PATH, ...[env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA].map((root) => win32.join(root, "Google/Chrome/Application/chrome.exe"))]);
  assert.ok(chromeCandidates({}, "darwin").includes("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"));
  assert.ok(chromeCandidates({}, "linux").includes("/usr/bin/google-chrome"));
});

test("credit lock uses the OS temporary folder", () => {
  assert.equal(creditLockPath(), join(tmpdir(), "proofed-kane.lock"));
  assert.equal(creditLockPath("custom temp"), join("custom temp", "proofed-kane.lock"));
});

test("scenario selection and fixer guards compare native paths with git paths", () => {
  const scenario = parseScenario(".proofed\\scenarios\\cart.md", "---\npaths: [src/**]\n---\nCheck cart");
  assert.equal(scenario.id, "cart");
  assert.equal(scenario.file, ".proofed/scenarios/cart.md");
  assert.equal(touches(scenario, ".proofed/scenarios/cart.md"), true);
  assert.equal(touches(scenario, "src\\cart.ts"), true);
  assert.deepEqual(relevantChanges(scenario, ["src\\cart.ts", "docs/readme.md"]), ["src\\cart.ts"]);
  assert.equal(offLimits("e2e/flows/cart.md", "e2e\\flows\\"), true);
  assert.equal(offLimits(".github\\workflows\\check.yml", ".proofed/scenarios"), true);
  assert.equal(offLimits("e2e/flows-old/cart.md", "e2e\\flows"), false);
});

test("scenario output ids reject Windows device names, streams and trailing dots", () => {
  for (const id of ["NUL", "con.txt", "COM1", "lpt9.log", "cart:stream", "cart.", "cart ", "bad?", "bad\\name", "bad/name"]) assert.throws(() => checkScenarioId(id, "win32"), /unsafe/);
  for (const id of ["cart", "café", "com10", "nul-check"]) checkScenarioId(id, "win32");
});

test("doctor offers Windows ffmpeg installation and rejects local iOS on Windows", async () => {
  assert.match(ffmpegInstallHint("win32"), /winget install/);
  const target = resolveScenarioTarget({ target: "ios", execution: "local", app: "Counter.app", device: "iPhone", os_version: "26" }, {}, {}, ".");
  const checks = await targetChecks(target, { platform: "win32" });
  assert.ok(checks.some((c) => c.name === "iOS host" && c.status === "fail" && /macOS/.test(c.detail)));
  const cloud = resolveScenarioTarget({ target: "ios", execution: "cloud", app: "APP123" }, {}, {}, ".");
  assert.ok((await targetChecks(cloud, { platform: "win32" })).every((c) => c.status === "ok"));
});

test("the fixer chooses Git Bash rather than WSL on Windows", () => {
  const dir = temp();
  try {
    const git = join(dir, "Git/bin"); mkdirSync(git, { recursive: true });
    const bash = join(git, "bash.exe"); writeFileSync(bash, "fixture");
    assert.equal(findGitBash({ ProgramFiles: dir, PATH: "" }, "win32"), bash);
    assert.equal(findGitBash({}, "darwin"), "bash");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a Chrome spawn error rejects and removes the temporary profiles", () => {
  const dir = temp();
  try {
    const bad = join(dir, "not-a-browser");
    mkdirSync(bad);
    const module = new URL("./chrome.ts", import.meta.url).href;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { launchChrome } from ${JSON.stringify(module)};
      await launchChrome().then(
        () => process.exitCode = 1,
        (e) => console.log("Chrome start failed:", e.message)
      );
    `], { env: { ...process.env, CHROME_PATH: bad, TMPDIR: dir, TEMP: dir, TMP: dir }, encoding: "utf8", timeout: 5000 });
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /Chrome start failed/);
    assert.deepEqual(readdirSync(dir), ["not-a-browser"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Chrome startup cleans up helpers that outlive the browser", { skip: process.platform === "win32" }, () => {
  const dir = temp();
  const pids = join(dir, "helpers");
  const bin = join(dir, "chrome");
  const children = () => {
    try { return readFileSync(pids, "utf8").trim().split("\n").map(Number); } catch { return []; }
  };
  try {
    writeFileSync(bin, `#!/usr/bin/env node
const { spawn } = require("node:child_process");
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
require("node:fs").appendFileSync(${JSON.stringify(pids)}, child.pid + "\\n");
child.unref();
`, { mode: 0o755 });
    const module = new URL("./chrome.ts", import.meta.url).href;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { launchChrome } from ${JSON.stringify(module)};
      await launchChrome().catch(() => {});
    `], { env: { ...process.env, CHROME_PATH: bin, TMPDIR: dir }, encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(children().length, 2);
    for (const pid of children()) {
      const state = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim();
      assert.match(state, /^(?:Z|$)/, `Chrome helper ${pid} is still running`);
    }
  } finally {
    for (const pid of children()) try { process.kill(pid, "SIGKILL"); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});
