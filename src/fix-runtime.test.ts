// Execute fix.ts against a temporary git repo. The fixer, Kane and GitHub/push are fakes.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dataComment } from "./report.ts";

const fixUrl = new URL("./fix.ts", import.meta.url).href;
const fakeKane = fileURLToPath(new URL("./testing/fake-kane.ts", import.meta.url));

function fixture(target = "android", extra = "", build = "node build.cjs", finalFails = false, options: { extraScenario?: boolean; changeAfterAttempt?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "proofed-fix-runtime-"));
  const log = join(dir, "events.jsonl");
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" }).trim();
  mkdirSync(join(dir, ".proofed/scenarios"), { recursive: true });
  writeFileSync(join(dir, ".gitignore"), "out/\napp.apk\napp.ipa\nevents.jsonl\nproofed-build.sh\nmodes/\n*.log\n");
  mkdirSync(join(dir, "modes"));
  writeFileSync(join(dir, "modes/counter"), "pass");
  writeFileSync(join(dir, "app.js"), "broken\n");
  if (options.extraScenario || finalFails) {
    writeFileSync(join(dir, "extra.js"), "old\n");
    writeFileSync(join(dir, "modes/extra"), "pass");
    writeFileSync(join(dir, ".proofed/scenarios/extra.md"), `---\nname: Extra\ntarget: ${target}\nexecution: cloud\napp: app.${target === "ios" ? "ipa" : "apk"}\npaths: [extra.js]\n---\nAssert extra is 1. [fake-from:extra] [delay:1]\n`);
  }
  writeFileSync(join(dir, ".proofed/scenarios/counter.md"), `---\nname: Counter\ntarget: ${target}\n${target === "desktop" ? "execution: local\n" : `execution: cloud\napp: app.${target === "ios" ? "ipa" : "apk"}\n`}${extra}---\nAssert counter is 1. [fake-from:counter] [delay:1]\n`);
  writeFileSync(join(dir, "build.cjs"), `const fs=require('node:fs'); fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({type:'build',code:fs.readFileSync('app.js','utf8')})+'\\n'); fs.writeFileSync('app.${target === "ios" ? "ipa" : "apk"}',fs.readFileSync('app.js')); ${finalFails ? `const rounds=fs.readFileSync(${JSON.stringify(log)},'utf8').split('"type":"build"').length-1;if(rounds===2)fs.writeFileSync('modes/extra','fail');` : ""}`);
  git("init", "-q", "-b", "main"); git("add", "-A"); git("commit", "-qm", "Initial fixture");
  const base = git("rev-parse", "HEAD");
  if (options.extraScenario || finalFails) writeFileSync(join(dir, "extra.js"), "PR changed it\n");
  writeFileSync(join(dir, "app.js"), "PR broke it\n"); git("commit", "-qam", "Break counter");
  const original = git("rev-parse", "HEAD");
  const body = `<!-- proofed -->\n### Proofed\n\nCounter broke.\n\n- [ ] **Fix with Claude**\n${dataComment({ sha: original, failures: [{ id: "counter", name: "Counter", file: ".proofed/scenarios/counter.md", objective: "Assert counter is 1.", reason: "Counter is 0.", diagnosis: "", steps: [] }] })}`;
  // All API functions fix.ts/pipeline.ts can call are local spies, and push never invokes git push.
  const github = `export * from ${JSON.stringify(new URL("./github.ts", import.meta.url).href)};
const record = (type, value) => { globalThis.fixtureLog(type,value); };
export const findReport=async()=>({id:1,body:${JSON.stringify(body)}});
export const listReports=async()=>({current:{id:1,body:${JSON.stringify(body)}},older:[]});
export const editComment=async(_repo,_id,body)=>{record('report',body);return {html_url:'https://example.test/report'};};
export const postComment=async(_repo,_pr,body)=>{record('report',body);return {html_url:'https://example.test/report'};};
export const setStatus=async(_repo,_sha,state,description)=>record('status',{state,description});
export const publishClips=async()=>new Map();
export const minimize=async()=>{};`;
  const agent = `export * from ${JSON.stringify(new URL("./agent.ts", import.meta.url).href)};
export function askAgent(prompt){ globalThis.fixtureLog('ask',prompt); const fs=globalThis.fixtureFs; fs.writeFileSync('app.js','fixed\\n'); fs.writeFileSync('new-helper.js','verified new file\\n'); return {ok:true,text:'SUMMARY: Fix counter'}; }`;
  const push = `export async function pushHead(){globalThis.fixtureLog('push');return false;}`;
  const mocks = new Map([
    [new URL("./github.ts", import.meta.url).href, `data:text/javascript,${encodeURIComponent(github)}`],
    [new URL("./agent.ts", import.meta.url).href, `data:text/javascript,${encodeURIComponent(agent)}`],
    [new URL("./push.ts", import.meta.url).href, `data:text/javascript,${encodeURIComponent(push)}`],
  ]);
  if (options.changeAfterAttempt) {
    const pipelineUrl = new URL("./pipeline.ts", import.meta.url).href;
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
globalThis.fixtureLog=(type,value)=>fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({type,value})+'\\n');
const mocks=new Map(${JSON.stringify([...mocks])});
registerHooks({resolve(specifier,context,next){const url=specifier.startsWith('.')&&context.parentURL?.startsWith('file:')?new URL(specifier,context.parentURL).href:specifier;
// A mock's re-export loads the original implementation, without remapping it again.
if(mocks.has(url)&&!context.parentURL?.startsWith('data:'))return {url:mocks.get(url),shortCircuit:true};return next(specifier,context);}});
globalThis.fetch=async()=>{throw new Error('Network forbidden in fixer fixture');};
await import(${JSON.stringify(fixUrl)});`;
  const env = { ...process.env, TMPDIR: dir, TEMP: dir, TMP: dir, GITHUB_TOKEN: "fixture-token", GITHUB_REPOSITORY: "fixture/repo", PROOFED_AUTO: "true", PROOFED_NUMBER: "1", PROOFED_BUILD: build, PROOFED_BASE_SHA: base, PROOFED_HEAD_REF: "main", PROOFED_OUT: join(dir, "out"), PROOFED_FIX: "true", PROOFED_DIR: ".", KANE_CLI: fakeKane, FAKE_KANE_LOG: join(dir, "kane.log"), FAKE_KANE_MODES: join(dir, "modes"), RUNNER_TEMP: dir };
  for (const key of ["PROOFED_TARGET", "PROOFED_EXECUTION", "PROOFED_APP", "PROOFED_URL", "PROOFED_SERVE", "PROOFED_BASE_REF", "GITHUB_EVENT_PATH", "GITHUB_RUN_ID", "PROOFED_MODEL", "PROOFED_PROVIDER", "PROOFED_CLAUDE_MODEL", "PROOFED_SCENARIOS", "ACTIONS_ID_TOKEN_REQUEST_URL", "ACTIONS_ID_TOKEN_REQUEST_TOKEN"]) delete env[key as keyof typeof env];
  // Hooks and generated scripts sit outside the tested checkout so they can never be committed.
  const preload = join(tmpdir(), `proofed-fix-preload-${process.pid}-${Date.now()}.mjs`);
  writeFileSync(preload, script);
  const run = () => spawnSync(process.execPath, [preload], { cwd: dir, env, encoding: "utf8", timeout: 30_000 });
  const runs = () => readFileSync(join(dir, "kane.log"), "utf8").trim().split("\n")
    .map((s) => JSON.parse(s) as { args?: string[] }).filter((c) => c.args?.[0] === "run");
  const events = () => readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((s) => JSON.parse(s) as { type: string; value?: string | { description: string; state: string }; code?: string });
  return { dir, original, git, run, runs, events, cleanup: () => { rmSync(dir, { recursive: true, force: true }); rmSync(preload, { force: true }); } };
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

test("the final selection runs only the scenario missing from the last attempt", () => {
  const f = fixture("android", "", "node build.cjs", false, { extraScenario: true });
  try {
    const ran = f.run();
    assert.equal(ran.status, 0, ran.stdout + ran.stderr);
    assert.match(ran.stdout, /Final check: 1 result\(s\) from the last attempt, 1 to run\./);
    assert.deepEqual(f.runs().map((c) => /\[fake-from:([^\]]+)\]/.exec(c.args![1]!)?.[1]), ["counter", "extra"]);
    assert.deepEqual(f.events().filter((e) => ["ask", "build", "push"].includes(e.type)).map((e) => e.type), ["ask", "build", "build", "push"]);
  } finally { f.cleanup(); }
});

test("a changed tree after the attempt rebuilds and checks the whole final selection", () => {
  const f = fixture("android", "", "node build.cjs", false, { extraScenario: true, changeAfterAttempt: true });
  try {
    const ran = f.run();
    assert.equal(ran.status, 0, ran.stdout + ran.stderr);
    assert.match(ran.stdout, /Final check: 0 result\(s\) from the last attempt, 2 to run\./);
    assert.deepEqual(f.runs().map((c) => /\[fake-from:([^\]]+)\]/.exec(c.args![1]!)?.[1]), ["counter", "counter", "extra"]);
    assert.equal(f.git("show", "HEAD:new-helper.js"), "changed after attempt");
    assert.deepEqual(f.events().filter((e) => ["ask", "build", "tree-change", "push"].includes(e.type)).map((e) => e.type), ["ask", "build", "tree-change", "build", "push"]);
  } finally { f.cleanup(); }
});

test("a failure on the final native check prevents the commit and push", () => {
  const f = fixture("android", "", "node build.cjs", true);
  try {
    const ran = f.run();
    assert.equal(ran.status, 1, ran.stdout + ran.stderr);
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
