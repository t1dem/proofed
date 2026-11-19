import { delimiter, dirname } from "node:path";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { prepareTarget } from "./preparetarget.ts";
import { runAll } from "../check/pipeline.ts";
import { runScenario } from "../check/run.ts";
import { resolveScenarioTarget } from "./target.ts";

const nativeCases = {
  ios: "iOS records and packages a rebuilt simulator bundle",
  android: "Android records and finalizes video for each run",
  "android-during-pull": "Android finalizes the clip when stopped during a completed segment's pull",
  "android-pending-pid": "Android signals a new segment when its PID arrives after stop",
  "android-failed-pull": "Android cleans up a failed transfer and reports the pull error",
  "android-failed-remove": "Android encodes a pulled segment even when remote removal fails",
};
for (const [mode, title] of Object.entries(nativeCases)) test(title, { skip: process.platform !== "darwin" || process.arch !== "arm64" ? "Kane local mobile requires an Apple Silicon Mac" : false }, async () => {
  const kind = mode === "ios" ? "ios" : "android";
  const dir = mkdtempSync(join(tmpdir(), "proofed-native-test-"));
  const { TMPDIR, TEMP, TMP, PATH, KANE_CLI } = process.env;
  const saved = { TMPDIR, TEMP, TMP, PATH, KANE_CLI };
  const log = join(dir, "log");
  const tool = (name: string, source: string) => {
    const file = join(dir, name);
    writeFileSync(file, `#!${process.execPath}\nconst fs=require('node:fs'); const a=process.argv.slice(2); fs.appendFileSync(${JSON.stringify(log)}, ${JSON.stringify(name)}+' '+a.join(' ')+'\\n'); ${source}`);
    chmodSync(file, 0o755); return file;
  };
  try {
    Object.assign(process.env, { TMPDIR: dir, TEMP: dir, TMP: dir });
    process.env.PATH = `${dir}${delimiter}${PATH}`;
    tool("xcodebuild", "console.log('Xcode 26');");
    tool("xcrun", `if(a.includes('recordVideo')) { process.on('SIGINT',()=>{fs.writeFileSync(a.at(-1),'portrait-video');process.exit(0)}); setInterval(()=>{},100); } else console.log(JSON.stringify({devices:{'com.apple.CoreSimulator.SimRuntime.iOS-26-4':[{name:'iPhone 17',udid:'test-'+process.ppid,state:'Booted'}]}}));`);
    const remote = join(dir, "remote-0.mp4");
    const finishSegment = join(dir, "finish-segment");
    const pulling = join(dir, "pulling");
    const finishPull = join(dir, "finish-pull");
    const secondSegment = join(dir, "second-segment");
    const announcePid = join(dir, "announce-pid");
    tool("adb", `if(a[0]==='devices') console.log('List of devices attached\\nemulator-test-'+process.ppid+'\\tdevice');
else if(a.includes('name') || a.includes('ro.product.model')) console.log('Pixel');
else if(a.includes('ro.build.version.release')) console.log('15');
else if(a.some((x)=>x.startsWith('screenrecord '))) {
  const index = /-(\\d+)\\.mp4/.exec(a.at(-1))[1];
  const finish = () => {fs.writeFileSync(${JSON.stringify(join(dir, "remote-"))}+index+'.mp4','portrait-video');process.exit(0)};
  process.on('SIGINT', finish);
  if (index === '1') fs.writeFileSync(${JSON.stringify(secondSegment)}, '');
  if (${mode === "android-pending-pid"} && index === '1') {
    const wait = setInterval(()=>{if(fs.existsSync(${JSON.stringify(announcePid)})) {clearInterval(wait);console.log(process.pid);}}, 20);
    setTimeout(finish, 4000);
  } else {
    console.log(process.pid);
    setInterval(()=>{if(index === '0' && fs.existsSync(${JSON.stringify(finishSegment)})) finish();}, 20);
  }
}
else if(a.includes('kill')) process.kill(Number(a.at(-1)),'SIGINT');
else if(a.includes('pull')) {
  const index = /-(\\d+)\\.mp4/.exec(a.at(-2))[1];
  const copy = () => fs.copyFileSync(${JSON.stringify(join(dir, "remote-"))}+index+'.mp4',a.at(-1));
  if (${mode === "android-during-pull"} && index === '0') {
    fs.writeFileSync(${JSON.stringify(pulling)}, '');
    const wait = setInterval(()=>{if(fs.existsSync(${JSON.stringify(finishPull)})) {clearInterval(wait);copy();}}, 20);
  } else if (${mode === "android-failed-pull"}) { console.error('pull failed'); process.exitCode=1; }
  else copy();
}
else if(a.includes('rm')) {
  const index = /-(\\d+)\\.mp4/.exec(a.at(-1))[1];
  if (!${mode === "android-failed-remove"}) fs.unlinkSync(${JSON.stringify(join(dir, "remote-"))}+index+'.mp4');
  if (${mode === "android-failed-pull" || mode === "android-failed-remove"}) { console.error('rm failed'); process.exitCode=1; }
}`);
    tool("ffmpeg", `if (a[0] === '-hide_banner') {
  console.error('  Duration: 00:00:${kind === "android" ? "05.80" : "03.00"}, start: 0.000000');
  process.exit(1);
} else fs.writeFileSync(a.at(-1), 'fake-media');`);
    process.env.KANE_CLI = tool("kane", `if(a[0]==='doctor') console.log('managed dependencies ready'); else { const app=a[a.indexOf('--app')+1]; fs.appendFileSync(${JSON.stringify(log)}, 'installed '+fs.readFileSync(app).toString('base64')+'\\n'); setTimeout(()=>{console.log(JSON.stringify({step:1,status:'done',remark:'assert: counter is 1',ts:new Date().toISOString()})); console.log(JSON.stringify({type:'run_end',status:'passed',credits_consumed:2}));},200); }`);
    const app = join(dir, kind === "ios" ? "Counter.APP" : "test.apk");
    if (kind === "ios") { mkdirSync(app); writeFileSync(join(app, "Info.plist"), "fixture"); } else writeFileSync(app, "apk-fixture");
    const target = resolveScenarioTarget({ target: kind, app, device: kind === "ios" ? "iPhone 17" : "Pixel", os_version: kind === "ios" ? "26.4" : "15" }, {}, {}, dir);
    if (mode === "android-during-pull" || mode === "android-pending-pid" || mode === "android-failed-pull") {
      const prepared = await prepareTarget(target, { dir });
      try {
        if (mode === "android-failed-pull") {
          await assert.rejects(prepared.native!.stop(), { message: "pull failed" });
          assert.match(readFileSync(log, "utf8"), /shell rm/);
          assert.ok(!existsSync(remote));
          return;
        }
        writeFileSync(finishSegment, "");
        const marker = mode === "android-pending-pid" ? secondSegment : pulling;
        for (let i = 0; i < 150 && (!existsSync(marker) || !existsSync(secondSegment)); i++) await delay(20);
        assert.ok(existsSync(marker));
        assert.ok(existsSync(secondSegment), "the next segment records while the first pull is blocked");
        const stopped = prepared.native!.stop();
        writeFileSync(finishPull, "");
        writeFileSync(announcePid, "");
        const clip = await stopped;
        assert.ok(clip.mp4 && existsSync(clip.mp4));
        assert.match(readFileSync(log, "utf8"), /shell kill -2/);
        assert.match(readFileSync(join(dir, "segments.txt"), "utf8"), /native-0\.mp4'\n.*native-1\.mp4'/);
      } finally {
        writeFileSync(finishPull, "");
        writeFileSync(announcePid, "");
        await prepared.cleanup();
      }
      return;
    }
    const scenario = { id: "counter", name: "Counter", file: "", paths: [], url: "", objective: "Assert counter is 1.", resolvedTarget: target };
    const result = await runScenario(scenario, { outDir: dir, baseUrl: "", attempts: 1, noRetry: true });
    assert.equal(result.outcome, "passed", result.error ?? "unexpected result");
    assert.ok(result.clip?.mp4, result.recordingNote ?? "missing native recording");
    for (const file of [result.clip.mp4, result.clip.jpg, result.clip.gif]) assert.ok(file && existsSync(file));
    if (mode === "android-failed-remove") {
      assert.ok(existsSync(remote));
      assert.match(readFileSync(join(dirname(result.clip.mp4), "segments.txt"), "utf8"), /native-0\.mp4'/);
      return;
    }
    assert.ok(!existsSync(join(dirname(result.clip.mp4), "clip-untrimmed.mp4")));
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
    if (kind === "android") assert.match(calls, /-t 4\.30 -c copy .*clip\.mp4/);
    else assert.doesNotMatch(calls, /ffmpeg .* -t /);
    if (kind === "android") { assert.match(calls, /--time-limit 175/); assert.match(calls, /pull.*native-0.mp4/); assert.ok(calls.indexOf('pull ') < calls.lastIndexOf('shell rm ')); }
    if (kind === "ios") assert.match(calls, /--target simulator --app .*simulator.zip/);
    assert.ok(existsSync(app));
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
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
