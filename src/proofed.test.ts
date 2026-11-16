// `proofed` end to end, with the fake Kane (src/testing/fake-kane.ts) in place of kane-cli, a tiny
// app served by node:http, and a temp git repo for the app's code. Real Chrome, no credits.
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { findChrome } from "./chrome.ts";
import type { Doc, ErrorDoc } from "./result.ts";

const CLI = new URL("./proofed.ts", import.meta.url).pathname;
const FAKE_KANE = new URL("./testing/fake-kane.ts", import.meta.url).pathname;
const noChrome = findChrome() ? false : "Chrome not found; set CHROME_PATH to run the end-to-end tests";

const APP = `const http = require("node:http");
http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<!doctype html><title>Shop</title><h1>Shop</h1><button>Add to bag</button>");
}).listen(Number(process.argv[2]), "127.0.0.1");
`;

// Markers tell the fake Kane what to do (see fake-kane.ts).
type Spec = { mode: string; paths?: string[]; credits?: number };

function repo(scenarios: Record<string, Spec>) {
  const dir = mkdtempSync(join(tmpdir(), "proofed-e2e-"));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: dir, stdio: "ignore" });
  mkdirSync(join(dir, ".proofed/scenarios"), { recursive: true });
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "tmp"));
  writeFileSync(join(dir, ".gitignore"), "tmp\n");
  writeFileSync(join(dir, "server.cjs"), APP);
  writeFileSync(join(dir, "src/app.js"), "export const price = 1;\n");
  writeFileSync(join(dir, "README.md"), "app\n");
  for (const [id, s] of Object.entries(scenarios)) {
    const head = `---\nname: Scenario ${id}\npaths: [${(s.paths ?? ["src/**"]).join(", ")}]\nurl: /\n---\n`;
    writeFileSync(join(dir, `.proofed/scenarios/${id}.md`), `${head}Check the page. [fake:${s.mode}] [delay:20] [credits:${s.credits ?? 7}]\n`);
  }
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-qm", "init");
  // The change under test, uncommitted as a coding agent leaves it.
  writeFileSync(join(dir, "src/app.js"), "export const price = 2;\n");
  return {
    dir,
    git,
    log: join(dir, "tmp/kane-calls.ndjson"),
    out: join(dir, "tmp/out"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
type Repo = ReturnType<typeof repo>;

const calls = (r: Repo) =>
  existsSync(r.log) ? readFileSync(r.log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { pid: number; args?: string[]; child?: number }) : [];
const runs = (r: Repo) => calls(r).filter((c) => c.args?.[0] === "run");

async function freePort() {
  const server: Server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  await new Promise((r) => server.close(r));
  return port;
}

const portFree = (port: number) =>
  new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });

function env(r: Repo, extra: NodeJS.ProcessEnv = {}) {
  const { NO_COLOR, FORCE_COLOR, PROOFED_URL, PROOFED_SERVE, PROOFED_BUILD, PROOFED_OUT, PROOFED_SCENARIOS, ...rest } = process.env;
  // TMPDIR: each Chrome's profile goes there, so the test can tell its Chromes from any other.
  return { ...rest, KANE_CLI: FAKE_KANE, FAKE_KANE_LOG: r.log, TMPDIR: join(r.dir, "tmp"), ...extra };
}

type Ran = { code: number | null; stdout: string; stderr: string };

function cli(r: Repo, args: string[], extra: NodeJS.ProcessEnv = {}, onSpawn?: (p: ReturnType<typeof spawn>) => void) {
  const proc = spawn(process.execPath, [CLI, ...args, "--out", r.out], { cwd: r.dir, env: env(r, extra), stdio: ["ignore", "pipe", "pipe"] });
  onSpawn?.(proc);
  let stdout = "";
  let stderr = "";
  proc.stdout.on("data", (d) => (stdout += d));
  proc.stderr.on("data", (d) => (stderr += d));
  return new Promise<Ran>((resolve) => proc.on("close", (code) => resolve({ code, stdout, stderr })));
}

// stdout must be exactly one JSON document.
const json = <T = Doc>(ran: Ran) => {
  assert.match(ran.stdout, /^\{[\s\S]*\}\n$/, `stdout isn't only JSON:\n${ran.stdout}\n--- stderr:\n${ran.stderr}`);
  return JSON.parse(ran.stdout) as T;
};

const exists = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
// Where nothing reaps orphans (a container whose first process isn't an init), a killed process
// whose parent is gone stays a zombie: dead, though signal 0 still finds it. Killed processes also
// take a moment to go, so this waits up to two seconds for one.
const alive = async (pid: number) => {
  for (let i = 0; i < 20; i++) {
    if (!exists(pid)) return false;
    const stat = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim();
    if (stat === "" || stat.startsWith("Z")) return false;
    await new Promise((res) => setTimeout(res, 100));
  }
  return true;
};

describe("proofed check, with a fake Kane", { skip: noChrome, concurrency: 3, timeout: 240_000 }, () => {
  test("--json: pass, fail, not checked twice and error, as one JSON document", async () => {
    const r = repo({ pass: { mode: "pass" }, fail: { mode: "fail", credits: 27 }, vague: { mode: "noassert" }, doubted: { mode: "automation" }, broken: { mode: "error" } });
    const port = await freePort();
    try {
      const ran = await cli(r, ["check", "--json", "--concurrency", "5", "--url", `http://127.0.0.1:${port}`, "--serve", `node server.cjs ${port}`]);
      assert.equal(ran.code, 1, ran.stderr);
      const doc = json(ran);
      assert.equal(doc.exitCode, 1);
      assert.deepEqual(doc.counts, { passed: 1, failed: 1, not_checked: 2, error: 1, skipped: 0 });
      const by = Object.fromEntries(doc.scenarios.map((s) => [s.id, s]));
      assert.equal(by.pass!.outcome, "passed");
      assert.ok(by.pass!.clip?.mp4 && existsSync(by.pass!.clip.mp4), "a clip of the real page");
      assert.equal(by.fail!.outcome, "failed");
      assert.equal(by.fail!.diagnosis, "The free shipping threshold is €40, not €50.");
      assert.equal(by.fail!.failedStep, "assert: shipping is €4.90");
      assert.deepEqual([by.vague!.outcome, by.vague!.notChecked], ["not_checked", "nothing_asserted"]);
      assert.deepEqual([by.doubted!.outcome, by.doubted!.notChecked], ["not_checked", "scenario_doubted"]);
      assert.equal(by.broken!.outcome, "error");
      assert.equal(doc.credits, 7 + 27 + 7 + 7);
      assert.match(doc.rerun!, /^proofed check --only (broken|doubted|fail|vague)(,(broken|doubted|fail|vague)){3} /);
      // The progress went to stderr, the same document to result.json, and the clips stay out of git.
      assert.match(ran.stderr, /started pass: Scenario pass/);
      assert.deepEqual(JSON.parse(readFileSync(join(r.out, "result.json"), "utf8")), doc);
      assert.equal(readFileSync(join(r.out, ".gitignore"), "utf8"), "*\n");
      // An error is tried twice, like in CI.
      assert.equal(runs(r).length, 6);
      assert.ok(await portFree(port), "the app is stopped at the end");
    } finally {
      r.cleanup();
    }
  });

  test("exit 0 for a pass, without ffmpeg, in plain output", async () => {
    const r = repo({ pass: { mode: "pass" } });
    const port = await freePort();
    // A PATH with node and git but no ffmpeg: no clip, and the verdict still holds.
    const bin = join(r.dir, "tmp/bin");
    mkdirSync(bin);
    symlinkSync(process.execPath, join(bin, "node"));
    symlinkSync(execFileSync("which", ["git"], { encoding: "utf8" }).trim(), join(bin, "git"));
    try {
      const ran = await cli(r, ["check", "--url", `http://127.0.0.1:${port}`, "--serve", `node server.cjs ${port}`], { PATH: bin });
      assert.equal(ran.code, 0, ran.stdout + ran.stderr);
      assert.doesNotMatch(ran.stdout, /\x1b/);
      assert.match(ran.stdout, /Time: about 1 to 4 minutes per scenario, 3 at a time/);
      assert.match(ran.stdout, /^\[0:\d\d\] passed pass: Scenario pass/m);
      assert.match(ran.stdout, /✓ 1 passed · 7 credits/);
      const doc = JSON.parse(readFileSync(join(r.out, "result.json"), "utf8")) as Doc;
      assert.equal(doc.scenarios[0]!.outcome, "passed");
      assert.equal(doc.scenarios[0]!.clip?.mp4, undefined);
    } finally {
      r.cleanup();
    }
  });

  test("exit 2 when nothing failed but something wasn't checked, 3 when Proofed can't run", async () => {
    const r = repo({ vague: { mode: "noassert" }, broken: { mode: "error" } });
    const port = await freePort();
    const app = spawn(process.execPath, ["server.cjs", String(port)], { cwd: r.dir, stdio: "ignore" });
    try {
      const url = `http://127.0.0.1:${port}`;
      while (!(await fetch(url).then(() => true, () => false))) await new Promise((res) => setTimeout(res, 100));
      const two = await cli(r, ["check", "--json", "--url", url]);
      assert.equal(two.code, 2);
      assert.equal(json(two).exitCode, 2);

      const unknown = await cli(r, ["check", "--json", "--url", url, "--only", "nope"]);
      assert.equal(unknown.code, 3);
      const e = json<ErrorDoc>(unknown);
      assert.equal(e.error.code, "unknown_scenario");
      assert.match(e.error.message, /Scenarios: broken, vague/);

      const down = await cli(r, ["check", "--json", "--url", "http://127.0.0.1:9"]);
      assert.equal(down.code, 3);
      assert.equal(json<ErrorDoc>(down).error.code, "app_not_reachable");
      assert.match(json<ErrorDoc>(down).error.fix, /--serve/);

      // A build is configured and something already answers: it may be an old build, so nothing runs.
      const stale = await cli(r, ["check", "--json", "--url", url, "--build", "true", "--serve", "true"]);
      assert.equal(stale.code, 3);
      assert.equal(json<ErrorDoc>(stale).error.code, "app_already_running");
      assert.match(json<ErrorDoc>(stale).error.fix, /--reuse/);

      const noKane = await cli(r, ["check", "--json", "--url", url], { KANE_CLI: join(r.dir, "missing-kane") });
      assert.equal(noKane.code, 3);
      assert.equal(json<ErrorDoc>(noKane).error.code, "kane_missing");
      assert.equal(runs(r).length, 3, "only the first check ran Kane: once, and the error once more");
    } finally {
      app.kill();
      r.cleanup();
    }
  });

  test("without a Kane login, check stops before the build with exit 3 and the login command", async () => {
    const r = repo({ one: { mode: "pass" }, two: { mode: "pass" } });
    const port = await freePort();
    const args = ["check", "--json", "--url", `http://127.0.0.1:${port}`, "--build", "node -e \"require('fs').writeFileSync('tmp/built', '')\"", "--serve", `node server.cjs ${port}`];
    try {
      const started = Date.now();
      const ran = await cli(r, args, { FAKE_KANE_SIGNED_IN: "0", LT_USERNAME: "", LT_ACCESS_KEY: "" });
      assert.equal(ran.code, 3, ran.stderr);
      const e = json<ErrorDoc>(ran);
      assert.equal(e.error.code, "kane_not_signed_in");
      assert.match(e.error.fix, /^kane-cli login/);
      assert.doesNotMatch(`${e.error.message} ${e.error.fix}`, /run it again|retry/i);
      assert.ok(Date.now() - started < 10_000, "it took seconds, not a build and a run");
      assert.equal(existsSync(join(r.dir, "tmp/built")), false, "nothing was built");
      assert.ok(await portFree(port), "the app was never started");
      assert.deepEqual(calls(r).map((c) => c.args?.[0]), ["whoami"]);

      const plain = await cli(r, args.filter((a) => a !== "--json"), { FAKE_KANE_SIGNED_IN: "0", LT_USERNAME: "", LT_ACCESS_KEY: "" });
      assert.equal(plain.code, 3);
      assert.match(plain.stderr, /✗ Kane CLI is not signed in/);
      assert.match(plain.stderr, /Fix kane-cli login/);
      assert.doesNotMatch(plain.stdout + plain.stderr, /Fix Fix|run it again/);

      // Keys in the environment are what Kane runs with; whoami isn't asked.
      const keys = await cli(r, args, { FAKE_KANE_SIGNED_IN: "0", LT_USERNAME: "u", LT_ACCESS_KEY: "k" });
      assert.equal(json<ErrorDoc>(keys).error.code, "kane_not_signed_in", "the fake Kane refuses the run itself");
      assert.equal(calls(r).filter((c) => c.args?.[0] === "whoami").length, 2);
      assert.equal(runs(r).length, 2, "one run per scenario, and no retry");
    } finally {
      r.cleanup();
    }
  });

  test("a run Kane refuses for want of a login is exit 3, not retried", async () => {
    const r = repo({ expired: { mode: "signedout" } });
    const port = await freePort();
    try {
      const ran = await cli(r, ["check", "--json", "--url", `http://127.0.0.1:${port}`, "--serve", `node server.cjs ${port}`]);
      assert.equal(ran.code, 3, ran.stderr);
      assert.equal(json<ErrorDoc>(ran).error.code, "kane_not_signed_in");
      assert.equal(runs(r).length, 1);
      assert.doesNotMatch(ran.stderr, /retrying/);
    } finally {
      r.cleanup();
    }
  });

  test("a fresh clone gets its dependencies installed before the build, and only then", async () => {
    const r = repo({ pass: { mode: "pass" } });
    const port = await freePort();
    writeFileSync(join(r.dir, "package.json"), JSON.stringify({ name: "shop", private: true }));
    const install = "node -e \"const fs = require('fs'); fs.mkdirSync('node_modules/dep', { recursive: true }); fs.appendFileSync('tmp/installs', 'x')\"";
    const build = "node -e \"require('fs').accessSync('node_modules/dep')\"";
    const args = ["check", "--json", "--no-cache", "--url", `http://127.0.0.1:${port}`, "--install", install, "--build", build, "--serve", `node server.cjs ${port}`];
    const installs = () => (existsSync(join(r.dir, "tmp/installs")) ? readFileSync(join(r.dir, "tmp/installs"), "utf8").length : 0);
    try {
      const first = await cli(r, args);
      assert.equal(first.code, 0, first.stderr);
      assert.match(first.stderr, /Installing dependencies \(node_modules is missing\)/);
      assert.equal(installs(), 1);

      const second = await cli(r, args);
      assert.equal(second.code, 0, second.stderr);
      assert.doesNotMatch(second.stderr, /Installing dependencies/);
      assert.equal(installs(), 1, "installed dependencies aren't installed again");

      rmSync(join(r.dir, "node_modules"), { recursive: true });
      const failing = await cli(r, [...args.slice(0, 5), "--install", "node -e \"process.exit(4)\"", ...args.slice(7)]);
      assert.equal(failing.code, 3);
      const e = json<ErrorDoc>(failing);
      assert.equal(e.error.code, "install_failed");
      assert.match(e.error.message, /exited with code 4/);
    } finally {
      r.cleanup();
    }
  });

  test("a pass is cached until a file in its paths changes", async () => {
    const r = repo({ pricing: { mode: "pass", paths: ["src/app.js"] } });
    const port = await freePort();
    const check = () => cli(r, ["check", "--json", "--url", `http://127.0.0.1:${port}`, "--serve", `node server.cjs ${port}`]);
    try {
      const first = json(await check());
      assert.equal(first.credits, 7);
      assert.equal(runs(r).length, 1);

      writeFileSync(join(r.dir, "README.md"), "edited, outside the scenario's paths\n");
      const second = json(await check());
      assert.deepEqual([second.exitCode, second.credits, second.scenarios[0]!.cached], [0, 0, true]);
      assert.ok(second.scenarios[0]!.cachedAt);
      assert.equal(runs(r).length, 1, "the cached pass didn't call Kane");

      writeFileSync(join(r.dir, "src/app.js"), "export const price = 3;\n");
      const third = json(await check());
      assert.deepEqual([third.credits, third.scenarios[0]!.cached], [7, false]);
      assert.equal(runs(r).length, 2);

      const forced = json(await cli(r, ["check", "--json", "--no-cache", "--dry-run", "--url", `http://127.0.0.1:${port}`]));
      assert.equal(forced.scenarios[0]!.outcome, "would_run");
    } finally {
      r.cleanup();
    }
  });

  test("--dry-run and a change that touches nothing never call Kane", async () => {
    const r = repo({ pass: { mode: "pass" }, other: { mode: "pass", paths: ["lib/**"] } });
    try {
      const dry = await cli(r, ["check", "--json", "--dry-run", "--url", "http://127.0.0.1:9"]);
      assert.equal(dry.code, 0);
      const doc = json(dry);
      assert.equal(doc.dryRun, true);
      assert.deepEqual(doc.scenarios.map((s) => [s.id, s.outcome, s.estimatedCredits]), [["pass", "would_run", 30]]);
      assert.deepEqual(doc.skipped, [{ id: "other", name: "Scenario other", why: "the change does not touch its paths" }]);
      // With --json, stderr carries no second copy of what the document says.
      assert.doesNotMatch(dry.stderr, /would run:/);

      // The command to run it for real checks the same scenarios the estimate was for.
      const only = json(await cli(r, ["check", "--json", "--dry-run", "--only", "other", "--base", "main", "--url", "http://127.0.0.1:9"]));
      assert.match(only.next, /^Run it for real: proofed check --only other --url http:\/\/127\.0\.0\.1:9 --base main --out /);

      // "localhost:5173" parses as a URL with the scheme "localhost:"; it's a setup error, not a crash.
      const typo = await cli(r, ["check", "--json", "--dry-run", "--url", "localhost:5173"]);
      assert.equal(typo.code, 3);
      assert.equal(json<ErrorDoc>(typo).error.code, "url_invalid");
      assert.equal((JSON.parse(readFileSync(join(r.out, "result.json"), "utf8")) as ErrorDoc).error.code, "url_invalid");

      // An --out folder that already exists gets its .gitignore too.
      mkdirSync(join(r.dir, "reports"));
      spawnSync(process.execPath, [CLI, "check", "--dry-run", "--url", "http://127.0.0.1:9", "--out", "reports"], { cwd: r.dir, env: env(r) });
      assert.equal(readFileSync(join(r.dir, "reports/.gitignore"), "utf8"), "*\n");

      r.git("commit", "-qam", "the change");
      const none = await cli(r, ["check", "--url", "http://127.0.0.1:9"]);
      assert.equal(none.code, 0);
      assert.equal(none.stdout, "Nothing changed against main. Use --all to run every scenario.\n");
      assert.equal(runs(r).length, 0);
    } finally {
      r.cleanup();
    }
  });

  test("a failed assert Kane blames on the scenario is run again, and a pass on the second run is the result", async () => {
    const r = repo({ heading: { mode: "flaky", credits: 15 } });
    const port = await freePort();
    try {
      const ran = await cli(r, ["check", "--json", "--url", `http://127.0.0.1:${port}`, "--serve", `node server.cjs ${port}`]);
      assert.equal(ran.code, 0, ran.stderr);
      const doc = json(ran);
      assert.equal(doc.scenarios[0]!.outcome, "passed");
      assert.equal(doc.scenarios[0]!.failedCheck, undefined);
      assert.equal(doc.credits, 30);
      assert.match(ran.stderr, /retrying heading: the check failed, but Kane blames the scenario/);
      assert.equal(runs(r).length, 2);
    } finally {
      r.cleanup();
    }
  });

  test("a failed assert Kane blames on the scenario is a failure in JSON and the terminal", async () => {
    const r = repo({ shipping: { mode: "refuted", credits: 27.42 } });
    const port = await freePort();
    const args = ["check", "--url", `http://127.0.0.1:${port}`, "--serve", `node server.cjs ${port}`];
    try {
      const plain = await cli(r, args);
      assert.equal(plain.code, 1, plain.stderr);
      assert.match(plain.stdout, /Kane thinks +The test used the wrong/);
      assert.match(plain.stdout, /otherwise fix the app/);
      assert.doesNotMatch(plain.stdout, /Update the test expectation/);
      const ran = await cli(r, [...args, "--json"]);
      assert.equal(ran.code, 1, ran.stderr);
      const doc = json(ran);
      assert.equal(doc.scenarios[0]!.failedCheck, "scenario_doubted");
      assert.equal(doc.counts.failed, 1);
      assert.match(doc.next, /If the change in the app was intended/);
      // Both runs are paid for, and both were needed to call it a failure.
      assert.equal(doc.credits, 54.84);
      assert.equal(runs(r).length, 4);
    } finally {
      r.cleanup();
    }
  });

  // SIGHUP is a closed terminal tab or a dropped SSH session.
  for (const signal of ["SIGINT", "SIGHUP"] as const) test(`${signal} stops Kane and its children, every Chrome and the app, and exits 130`, async () => {
    const r = repo({ stuck: { mode: "hang" } });
    const port = await freePort();
    try {
      let cli_pid = 0;
      const done = cli(r, ["check", "--json", "--url", `http://127.0.0.1:${port}`, "--serve", `node server.cjs ${port}`], {}, (p) => (cli_pid = p.pid!));
      const deadline = Date.now() + 60_000;
      while (!calls(r).some((c) => c.child) && Date.now() < deadline) await new Promise((res) => setTimeout(res, 100));
      const kane = runs(r)[0]!.pid;
      const child = calls(r).find((c) => c.child)!.child!;
      const chromes = () => execFileSync("ps", ["-A", "-o", "pid=,command="], { encoding: "utf8" }).split("\n").filter((l) => l.includes(join(r.dir, "tmp")) && /chrom/i.test(l));
      assert.ok(chromes().length > 0, "Chrome is running before the interrupt");
      assert.ok(!(await portFree(port)), "the app is up before the interrupt");

      process.kill(cli_pid, signal);
      const ran = await done;
      assert.equal(ran.code, 130);
      assert.equal(json<ErrorDoc>(ran).error.code, "interrupted");
      assert.match(json<ErrorDoc>(ran).error.message, /may have spent credits before reporting them/);
      assert.ok(!(await alive(kane)), "fake Kane is gone");
      assert.ok(!(await alive(child)), "its child is gone");
      // Chrome's helpers may take a moment after the main process.
      for (let i = 0; i < 20 && chromes().length; i++) await new Promise((res) => setTimeout(res, 100));
      assert.deepEqual(chromes(), []);
      assert.ok(await portFree(port), "the app is stopped");
    } finally {
      r.cleanup();
    }
  });
});

describe("proofed list and doctor", () => {
  test("list shows each scenario and a file that doesn't parse", async () => {
    const r = repo({ pricing: { mode: "pass", paths: ["src/app.js"] }, docs: { mode: "pass", paths: ["docs/**"] } });
    writeFileSync(join(r.dir, ".proofed/scenarios/bad.md"), "no frontmatter\n");
    try {
      const ran = await cli(r, ["list", "--json"]);
      assert.equal(ran.code, 3);
      const doc = json<{ scenarios: { id: string; touched: boolean }[]; errors: { file: string; message: string }[] }>(ran);
      assert.deepEqual(doc.scenarios.map((s) => [s.id, s.touched]), [["docs", false], ["pricing", true]]);
      assert.deepEqual(doc.errors, [{ file: ".proofed/scenarios/bad.md", message: "missing frontmatter" }]);
    } finally {
      r.cleanup();
    }
  });

  test("doctor reports each check with a fix, using only Kane's free commands", async () => {
    const r = repo({ pass: { mode: "pass" } });
    try {
      const ran = await cli(r, ["doctor", "--json"], { FAKE_KANE_SIGNED_IN: "0" });
      const doc = json<{ exitCode: number; checks: { name: string; status: string; detail: string; fix?: string }[] }>(ran);
      const by = Object.fromEntries(doc.checks.map((c) => [c.name, c]));
      assert.equal(by["Kane CLI"]!.status, "ok");
      assert.match(by["Kane CLI"]!.detail, /0\.10\.4/);
      assert.deepEqual([by["Kane login"]!.status, by["Kane login"]!.fix], ["fail", "kane-cli login (or export LT_USERNAME and LT_ACCESS_KEY from TestMu: Settings → Keys)"]);
      assert.match(by.Credits!.detail, /^1234 available/);
      assert.equal(by.App!.status, "fail");
      assert.equal(doc.exitCode, 3);
      assert.deepEqual(calls(r).map((c) => c.args?.[0]).sort(), ["--version", "balance", "whoami"]);
    } finally {
      r.cleanup();
    }
  });
});
