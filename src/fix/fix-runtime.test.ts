// Execute fix.ts against a temporary git repo. The fixer, Kane and GitHub/push are fakes.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dataComment, readReportData, type FailureData } from "../report/report.ts";
import { askedScenario } from "../action/requests.ts";
import { kaneObjective } from "../check/run.ts";
import type { RunFile } from "../report/runfile.ts";
import { resolveScenarioTarget } from "../targets/target.ts";
import { DEFAULT_FIXER } from "./models.ts";

const description = askedScenario("description", "Check that the counter survives a restart.\n\n[delay:1]",
  resolveScenarioTarget({ target: "android", execution: "cloud", app: "app.apk" }, {}, {}, process.cwd()));

const fakeKane = fileURLToPath(new URL("../testing/fake-kane.ts", import.meta.url));

function fixture(target = "android", extra = "", build = "node build.cjs", finalFails = false, options: {
  extraScenario?: boolean;
  partialFix?: boolean;
  changeAfterAttempt?: boolean;
  buildOutput?: boolean;
  untrackedBuildOutput?: boolean;
  ignoredBuildOutput?: boolean;
  agentBuildOutput?: "with-source" | "only";
  description?: "stored" | "missing" | "doubted";
  rejectPush?: boolean;
  throwFromAgent?: boolean;
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "proofed-fix-runtime-"));
  const log = join(dir, "events.jsonl");
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" }).trim();
  mkdirSync(join(dir, ".proofed/scenarios"), { recursive: true });
  writeFileSync(join(dir, ".gitignore"), "out/\napp.apk\napp.ipa\nevents.jsonl\nproofed-build.sh\nmodes/\n*.log\n");
  mkdirSync(join(dir, "modes"));
  writeFileSync(join(dir, "modes/counter"), "pass");
  writeFileSync(join(dir, "app.js"), "broken\n");
  if (options.extraScenario || options.partialFix || finalFails) {
    writeFileSync(join(dir, "extra.js"), "old\n");
    writeFileSync(join(dir, "modes/extra"), options.partialFix ? "fail" : "pass");
    writeFileSync(join(dir, ".proofed/scenarios/extra.md"), `---\nname: Extra\ntarget: ${target}\nexecution: cloud\napp: app.${target === "ios" ? "ipa" : "apk"}\npaths: [extra.js]\n---\nAssert extra is 1. [fake-from:extra] [delay:1]\n`);
  }
  writeFileSync(join(dir, ".proofed/scenarios/counter.md"), `---\nname: Counter\ntarget: ${target}\n${target === "desktop" ? "execution: local\n" : `execution: cloud\napp: app.${target === "ios" ? "ipa" : "apk"}\n`}${extra}---\nAssert counter is 1. [fake-from:counter] [delay:1]\n`);
  writeFileSync(join(dir, "build.cjs"), `const fs=require('node:fs'); fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({type:'build',code:fs.readFileSync('app.js','utf8')})+'\\n'); fs.writeFileSync('app.${target === "ios" ? "ipa" : "apk"}',fs.readFileSync('app.js')); ${finalFails ? `const rounds=fs.readFileSync(${JSON.stringify(log)},'utf8').split('"type":"build"').length-1;if(rounds===2){fs.writeFileSync('app.apk','different APK from the final build');fs.writeFileSync('modes/counter','fail');}` : ""}`);
  git("init", "-q", "-b", "main");
  if (options.buildOutput || options.agentBuildOutput) {
    mkdirSync(join(dir, "dist"));
    writeFileSync(join(dir, "dist/index.html"), "committed output");
    writeFileSync(join(dir, "dist/old.html"), "committed old output");
    if (options.agentBuildOutput || options.ignoredBuildOutput) {
      writeFileSync(join(dir, ".gitignore"), readFileSync(join(dir, ".gitignore"), "utf8") + (options.agentBuildOutput ? "dist/\n" : "dist/*.html\n"));
      git("add", "-f", "--", "dist");
    }
  }
  if (options.buildOutput) {
    if (!options.untrackedBuildOutput) writeFileSync(join(dir, ".gitignore"), readFileSync(join(dir, ".gitignore"), "utf8") + "/build-output.js\n");
    writeFileSync(join(dir, "dist/config.js"), "original config");
    const buildScript = join(dir, "build.cjs");
    writeFileSync(buildScript, readFileSync(buildScript, "utf8") + `
fs.writeFileSync('dist/index.html', 'bundle: ' + fs.readFileSync('app.js', 'utf8'));
fs.rmSync('dist/old.html', { force: true });
fs.writeFileSync('build-output.js', 'untracked output');
const bundle = fs.readFileSync('dist/index.html', 'utf8');
fs.writeFileSync('app.apk', bundle);
fs.writeFileSync('modes/counter', bundle === 'bundle: fixed\\n' && fs.readFileSync('dist/config.js', 'utf8') === 'fixed config' ? 'pass' : 'fail');`);
  }
  git("add", "-A"); git("commit", "-qm", "Initial fixture");
  const base = git("rev-parse", "HEAD");
  if (options.extraScenario || options.partialFix || finalFails) writeFileSync(join(dir, "extra.js"), "PR changed it\n");
  writeFileSync(join(dir, "app.js"), "PR broke it\n"); git("commit", "-qam", "Break counter");
  const original = git("rev-parse", "HEAD");
  const failures: FailureData[] = [{ id: "counter", name: "Counter", file: ".proofed/scenarios/counter.md", objective: "Assert counter is 1.", reason: "Counter is 0.", diagnosis: "", steps: [] }];
  if (options.partialFix) failures.push({ id: "extra", name: "Extra", file: ".proofed/scenarios/extra.md", objective: "Assert extra is 1.", reason: "Extra is 0.", diagnosis: "", steps: [] });
  if (options.description) failures.push({
    ...description, reason: "The counter reset.", diagnosis: "", steps: [],
    ...(options.description === "doubted" && { failedCheck: "scenario_doubted" }),
  });
  const asked = options.description && options.description !== "missing" ? [description] : undefined;
  const body = options.partialFix
    ? `<!-- proofed -->\n### Proofed\n\n**2 of 3** scenarios broke on this PR.\n\n#### ✗ Counter\n\n> Counter is 0.\n\n#### ✗ Extra\n\n> Extra is 0.\n\n- [ ] **Fix with Claude**\n\n<details><summary>✓ Passed: Home</summary></details>\n${dataComment({
      sha: original, failures, open: ["counter", "extra"], history: [{ sha: original, state: "failed" }],
    })}\n<!-- proofed:run pr-1/original -->`
    : `<!-- proofed -->\n### Proofed\n\nCounter broke.\n\n- [ ] **Fix with Claude**\n${dataComment({ sha: original, failures, asked })}`;
  const originalRun: RunFile = {
    sha: original,
    scenarios: [
      { id: "counter", name: "Counter", outcome: "failed", reason: "Counter is 0.", clip: { jpg: "https://github.com/fixture/original.jpg" } },
      { id: "extra", name: "Extra", outcome: "failed", reason: "Extra is 0." },
      { id: "home", name: "Home", outcome: "passed" },
    ],
    skipped: ["Settings"],
  };
  // All API functions fix.ts/pipeline.ts can call are local spies, and push never invokes git push.
  const github = `export * from ${JSON.stringify(new URL("../github.ts", import.meta.url).href)};
const record = (type, value) => { globalThis.fixtureLog(type,value); };
export const findReport=async()=>({id:1,body:process.env.FIXTURE_REPORT??${JSON.stringify(body)}});
export const listReports=async()=>({current:await findReport(),older:[]});
export const editComment=async(_repo,_id,body)=>{record('report',body);return {html_url:'https://example.test/report'};};
export const postComment=async(_repo,_pr,body)=>{record('report',body);return {html_url:'https://example.test/report'};};
export const setStatus=async(_repo,sha,state,description)=>globalThis.fixtureLog('status',{state,description},sha);
export const readFile=async(_repo,path)=>{record('read-run',path);return ${JSON.stringify(JSON.stringify(originalRun))};};
export const publishClips=async(_repo,files)=>{
  if(${options.partialFix === true}) for(const file of files) record('run-file',globalThis.fixtureFs.readFileSync(file.local,'utf8'));
  return new Map();
};
export const minimize=async()=>{};`;
  const agent = `export * from ${JSON.stringify(new URL("./agent.ts", import.meta.url).href)};
import { execFileSync } from 'node:child_process';
export function askAgent(prompt){
  globalThis.fixtureLog('ask',prompt);
  ${options.throwFromAgent ? "throw new Error('Agent failed with fixture-token');" : ""}
  const fs=globalThis.fixtureFs;
  ${options.agentBuildOutput !== "only" ? "fs.writeFileSync('app.js','fixed\\n');" : ""}
  ${options.agentBuildOutput ? "fs.writeFileSync('dist/index.html','agent built output');" : "fs.writeFileSync('new-helper.js','verified new file\\n');"}
  ${options.agentBuildOutput === "with-source" ? "execFileSync('git', ['rm', '--quiet', '--', 'dist/old.html']);" : ""}
  ${options.buildOutput ? "if (fs.existsSync('build-output.js')) fs.writeFileSync('dist/config.js','fixed config');" : ""}
  return {ok:true,text:'SUMMARY: Fix counter'};
}`;
  const push = `export async function pushHead(){
  globalThis.fixtureLog('push');
  ${options.rejectPush ? "throw new Error('Push rejected with fixture-token');" : "return false;"}
}`;
  const mocks = new Map([
    [new URL("../github.ts", import.meta.url).href, `data:text/javascript,${encodeURIComponent(github)}`],
    [new URL("./agent.ts", import.meta.url).href, `data:text/javascript,${encodeURIComponent(agent)}`],
    [new URL("./push.ts", import.meta.url).href, `data:text/javascript,${encodeURIComponent(push)}`],
  ]);
  if (options.changeAfterAttempt) {
    const pipelineUrl = new URL("../check/pipeline.ts", import.meta.url).href;
    const pipeline = `export * from ${JSON.stringify(pipelineUrl)};
import {runAll as run} from ${JSON.stringify(pipelineUrl)};
export async function runAll(scenarios,out,...rest){
  const results=await run(scenarios,out,...rest);
  if(out.includes('/attempt-')) { globalThis.fixtureFs.writeFileSync('new-helper.js','changed after attempt\\n'); globalThis.fixtureLog('tree-change'); }
  return results;
}`;
    mocks.set(pipelineUrl, `data:text/javascript,${encodeURIComponent(pipeline)}`);
  }
  const script = `import * as fs from 'node:fs'; import {registerHooks} from 'node:module';
globalThis.fixtureFs=fs;
globalThis.fixtureLog=(type,value,sha)=>fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({type,value,sha})+'\\n');
const mocks=new Map(${JSON.stringify([...mocks])});
registerHooks({resolve(specifier,context,next){const url=specifier.startsWith('.')&&context.parentURL?.startsWith('file:')?new URL(specifier,context.parentURL).href:specifier;
// A mock's re-export loads the original implementation, without remapping it again.
if(mocks.has(url)&&!context.parentURL?.startsWith('data:'))return {url:mocks.get(url),shortCircuit:true};return next(specifier,context);}});
globalThis.fetch=async()=>{throw new Error('Network forbidden in fixer fixture');};`;
  const env = { ...process.env, TMPDIR: dir, TEMP: dir, TMP: dir, GITHUB_TOKEN: "fixture-token", GITHUB_REPOSITORY: "fixture/repo", PROOFED_AUTO: "true", PROOFED_NUMBER: "1", PROOFED_BUILD: build, PROOFED_BASE_SHA: base, PROOFED_HEAD_REF: "main", PROOFED_OUT: join(dir, "out"), PROOFED_FIX: "true", PROOFED_DIR: ".", KANE_CLI: fakeKane, FAKE_KANE_LOG: join(dir, "kane.log"), FAKE_KANE_MODES: join(dir, "modes"), RUNNER_TEMP: dir };
  for (const key of ["PROOFED_TARGET", "PROOFED_EXECUTION", "PROOFED_APP", "PROOFED_URL", "PROOFED_SERVE", "PROOFED_BASE_REF", "GITHUB_EVENT_PATH", "GITHUB_RUN_ID", "PROOFED_CLAUDE_MODEL", "PROOFED_CLAUDE_EFFORT", "PROOFED_SCENARIOS", "ACTIONS_ID_TOKEN_REQUEST_URL", "ACTIONS_ID_TOKEN_REQUEST_TOKEN"]) delete env[key as keyof typeof env];
  Object.assign(env, { PROOFED_PROVIDER: "claude", PROOFED_MODEL: DEFAULT_FIXER.model, PROOFED_EFFORT: DEFAULT_FIXER.effort });
  if (options.description) Object.assign(env, { PROOFED_TARGET: "android", PROOFED_EXECUTION: "cloud", PROOFED_APP: "app.apk" });
  // Hooks and generated scripts sit outside the tested checkout so they can never be committed.
  const preload = join(tmpdir(), `proofed-fix-preload-${process.pid}-${Date.now()}.mjs`);
  writeFileSync(preload, script);
  const run = (entry = "./fix.ts", overrides: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath, ["--import", preload, fileURLToPath(new URL(entry, import.meta.url))], {
    // Rebuilding, checking twice and committing can take over 30 seconds on a busy macOS runner.
    cwd: dir, env: { ...env, ...overrides }, encoding: "utf8", timeout: 45_000,
  });
  const check = (request: string, counter: "pass" | "fail") => {
    const out = join(dir, "out");
    mkdirSync(out, { recursive: true });
    const event = join(out, "event.json");
    const output = join(out, "github-output");
    writeFileSync(event, JSON.stringify({ pull_request: { number: 1, body: request, head: { sha: original, ref: "feature" }, base: { sha: base, ref: "main" } } }));
    writeFileSync(join(dir, "modes/counter"), counter);
    execFileSync(process.execPath, ["build.cjs"], { cwd: dir });
    const ran = run("../action/cli.ts", {
      GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output, PROOFED_TARGET: "android", PROOFED_EXECUTION: "cloud", PROOFED_APP: "app.apk",
    });
    return { ran, output: existsSync(output) ? readFileSync(output, "utf8") : "", body: readFileSync(join(out, "report.md"), "utf8") };
  };
  const runs = () => readFileSync(join(dir, "kane.log"), "utf8").trim().split("\n")
    .map((s) => JSON.parse(s) as { args?: string[] }).filter((c) => c.args?.[0] === "run");
  const events = () => (existsSync(log) ? readFileSync(log, "utf8") : "").trim().split("\n").filter(Boolean).map((s) => JSON.parse(s) as { type: string; value?: string | { description: string; state: string }; code?: string; sha?: string });
  return { dir, original, originalRun, body, git, run, check, runs, events, cleanup: () => { rmSync(dir, { recursive: true, force: true }); rmSync(preload, { force: true }); } };
}

for (const target of ["android", "ios"]) test(`the ${target} fixer reuses its last attempt without another build or Kane run`, () => {
  const f = fixture(target);
  try {
    const ran = f.run();
    assert.equal(ran.status, 0, ran.stdout + ran.stderr);
    const events = f.events();
    assert.deepEqual(events.filter((e) => ["ask", "build", "push"].includes(e.type)).map((e) => e.type), ["ask", "build", "push"]);
    assert.ok(events.filter((e) => e.type === "build").every((e) => e.code === "fixed\n"));
    const calls = readFileSync(join(f.dir, "kane.log"), "utf8").trim().split("\n").map((s) => JSON.parse(s) as { args?: string[] });
    assert.equal(calls.filter((c) => c.args?.[0] === "run").length, 1);
    assert.match(ran.stdout, /Final check: 1 result\(s\) from the last attempt, 0 to run\./);
    assert.ok(calls.every((c) => !c.args?.includes("--url")));
    assert.match(events.find((e) => e.type === "ask")!.value as string, new RegExp(`on an ${target === "ios" ? "iOS" : "Android"} device`));
    assert.match(f.git("log", "-1", "--format=%B"), new RegExp(`Kane re-ran the scenarios on an ${target === "ios" ? "iOS" : "Android"} device`));
    assert.equal(f.git("show", "HEAD:new-helper.js"), "verified new file");
    assert.equal(f.git("status", "--porcelain"), "");
  } finally { f.cleanup(); }
});

test("a rejected push restores the report and fails the original commit's pending status", () => {
  const f = fixture("android", "", "node build.cjs", false, { rejectPush: true });
  try {
    const ran = f.run();
    assert.equal(ran.status, 1, ran.stdout + ran.stderr);
    assert.notEqual(f.git("rev-parse", "HEAD"), f.original);
    const events = f.events();
    assert.deepEqual(events.map((e) => e.type), ["report", "status", "ask", "build", "push", "report", "status"]);
    const reports = events.filter((e) => e.type === "report").map((e) => e.value as string);
    assert.match(reports[0]!, /is working on a fix/);
    assert.match(reports[1]!, /Proofed couldn't push the fix to the branch/);
    assert.match(reports[1]!, /- \[ \] \*\*Fix with Claude\*\*/);
    assert.deepEqual(readReportData(reports[1]!), readReportData(f.body));
    const statuses = events.filter((e) => e.type === "status");
    assert.deepEqual(statuses.map((e) => e.sha), [f.original, f.original]);
    assert.match(JSON.stringify(statuses[0]?.value), /"state":"pending"/);
    assert.deepEqual(statuses[1]?.value, { state: "failure", description: "Proofed couldn't push the fix to the branch." });
    assert.doesNotMatch(ran.stdout + ran.stderr + JSON.stringify(events), /fixture-token/);
  } finally { f.cleanup(); }
});

test("an exception after marking the fix pending restores the report and fails the status", () => {
  const f = fixture("android", "", "node build.cjs", false, { throwFromAgent: true });
  try {
    const ran = f.run();
    assert.equal(ran.status, 1, ran.stdout + ran.stderr);
    const events = f.events();
    assert.deepEqual(events.map((e) => e.type), ["report", "status", "ask", "report", "status"]);
    assert.match(String(events[3]?.value), /couldn't finish the fix[\s\S]*- \[ \] \*\*Fix with Claude\*\*/);
    assert.deepEqual(readReportData(String(events[3]?.value)), readReportData(f.body));
    assert.equal(events[4]?.sha, f.original);
    assert.equal((events[4]?.value as { state?: string }).state, "failure");
    assert.match(ran.stdout, /Agent failed with \*\*\*/);
    assert.doesNotMatch(ran.stdout + ran.stderr, /fixture-token/);
    assert.equal(existsSync(join(f.dir, "proofed-build.sh")), false);
  } finally { f.cleanup(); }
});

test("a rejected commit restores the report and logs a masked Git diagnostic", () => {
  const f = fixture();
  try {
    f.git("config", "--local", "gpg.format", "ssh");
    f.git("config", "--local", "user.signingkey", join(f.dir, "fixture-token"));
    f.git("config", "--local", "commit.gpgsign", "true");
    const ran = f.run();
    assert.equal(ran.status, 1, ran.stdout + ran.stderr);
    assert.equal(f.git("rev-parse", "HEAD"), f.original);
    const events = f.events();
    assert.deepEqual(events.map((e) => e.type), ["report", "status", "ask", "build", "report", "status"]);
    assert.match(events[4]!.value as string, /Proofed couldn't commit the fix/);
    assert.match(events[4]!.value as string, /- \[ \] \*\*Fix with Claude\*\*/);
    assert.deepEqual(events[5]!.value, { state: "failure", description: "Proofed couldn't commit the fix. Nothing was pushed." });
    assert.match(ran.stdout, /\*\*\*/);
    assert.doesNotMatch(ran.stdout + ran.stderr + JSON.stringify(events), /fixture-token/);
  } finally { f.cleanup(); }
});

test("a stale report asks for a fresh check without starting the fix or updating status", () => {
  const f = fixture();
  try {
    f.git("commit", "--allow-empty", "-qm", "New PR commit");
    const head = f.git("rev-parse", "HEAD");
    const event = join(f.dir, "event.json");
    writeFileSync(event, JSON.stringify({ action: "edited", comment: { id: 1, body: f.body.replace("[ ]", "[x]") }, issue: { number: 1, pull_request: {} } }));
    const ran = f.run("./fix.ts", { GITHUB_EVENT_PATH: event, PROOFED_AUTO: "false" });
    assert.equal(ran.status, 0, ran.stdout + ran.stderr);
    assert.equal(f.git("rev-parse", "HEAD"), head);
    const events = f.events();
    assert.deepEqual(events.map((e) => e.type), ["report"]);
    const body = events[0]!.value as string;
    assert.match(body, /This report is for an older commit\. Proofed checks new commits on its own; comment `\/proofed` only if no check is running\./);
    assert.match(body, /- \[ \] \*\*Fix with Claude\*\*/);
    assert.deepEqual(readReportData(body), readReportData(f.body));
  } finally { f.cleanup(); }
});

test("a queued checkbox event leaves the newer version of the same comment alone", () => {
  const f = fixture();
  try {
    f.git("commit", "--allow-empty", "-qm", "New PR commit");
    const event = join(f.dir, "out/event.json");
    mkdirSync(join(f.dir, "out"));
    writeFileSync(event, JSON.stringify({ action: "edited", comment: { id: 1, body: f.body.replace("[ ]", "[x]") }, issue: { number: 1, pull_request: {} } }));
    const newer = f.body.replace(f.original, f.git("rev-parse", "HEAD"));
    const ran = f.run("./fix.ts", { GITHUB_EVENT_PATH: event, PROOFED_AUTO: "false", FIXTURE_REPORT: newer });
    assert.equal(ran.status, 0, ran.stdout + ran.stderr);
    assert.deepEqual(f.events(), []);
  } finally { f.cleanup(); }
});

test("the fixer replays the stored PR description alongside a failed file scenario", () => {
  const f = fixture("android", "", "node build.cjs", false, { description: "stored" });
  try {
    const ran = f.run();
    assert.equal(ran.status, 0, ran.stdout + ran.stderr);
    assert.deepEqual(f.runs().map((c) => c.args![1]), [
      kaneObjective("Assert counter is 1. [fake-from:counter] [delay:1]"),
      kaneObjective(description.objective),
    ]);
    const events = f.events();
    assert.match(events.find((e) => e.type === "ask")!.value as string, /What the PR description asks/);
    const body = events.find((e) => e.type === "report" && (e.value as string).includes("**Fixed in "))!.value as string;
    assert.match(body, /#### ✓ What the PR description asks/);
    assert.deepEqual(readReportData(body)?.failures, []);
  } finally { f.cleanup(); }
});

test("a missing PR request leaves its result unverified and lets the file fix proceed", () => {
  const f = fixture("android", "", "node build.cjs", false, { description: "missing" });
  try {
    const ran = f.run();
    assert.equal(ran.status, 0, ran.stdout + ran.stderr);
    assert.equal(f.runs().length, 1);
    const events = f.events();
    assert.ok(events.some((e) => e.type === "push"));
    assert.doesNotMatch(events.find((e) => e.type === "ask")!.value as string, /What the PR description asks/);
    const body = events.find((e) => e.type === "report" && (e.value as string).includes("**Fixed in "))!.value as string;
    assert.match(body, /Proofed couldn't re-run this request during the fix\. The previous check failed: The counter reset\./);
    assert.deepEqual(readReportData(body)?.open, ["asked-in-description"]);
    assert.deepEqual(events.findLast((e) => e.type === "status")?.value, { state: "success", description: "1 passed, 1 not checked" });
  } finally { f.cleanup(); }
});

test("the fixer skips a doubted description stored as a failure in an older report", () => {
  const f = fixture("android", "", "node build.cjs", false, { description: "doubted" });
  try {
    const ran = f.run();
    assert.equal(ran.status, 0, ran.stdout + ran.stderr);
    assert.equal(f.runs().length, 1);
    const events = f.events();
    assert.ok(events.some((e) => e.type === "push"));
    assert.doesNotMatch(events.find((e) => e.type === "ask")!.value as string, /What the PR description asks/);
    const body = events.find((e) => e.type === "report" && (e.value as string).includes("**Fixed in "))!.value as string;
    assert.match(body, /<sub>Kane couldn't verify what the PR description asks\.<\/sub>/);
    assert.equal(readReportData(body)?.asked, undefined);
  } finally { f.cleanup(); }
});

for (const [descriptionVerdict, counter, expectedStatus, failures, summary] of [
  ["refuted", "fail", "failure", ["counter"], "1 of 1 broke: Counter"],
  ["refuted", "pass", "success", [], "1 scenario(s) pass on an Android device"],
  ["fail", "pass", "failure", ["asked-in-description"], "1 of 2 broke: What the PR description asks"],
] as const) test(`the PR check reports a ${descriptionVerdict} description with a ${counter}ing file scenario`, () => {
  const f = fixture();
  try {
    const { ran, output, body } = f.check(`Check the upgrade condition. [fake:${descriptionVerdict}] [delay:1]`, counter);
    assert.equal(ran.status, failures.length ? 1 : 0, ran.stdout + ran.stderr);
    assert.equal(output, failures.length ? "fixable=true\n" : "");
    assert.deepEqual(f.events().findLast((e) => e.type === "status")?.value, { state: expectedStatus, description: summary });
    const data = readReportData(body);
    assert.deepEqual(data?.failures.map((failure) => failure.id), failures);
    if (descriptionVerdict === "refuted") {
      assert.match(body, /<sub>Kane couldn't verify what the PR description asks\.<\/sub>/);
      assert.equal(data?.asked, undefined);
      assert.equal(data?.open?.includes("asked-in-description") ?? false, false);
    } else {
      assert.match(body, /#### ✗ What the PR description asks/);
      assert.equal(data?.asked?.[0]?.id, "asked-in-description");
    }
  } finally { f.cleanup(); }
});

for (const ignoredBuildOutput of [false, true]) test(`a retried fix commits the ${ignoredBuildOutput ? "ignored " : ""}tracked output Kane checked`, () => {
  const f = fixture("android", "", "node build.cjs", false, { buildOutput: true, ignoredBuildOutput });
  try {
    const ran = f.run();
    assert.equal(ran.status, 0, ran.stdout + ran.stderr);
    assert.deepEqual(f.events().filter((e) => ["ask", "build", "push"].includes(e.type)).map((e) => e.type), ["ask", "build", "ask", "build", "push"]);
    assert.equal(f.git("diff", "--name-only", f.original, "HEAD"), "app.js\ndist/config.js\ndist/index.html\ndist/old.html\nnew-helper.js");
    assert.equal(f.git("show", "HEAD:dist/config.js"), "fixed config");
    assert.equal(f.git("show", "HEAD:dist/index.html"), "bundle: fixed");
    assert.equal(f.git("rev-parse", "HEAD:dist/index.html"), f.git("hash-object", "--no-filters", "app.apk"));
    assert.equal(f.git("ls-tree", "--name-only", "HEAD", "dist/old.html"), "");
    assert.equal(f.git("status", "--porcelain"), "");
  } finally { f.cleanup(); }
});

test("a partial fix leaves the original check and both failures in the report for the next fix", () => {
  const f = fixture("android", "", "node build.cjs", false, { partialFix: true });
  try {
    const ran = f.run("./fix.ts", { GITHUB_STEP_SUMMARY: f.dir });
    assert.equal(ran.status, 1, ran.stdout + ran.stderr);
    assert.match(ran.stdout, /Couldn't write the fix step summary/);
    assert.equal(f.git("rev-parse", "HEAD"), f.original);
    const events = f.events();
    assert.equal(events.some((e) => e.type === "push"), false);
    const body = events.find((e) => e.type === "report" && String(e.value).includes("Nothing was pushed"))?.value as string;
    assert.deepEqual(readReportData(body), readReportData(f.body));
    assert.match(body, /\*\*2 of 3\*\* scenarios broke/);
    assert.match(body, /#### ✗ Counter[\s\S]*#### ✗ Extra/);
    assert.match(body, /Passed: Home/);
    assert.match(body, /Kane saw "Counter" pass on the attempted fix/);
    assert.match(body, /"Extra" still fails/);
    assert.match(body, /<!-- proofed:run pr-1\/[\da-f]{7}-local-1-fix -->$/);
    assert.equal(events.find((e) => e.type === "read-run")?.value, "pr-1/original/run.json");
    const runFile = JSON.parse(events.find((e) => e.type === "run-file")!.value as string) as RunFile;
    assert.deepEqual(runFile.scenarios, f.originalRun.scenarios);
    assert.deepEqual(runFile.skipped, f.originalRun.skipped);
    assert.equal(runFile.sha, f.original);
    assert.equal(runFile.fix?.status, "gave-up");
    assert.match(runFile.fix?.summary ?? "", /"Counter" pass on the attempted fix/);
    assert.match(runFile.fix?.attempts?.at(-1)?.result ?? "", /"Extra" still fails/);
    assert.equal(events.findLast((e) => e.type === "status")?.sha, f.original);
    assert.deepEqual(events.findLast((e) => e.type === "status")?.value, {
      state: "failure", description: "The original failures stand. Nothing was pushed.",
    });

    const next = f.run("./fix.ts", { FIXTURE_REPORT: body });
    assert.equal(next.status, 1, next.stdout + next.stderr);
    const firstPrompt = f.events().slice(events.length).find((e) => e.type === "ask")?.value as string;
    assert.match(firstPrompt, /Scenario "Counter"[\s\S]*Scenario "Extra"/);
  } finally { f.cleanup(); }
});

test("the fixer refuses to commit when staging leaves out an untracked build input", () => {
  const f = fixture("android", "", "node build.cjs", false, { buildOutput: true, untrackedBuildOutput: true });
  try {
    const ran = f.run();
    assert.equal(ran.status, 1, ran.stdout + ran.stderr);
    assert.equal(f.git("rev-parse", "HEAD"), f.original);
    assert.equal(f.events().some((e) => e.type === "push"), false);
    const body = f.events().filter((e) => e.type === "report").map((e) => String(e.value))
      .findLast((body) => body.startsWith("<!-- proofed -->"));
    assert.match(body ?? "", /untracked build outputs/);
  } finally { f.cleanup(); }
});

test("a fix restores ignored tracked output rewritten or deleted by the agent", () => {
  const f = fixture("android", "", "node build.cjs", false, { agentBuildOutput: "with-source" });
  try {
    const ran = f.run();
    assert.equal(ran.status, 0, ran.stdout + ran.stderr);
    assert.equal(f.git("diff", "--name-only", f.original, "HEAD"), "app.js");
    assert.equal(readFileSync(join(f.dir, "dist/index.html"), "utf8"), "committed output");
    assert.equal(readFileSync(join(f.dir, "dist/old.html"), "utf8"), "committed old output");
    assert.equal(f.git("status", "--porcelain"), "");
    assert.ok(f.events().some((e) => e.type === "push"));
  } finally { f.cleanup(); }
});

test("agent edits to ignored tracked output alone do not start the build", () => {
  const f = fixture("android", "", "node build.cjs", false, { agentBuildOutput: "only" });
  try {
    const ran = f.run();
    assert.equal(ran.status, 1, ran.stdout + ran.stderr);
    assert.equal(f.git("rev-parse", "HEAD"), f.original);
    const events = f.events();
    assert.equal(events.some((e) => ["build", "push"].includes(e.type)), false);
    assert.ok(events.some((e) => e.type === "report" && /You made no changes to the code/.test(e.value as string)));
  } finally { f.cleanup(); }
});

test("the final selection checks every scenario after rebuilding for a missing result", () => {
  const f = fixture("android", "", "node build.cjs", false, { extraScenario: true });
  try {
    const ran = f.run();
    assert.equal(ran.status, 0, ran.stdout + ran.stderr);
    assert.match(ran.stdout, /Final check: 0 result\(s\) from the last attempt, 2 to run\./);
    assert.deepEqual(f.runs().map((c) => /\[fake-from:([^\]]+)\]/.exec(c.args![1]!)?.[1]), ["counter", "counter", "extra"]);
    assert.deepEqual(f.events().filter((e) => ["ask", "build", "push"].includes(e.type)).map((e) => e.type), ["ask", "build", "build", "push"]);
  } finally { f.cleanup(); }
});

test("a changed tree after the attempt rebuilds and checks the whole final selection", () => {
  const f = fixture("android", "", "node build.cjs", false, { extraScenario: true, changeAfterAttempt: true });
  try {
    const ran = f.run();
    assert.equal(ran.status, 0, [ran.error, ran.signal, ran.stdout, ran.stderr].filter(Boolean).join("\n"));
    assert.match(ran.stdout, /Final check: 0 result\(s\) from the last attempt, 2 to run\./);
    assert.deepEqual(f.runs().map((c) => /\[fake-from:([^\]]+)\]/.exec(c.args![1]!)?.[1]), ["counter", "counter", "extra"]);
    assert.equal(f.git("show", "HEAD:new-helper.js"), "changed after attempt");
    assert.deepEqual(f.events().filter((e) => ["ask", "build", "tree-change", "push"].includes(e.type)).map((e) => e.type), ["ask", "build", "tree-change", "build", "push"]);
  } finally { f.cleanup(); }
});

test("a previously passing check can fail on a different APK from the final build", () => {
  const f = fixture("android", "", "node build.cjs", true);
  try {
    const ran = f.run();
    assert.equal(ran.status, 1, ran.stdout + ran.stderr);
    assert.equal(readFileSync(join(f.dir, "app.apk"), "utf8"), "different APK from the final build");
    assert.deepEqual(f.runs().map((c) => /\[fake-from:([^\]]+)\]/.exec(c.args![1]!)?.[1]), ["counter", "counter", "extra"]);
    assert.equal(f.git("rev-parse", "HEAD"), f.original);
    assert.equal(f.events().some((e) => e.type === "push"), false);
    assert.ok(f.events().some((e) => e.type === "report" && /final check\. Nothing was pushed/.test(e.value as string)));
  } finally { f.cleanup(); }
});

for (const [extra, build, message] of [["app: APP123456\n", "node build.cjs", /pre-uploaded TestMu APP ID/], ["", "", /needs a build command/]] as const) test(`native refusal reaches the report and status before asking the fixer: ${message.source}`, () => {
  const f = fixture("android", extra, build);
  try {
    const ran = f.run();
    assert.equal(ran.status, 1, ran.stdout + ran.stderr);
    const events = f.events();
    assert.equal(events.some((e) => ["ask", "build", "push"].includes(e.type)), false);
    assert.match(events.find((e) => e.type === "report")!.value as string, message);
    assert.match((events.find((e) => e.type === "status")!.value as { description: string }).description, message);
  } finally { f.cleanup(); }
});

test("a desktop endpoint without launch or app is refused before asking the fixer", () => {
  const f = fixture("desktop", "cdp_endpoint: http://127.0.0.1:9223\n");
  try {
    const ran = f.run();
    assert.equal(ran.status, 1, ran.stdout + ran.stderr);
    const events = f.events();
    assert.equal(events.some((e) => ["ask", "build", "push"].includes(e.type)), false);
    assert.match(events.find((e) => e.type === "report")!.value as string, /only a desktop CDP endpoint/);
    assert.match((events.find((e) => e.type === "status")!.value as { description: string }).description, /only a desktop CDP endpoint/);
  } finally { f.cleanup(); }
});
