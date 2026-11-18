import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { canReusePass, cacheKey } from "./cache.ts";
import { checkFix, checkedAt, checkedWhere, fixRefusal } from "./fixtarget.ts";
import { fixLoop } from "./fixloop.ts";
import { describeFailure } from "./fixprompt.ts";
import { buildReport, readReportData, type FailureData } from "./report.ts";
import type { ScenarioResult } from "./types.ts";
import type { Scenario } from "./scenarios.ts";
import { resolveScenarioTarget, type TargetFields } from "./target.ts";
import { targetChecks } from "./targetchecks.ts";

const scenario = (fields: TargetFields): Scenario => ({
  id: "counter", name: "Counter", file: "counter.md", paths: [], url: "/", objective: "Assert counter is 1.",
  ...fields, resolvedTarget: resolveScenarioTarget(fields, {}, {}, process.cwd()),
});
const failure = (s: Scenario): FailureData => ({ id: s.id, name: s.name, file: s.file, objective: s.objective, reason: "Counter is 0.", diagnosis: "", steps: [] });
const result = (s: Scenario, outcome: "passed" | "failed"): ScenarioResult => ({ scenario: s, outcome, steps: [], end: { type: "run_end", status: outcome }, clip: undefined });

const targets = [
  { fields: { target: "web" }, where: "in Chrome" },
  { fields: { target: "android", app: "build/app.apk" }, where: "on an Android emulator" },
  { fields: { target: "android", execution: "cloud", app: "build/app.aab" }, where: "on an Android device" },
  { fields: { target: "ios", app: "build/Counter.app" }, where: "in an iOS simulator" },
  { fields: { target: "ios", execution: "cloud", app: "build/app.ipa" }, where: "on an iOS device" },
  { fields: { target: "desktop", launch: "electron main.js", cdp_endpoint: "http://127.0.0.1:9223" }, where: "in the desktop app" },
] as const;

for (const { fields, where } of targets) test(`fixing ${where} builds, re-checks, and uses the target's wording`, async () => {
  const s = scenario(fields);
  assert.equal(fixRefusal([s], "build"), undefined);
  assert.equal(checkedAt(s), where);
  assert.match(describeFailure(failure(s), s), new RegExp(`Objective checked ${where}:`));
  const calls: string[] = [];
  let round = 0;
  let feedback = "";
  const end = await fixLoop({
    fixer: { model: "claude-test", effort: "high" }, failures: [failure(s)], open: [s.id], checked: [s.id],
    ask: (_, text) => { calls.push("ask"); feedback = text; return { ok: true, summary: "Fix counter" }; },
    putBack: () => [], hasChanges: () => true, build: () => { calls.push("build"); return undefined; },
    changedFiles: () => [], allScenarios: () => [s], scenariosFor: () => [s],
    check: (selected) => checkFix(selected, async () => { calls.push("serve"); return () => { calls.push("stop"); }; }, async () => {
      calls.push("check"); return [result(s, ++round === 1 ? "failed" : "passed")];
    }),
  });
  assert.equal(end.status, "fixed");
  assert.match(feedback, new RegExp(`checked again ${where}:`));
  assert.deepEqual(calls, fields.target === "web"
    ? ["ask", "build", "serve", "check", "stop", "ask", "build", "serve", "check", "stop"]
    : ["ask", "build", "check", "ask", "build", "check"]);
  const report = buildReport({ sha: "1234567", results: [result(s, "failed")], skipped: [], clips: new Map(), fixEnabled: true });
  assert.match(report, /- \[ \] \*\*Fix with Claude\*\*/);
  assert.equal(readReportData(report)!.failures[0]!.checkedAt, where);
  assert.match(describeFailure(readReportData(report)!.failures[0]!), new RegExp(`Objective checked ${where}:`));
  const passed = buildReport({ sha: "1234567", results: [result(s, "passed")], skipped: [], clips: new Map(), fixEnabled: true });
  assert.ok(passed.includes(`passes ${where}.`));
});

test("mixed web and Android checks share one server and always stop it", async () => {
  const selected = [scenario({ target: "web" }), scenario({ target: "android", execution: "cloud", app: "app.apk" })];
  assert.equal(checkedWhere(selected), "in Chrome and on an Android device");
  let served = 0, stopped = 0;
  await assert.rejects(checkFix(selected, async () => { served++; return () => { stopped++; }; }, async (scenarios) => {
    assert.equal(scenarios, selected); throw new Error("check failed");
  }), /check failed/);
  assert.equal(served, 1);
  assert.equal(stopped, 1);
});

test("unverifiable fixes give a report note instead of a checkbox", () => {
  for (const [fields, build, message] of [
    [{ target: "android", execution: "cloud", app: "APP123456" }, "build", /pre-uploaded TestMu APP ID/],
    [{ target: "ios", app: "APP123456" }, "build", /pre-uploaded TestMu APP ID/],
    [{ target: "desktop", cdp_endpoint: "http://127.0.0.1:9223" }, "build", /only a desktop CDP endpoint/],
    [{ target: "android", app: "app.apk" }, "", /needs a build command/],
    [{ target: "ios", execution: "cloud", app: "app.ipa" }, " ", /needs a build command/],
    [{ target: "desktop", app: "Counter.exe", cdp_endpoint: "http://127.0.0.1:9223" }, undefined, /needs a build command/],
  ] as const) {
    const s = scenario(fields);
    const note = fixRefusal([s], build);
    assert.match(note!, message);
    const report = buildReport({ sha: "1234567", results: [result(s, "failed")], skipped: [], clips: new Map(), fixEnabled: true, fixSetup: { note: note!, comment: false } });
    assert.ok(report.includes(`> ${note}`));
    assert.doesNotMatch(report, /- \[ \] \*\*Fix with|<code>\/proofed fix/);
  }
  assert.equal(fixRefusal([scenario({ target: "desktop", app: "Counter.exe", cdp_endpoint: "http://127.0.0.1:9223" })], "build"), undefined);
});

test("native build checks cannot reuse an old artifact's cached pass", () => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-fix-cache-"));
  try {
    const app = join(dir, "app.apk");
    const s = scenario({ target: "android", execution: "cloud", app });
    writeFileSync(app, "before fix");
    const before = cacheKey(s, "", [], undefined, "base", "0.10.4");
    assert.equal(canReusePass(s, "build"), false);
    assert.equal(canReusePass(s), true);
    writeFileSync(app, "after fix");
    assert.notEqual(cacheKey(s, "", [], undefined, "base", "0.10.4"), before);
    assert.equal(canReusePass(scenario({ target: "desktop", launch: "electron ." }), "build"), false);
    assert.equal(canReusePass(scenario({ target: "web" }), "build"), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("both local mobile platforms reject Linux, Windows and Intel Macs before invoking tools", async () => {
  for (const target of ["ios", "android"]) {
    for (const [platform, arch] of [["linux", "arm64"], ["win32", "x64"], ["darwin", "x64"]] as const) {
      const checks = await targetChecks(resolveScenarioTarget({ target, app: target === "ios" ? "Counter.app" : "app.apk" }, {}, {}, process.cwd()), { platform, arch, pendingBuild: true, env: { PATH: "" } });
      assert.ok(checks.some((c) => c.status === "fail" && /Apple Silicon \(arm64\)/.test(c.detail)));
      assert.ok(checks.every((c) => !/managed mobile dependencies|Recording device/.test(c.name)));
    }
  }
});

test("cloud rebuilds reach a new Kane process on every attempt and final check", async () => {
  const { readFileSync } = await import("node:fs");
  const { runAll } = await import("./pipeline.ts");
  const dir = mkdtempSync(join(tmpdir(), "proofed-fix-cloud-"));
  const saved = { ...process.env };
  try {
    const kane = join(dir, "kane.cjs");
    const log = join(dir, "uploads.jsonl");
    writeFileSync(kane, `const fs = require('node:fs'); const a=process.argv.slice(2);
if(a[0]==='balance') console.log('Available credits: 100');
else if(a[0]==='run') { const path=a[a.indexOf('--app')+1]; fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({args:a,artifact:fs.readFileSync(path,'utf8')})+'\\n');
console.log(JSON.stringify({step:1,status:'done',remark:'assert: counter is 1',ts:new Date().toISOString()})); console.log(JSON.stringify({type:'run_end',status:'passed'})); }
else throw new Error('unexpected command');`);
    Object.assign(process.env, { TMPDIR: dir, TEMP: dir, TMP: dir });
    process.env.KANE_CLI = kane;
    process.env.PROOFED_FIX = "true";
    delete process.env.PROOFED_TARGET;
    delete process.env.PROOFED_URL;
    delete process.env.PROOFED_SERVE;
    for (const [target, extension] of [["android", "apk"], ["android", "aab"], ["ios", "ipa"]]) {
      const app = join(dir, `app.${extension}`);
      const s = scenario({ target, execution: "cloud", app });
      for (const phase of ["attempt-1", "attempt-2", "final"]) {
        writeFileSync(app, `${target}:${phase}`);
        const [r] = await checkFix([s], async () => { throw new Error("must not serve"); }, (selected) => runAll(selected, join(dir, `${extension}-${phase}`), 1, { noRetry: true }));
        assert.equal(r!.outcome, "passed");
      }
    }
    const uploads = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { args: string[]; artifact: string });
    assert.equal(uploads.length, 9);
    assert.deepEqual(uploads.map((u) => u.artifact), ["android", "android", "ios"].flatMap((target) => ["attempt-1", "attempt-2", "final"].map((phase) => `${target}:${phase}`)));
    assert.ok(uploads.every((u) => !u.args.includes("--url") && !u.args.includes("--cdp-endpoint")));
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    rmSync(dir, { recursive: true, force: true });
  }
});
