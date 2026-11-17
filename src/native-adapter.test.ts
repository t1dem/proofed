import { delimiter } from "node:path";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { prepareTarget } from "./preparetarget.ts";
import { runAll } from "./pipeline.ts";
import { runScenario } from "./run.ts";
import { resolveScenarioTarget } from "./target.ts";

for (const kind of ["ios", "android"] as const) test(`${kind} records with fake device tools, finalizes video, and cleans only owned files`, { skip: process.platform !== "darwin" || process.arch !== "arm64" ? "Kane local mobile requires an Apple Silicon Mac" : false }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-native-test-"));
  const oldPath = process.env.PATH, oldKane = process.env.KANE_CLI;
  const log = join(dir, "log");
  const tool = (name: string, source: string) => {
    const file = join(dir, name);
    writeFileSync(file, `#!${process.execPath}\nconst fs=require('node:fs'); const a=process.argv.slice(2); fs.appendFileSync(${JSON.stringify(log)}, ${JSON.stringify(name)}+' '+a.join(' ')+'\\n'); ${source}`);
    chmodSync(file, 0o755); return file;
  };
  try {
    process.env.PATH = `${dir}${delimiter}${oldPath}`;
    tool("xcodebuild", "console.log('Xcode 26');");
    tool("xcrun", `if(a.includes('recordVideo')) { process.on('SIGINT',()=>{fs.writeFileSync(a.at(-1),'portrait-video');process.exit(0)}); setInterval(()=>{},100); } else console.log(JSON.stringify({devices:{'com.apple.CoreSimulator.SimRuntime.iOS-26-4':[{name:'iPhone 17',udid:'test-'+process.ppid,state:'Booted'}]}}));`);
    const remote = join(dir, "remote.mp4");
    tool("adb", `if(a[0]==='devices') console.log('List of devices attached\\nemulator-test-'+process.ppid+'\\tdevice');
else if(a.includes('name') || a.includes('ro.product.model')) console.log('Pixel');
else if(a.includes('ro.build.version.release')) console.log('15');
else if(a.includes('sh')) { console.log(process.pid); process.on('SIGINT',()=>{fs.writeFileSync(${JSON.stringify(remote)},'portrait-video');process.exit(0)}); setInterval(()=>{},100); }
else if(a.includes('kill')) process.kill(Number(a.at(-1)),'SIGINT');
else if(a.includes('pull')) fs.copyFileSync(${JSON.stringify(remote)},a.at(-1));
else if(a.includes('rm')) fs.unlinkSync(${JSON.stringify(remote)});`);
    tool("ffmpeg", "fs.writeFileSync(a.at(-1), 'fake-media');");
    process.env.KANE_CLI = tool("kane", `if(a[0]==='doctor') console.log('managed dependencies ready'); else { const app=a[a.indexOf('--app')+1]; fs.appendFileSync(${JSON.stringify(log)}, 'installed '+fs.readFileSync(app).toString('base64')+'\\n'); setTimeout(()=>{console.log(JSON.stringify({step:1,status:'done',remark:'assert: counter is 1',ts:new Date().toISOString()})); console.log(JSON.stringify({type:'run_end',status:'passed',credits_consumed:2}));},200); }`);
    const app = join(dir, kind === "ios" ? "Counter.app" : "test.apk");
    if (kind === "ios") { mkdirSync(app); writeFileSync(join(app, "Info.plist"), "fixture"); } else writeFileSync(app, "apk-fixture");
    const target = resolveScenarioTarget({ target: kind, app, device: kind === "ios" ? "iPhone 17" : "Pixel", os_version: kind === "ios" ? "26.4" : "15" }, {}, {}, dir);
    const scenario = { id: "counter", name: "Counter", file: "", paths: [], url: "", objective: "Assert counter is 1.", resolvedTarget: target };
    const result = await runScenario(scenario, { outDir: dir, baseUrl: "", attempts: 1, noRetry: true });
    assert.equal(result.outcome, "passed", result.error ?? "unexpected result");
    assert.ok(result.clip?.mp4, result.recordingNote ?? "missing native recording");
    for (const file of [result.clip.mp4, result.clip.jpg, result.clip.gif]) assert.ok(file && existsSync(file));
    const firstInstall = readFileSync(log, "utf8").split("\n").find((l) => l.startsWith("installed "));
    if (kind === "ios") writeFileSync(join(app, "Info.plist"), "rebuilt fixture"); else writeFileSync(app, "rebuilt apk");
    const [rechecked] = await runAll([scenario], join(dir, "final"), 1, { noRetry: true });
    assert.equal(rechecked!.outcome, "passed", rechecked!.error ?? "unexpected result");
    const calls = readFileSync(log, "utf8");
    const installs = calls.split("\n").filter((l) => l.startsWith("installed "));
    assert.equal(installs.length, 2);
    assert.notEqual(installs[1], firstInstall, "the rebuilt artifact reached the second Kane process");
    assert.doesNotMatch(calls, /--url|--cdp-endpoint|shutdown|uninstall|--install/);
    assert.match(calls, /scale=trunc\(iw\/2\)\*2:trunc\(ih\/2\)\*2/);
    if (kind === "android") { assert.match(calls, /--time-limit 175/); assert.match(calls, /pull.*native-0.mp4/); assert.ok(calls.indexOf('pull ') < calls.lastIndexOf('shell rm ')); }
    if (kind === "ios") assert.match(calls, /--target simulator --app .*simulator.zip/);
    assert.ok(existsSync(app));
  } finally { process.env.PATH = oldPath; if (oldKane === undefined) delete process.env.KANE_CLI; else process.env.KANE_CLI = oldKane; rmSync(dir, { recursive: true, force: true }); }
});

test("cloud preparation is screenshot-only and never starts a local device", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-cloud-test-"));
  try {
    const prepared = await prepareTarget(resolveScenarioTarget({ target: "ios", execution: "cloud", app: "APP123" }, {}, {}, dir), { dir });
    assert.deepEqual(prepared.kaneArgs, ["--target", "ios", "--app", "APP123"]);
    assert.match(prepared.metadata.recordingNote!, /screenshot-only/);
    assert.equal(prepared.native, undefined);
    await prepared.cleanup();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
