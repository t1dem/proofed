import { delimiter } from "node:path";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cacheKey } from "./cache.ts";
import { kaneLogin } from "./kaneauth.ts";
import { runKane } from "./kane.ts";
import { outcomeOf } from "./run.ts";
import { parseScenario } from "./scenarios.ts";
import { resolveScenarioTarget } from "./target.ts";
import { kaneTarget, localDevice, renderer, targetChecks } from "./targetchecks.ts";

const temp = () => mkdtempSync(join(tmpdir(), "proofed-target-test-"));
function executable(dir: string, name: string, source: string) {
  const file = join(dir, name);
  writeFileSync(file, `#!${process.execPath}\n${source}`);
  chmodSync(file, 0o755);
  return file;
}

test("target fields resolve separately with flags, env, scenario, config and workflow precedence", () => {
  const dir = temp();
  try {
    mkdirSync(join(dir, ".proofed"));
    mkdirSync(join(dir, ".github/workflows"), { recursive: true });
    writeFileSync(join(dir, ".proofed/config.json"), JSON.stringify({ target: "android", device: "config", os_version: "15" }));
    writeFileSync(join(dir, ".github/workflows/check.yml"), "steps:\n  - uses: t1dem/proofed@main\n    with:\n      app: build/test.apk\n");
    const s = parseScenario("counter.md", "---\ntarget: ios\ndevice: 'iPhone 17'\nexecution: local\n---\nAssert counter reads 1.");
    const t = resolveScenarioTarget(s, { os_version: "26.4" }, { PROOFED_EXECUTION: "cloud" }, dir);
    assert.equal(t.kind, "ios");
    assert.equal(t.execution, "cloud");
    assert.equal(t.sources.os_version, "--os-version");
    assert.ok("device" in t && t.device === "iPhone 17");
    assert.ok("app" in t && t.app === join(dir, "build/test.apk"));
    assert.equal(kaneTarget(t), "ios");
    assert.equal(kaneTarget(resolveScenarioTarget({ target: "ios" }, {}, {}, dir)), "simulator");
    assert.equal(kaneTarget(resolveScenarioTarget({ target: "android" }, {}, {}, dir)), "emulator");
    assert.throws(() => resolveScenarioTarget({ target: "desktop", execution: "cloud" }, {}, {}, dir), /requires execution/);
    assert.throws(() => resolveScenarioTarget({ target: "safari" }, {}, {}, dir), /Invalid target/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("fake Kane argv has no native URL; run_end wins over exit and missing run_end is an error", async () => {
  const dir = temp();
  const old = process.env.KANE_CLI;
  try {
    process.env.KANE_CLI = executable(dir, "kane", `require('node:fs').writeFileSync(${JSON.stringify(join(dir, "argv"))}, JSON.stringify(process.argv.slice(2))); process.stdout.write('notice\\n' + JSON.stringify({step:1,status:'done',remark:'assert: café is visible',ts:new Date().toISOString()}) + '\\n' + JSON.stringify({type:'unknown',v:1}) + '\\n' + JSON.stringify({type:'run_end',status:'passed'}) + '\\n'); process.exitCode=9;`);
    const result = await runKane({ objective: "assert", kaneArgs: ["--target", "simulator", "--app", "test.zip", "--device-name", "iPhone 17", "--os-version", "26.4"], rawFile: join(dir, "raw") });
    assert.equal(outcomeOf(result.end, result.steps), "passed");
    assert.equal(result.exitCode, 9);
    const args = JSON.parse(readFileSync(join(dir, "argv"), "utf8")) as string[];
    assert.ok(!args.includes("--url") && !args.includes("--cdp-endpoint"));
    assert.match(readFileSync(join(dir, "raw"), "utf8"), /unknown/);
    process.env.KANE_CLI = executable(dir, "empty", "console.error('fatal: session disappeared');");
    const missing = await runKane({ objective: "assert", kaneArgs: ["--target", "android"] });
    assert.equal(outcomeOf(missing.end, missing.steps), "error");
    assert.match(missing.stderr, /session disappeared/);
  } finally { if (old === undefined) delete process.env.KANE_CLI; else process.env.KANE_CLI = old; rmSync(dir, { recursive: true, force: true }); }
});

test("fake device tools select one booted device; doctor only discovers and rejects incompatible artifacts", async () => {
  const dir = temp();
  try {
    const log = join(dir, "calls");
    const record = `require('node:fs').appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(' ')+'\\n');`;
    executable(dir, "xcrun", record + `console.log(JSON.stringify({devices:{'com.apple.CoreSimulator.SimRuntime.iOS-26-4':[{name:'iPhone 17',udid:'OWNED',state:'Booted'}]}}));`);
    executable(dir, "xcodebuild", record + "console.log('Xcode 26');");
    const bin = executable(dir, "kane", record + "console.log('all dependencies ready');");
    executable(dir, "adb", record + `const a=process.argv.slice(2); console.log(a[0]==='devices'?'List of devices attached\\nemulator-5554\\tdevice':a.includes('name')?'Pixel\\nOK':a.includes('ro.build.version.release')?'15':'Pixel');`);
    const env = { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}`, KANE_CLI: bin };
    const ios = resolveScenarioTarget({ target: "ios", app: "bad.ipa", device: "iPhone 17", os_version: "26.4" }, {}, {}, dir);
    assert.ok(ios.kind === "ios");
    assert.equal(await localDevice(ios, env), "OWNED");
    const checks = await targetChecks(ios, { env, platform: "darwin", arch: "arm64" });
    assert.ok(checks.some((c) => c.name === "App artifact type" && c.status === "fail"));
    assert.ok(checks.every((c) => c.fix));
    const android = resolveScenarioTarget({ target: "android", device: "Pixel", os_version: "15" }, {}, {}, dir);
    assert.ok(android.kind === "android");
    assert.equal(await localDevice(android, env), "emulator-5554");
    assert.doesNotMatch(readFileSync(log, "utf8"), /install|boot|download|recordVideo|screenrecord/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CDP discovery accepts exactly one page and rejects a popup", async () => {
  let pages = [{ id: "workbench", type: "page", url: "file:///app/workbench.html" }];
  const server = createServer((req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(req.url === "/json/version" ? { webSocketDebuggerUrl: "ws://unused" } : pages)); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const addr = server.address(); assert.ok(addr && typeof addr !== "string");
    const endpoint = `http://127.0.0.1:${addr.port}`;
    assert.equal((await renderer(endpoint)).id, "workbench");
    pages = [...pages, { id: "popup", type: "page", url: "about:blank" }];
    await assert.rejects(renderer(endpoint), /found 2/);
  } finally { server.closeAllConnections(); await new Promise<void>((r) => server.close(() => r())); }
});

test("cache changes with target, app content, device, OS and Kane version", () => {
  const dir = temp();
  try {
    const app = join(dir, "test.apk"); writeFileSync(app, "one");
    const s = parseScenario("counter.md", "---\ntarget: android\n---\nAssert counter 1.");
    const key = (device: string, os: string, version: string) => cacheKey({ ...s, resolvedTarget: resolveScenarioTarget({ ...s, app, device, os_version: os }, {}, {}, dir) }, "", [], undefined, "base", version);
    const first = key("Pixel", "15", "0.10.4");
    for (const next of [key("Pixel 2", "15", "0.10.4"), key("Pixel", "16", "0.10.4"), key("Pixel", "15", "0.10.5")]) assert.notEqual(next, first);
    writeFileSync(app, "two"); assert.notEqual(key("Pixel", "15", "0.10.4"), first);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the desktop recorder injects into the loaded renderer and refuses to follow another page", async () => {
  const { createHash } = await import("node:crypto");
  const { startRecorder } = await import("./recorder.ts");
  const dir = temp();
  const methods: { method: string; params: Record<string, unknown> }[] = [];
  const server = createServer((req, res) => {
    const addr = server.address(); assert.ok(addr && typeof addr !== "string");
    res.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${addr.port}/cdp` }));
  });
  server.on("upgrade", (req, socket) => {
    const accept = createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const send = (value: object) => {
      const data = Buffer.from(JSON.stringify(value));
      const header = data.length < 126 ? Buffer.from([129, data.length]) : Buffer.from([129, 126, data.length >> 8, data.length & 255]);
      socket.write(Buffer.concat([header, data]));
    };
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 6) {
        const opcode = buffer[0]! & 15;
        let length = buffer[1]! & 127, offset = 2;
        if (length === 126) { if (buffer.length < 8) return; length = buffer.readUInt16BE(2); offset = 4; }
        if (buffer.length < offset + 4 + length) return;
        const mask = buffer.subarray(offset, offset + 4), payload = Buffer.from(buffer.subarray(offset + 4, offset + 4 + length));
        buffer = buffer.subarray(offset + 4 + length);
        if (opcode === 8) { socket.end(); return; }
        for (let i = 0; i < payload.length; i++) payload[i] = payload[i]! ^ mask[i % 4]!;
        const m = JSON.parse(payload.toString()) as { id: number; method: string; params: Record<string, unknown> };
        methods.push(m); send({ id: m.id, result: {} });
        if (m.method === "Target.setDiscoverTargets") {
          send({ method: "Target.targetCreated", params: { targetInfo: { targetId: "workbench", type: "page" } } });
          send({ method: "Target.targetCreated", params: { targetInfo: { targetId: "popup", type: "page" } } });
        }
        if (m.method === "Target.attachToTarget") send({ method: "Target.attachedToTarget", params: { sessionId: "chosen", targetInfo: { targetId: "workbench", type: "page" } } });
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const addr = server.address(); assert.ok(addr && typeof addr !== "string");
    const recorder = await startRecorder(`http://127.0.0.1:${addr.port}`, dir, "workbench");
    assert.ok(methods.some((m) => m.method === "Runtime.evaluate" && String(m.params.expression).includes("pointerdown")));
    assert.deepEqual(methods.filter((m) => m.method === "Target.attachToTarget").map((m) => m.params.targetId), ["workbench"]);
    assert.ok(recorder.unexpectedPage);
    assert.ok(!methods.some((m) => m.method === "Target.createTarget"));
    recorder.stop();
  } finally { server.closeAllConnections(); await new Promise<void>((r) => server.close(() => r())); rmSync(dir, { recursive: true, force: true }); }
});

test("quoted executable arguments remain a shell command rather than an outer quoted scalar", () => {
  const launch = "'/Applications/Visual Studio Code.app/Contents/MacOS/Code' --user-data-dir '/tmp/owned profile'";
  const s = parseScenario("desktop.md", `---\ntarget: desktop\nlaunch: ${launch}\n---\nAssert editor text.`);
  assert.equal(s.launch, launch);
  assert.equal(s.url, "");
});

test("desktop app paths and launch commands relaunch the rebuilt renderer for each check", async (t) => {
  const { findChrome } = await import("./chrome.ts");
  const chrome = findChrome();
  if (!chrome) return t.skip("Chrome not found");
  const { prepareTarget } = await import("./preparetarget.ts");
  const dir = temp();
  // A Node app standing in for Electron. Its one Chromium renderer is real; no Kane run is needed.
  const app = join(dir, "desktop.cjs");
  const built = join(dir, "built.txt");
  const launches = join(dir, "launches.txt");
  writeFileSync(app, `const fs=require('node:fs'); const {spawn}=require('node:child_process');
fs.appendFileSync(${JSON.stringify(launches)}, fs.readFileSync(${JSON.stringify(built)},'utf8')+'\\n');
const child=spawn(${JSON.stringify(chrome)}, ['--headless=new','--no-sandbox','--no-first-run','--no-default-browser-check',${JSON.stringify(`--user-data-dir=${join(dir, "profile")}`)},...process.argv.slice(2),'data:text/html,<h1>Counter</h1>'], {stdio:'ignore'});
child.on('exit',code=>process.exit(code??0));`);
  try {
    const server = createServer();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address(); assert.ok(addr && typeof addr !== "string");
    const endpoint = `http://127.0.0.1:${addr.port}`;
    await new Promise<void>((r) => server.close(() => r()));
    for (const mode of ["app", "launch"] as const) {
      for (const phase of ["attempt", "final"]) {
        writeFileSync(built, `${mode}:${phase}`);
        const target = resolveScenarioTarget({ target: "desktop", cdp_endpoint: endpoint,
          ...(mode === "app" ? { app } : { launch: `"${process.execPath}" "${app}" --remote-debugging-port=${addr.port}` }),
        }, {}, {}, dir);
        const prepared = await prepareTarget(target, { dir: join(dir, `${mode}-${phase}`) });
        try {
          assert.ok((await renderer(endpoint)).url.startsWith("data:text/html"));
          assert.deepEqual(prepared.kaneArgs, ["--target", "desktop", "--cdp-endpoint", endpoint, "--allow-missing-url"]);
        } finally { await prepared.cleanup(); }
        await assert.rejects(renderer(endpoint), /fetch failed/);
      }
    }
    assert.equal(readFileSync(launches, "utf8"), "app:attempt\napp:final\nlaunch:attempt\nlaunch:final\n");
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); }
});

test("Kane credentials are removed from output, hooks, and saved diagnostics", async () => {
  const dir = temp();
  const old = process.env.KANE_CLI;
  const accessKey = "fixture-access-key";
  const rawFile = join(dir, "raw");
  try {
    process.env.KANE_CLI = executable(dir, "echo-kane", `
      const args = process.argv.slice(2);
      const key = args[args.indexOf("--access-key") + 1];
      if (args[0] === "balance") process.exit(1);
      const step = JSON.stringify({ step: 1, status: "done", remark: "assert: used " + key, ts: "" });
      process.stdout.write(step.slice(0, step.indexOf(key) + 4));
      process.stderr.write(key.slice(0, 4));
      setTimeout(() => {
        process.stdout.write(step.slice(step.indexOf(key) + 4) + "\\n");
        console.log(JSON.stringify({ type: "run_end", status: "passed", reason: key }));
        process.stderr.write(key.slice(4) + "\\n");
      }, 30);
    `);
    const events: unknown[] = [];
    const result = await runKane({ objective: "assert", kaneArgs: [], rawFile, username: "fixture-user", accessKey, onStep: (step) => events.push(step), onEnd: (end) => events.push(end) });
    assert.match(result.steps[0]!.remark, /assert: used \*\*\*/);
    assert.equal(result.end?.reason, "***");
    assert.equal(result.stderr.trim(), "***");
    for (const output of [JSON.stringify(events), readFileSync(rawFile, "utf8"), readFileSync(rawFile + ".stderr", "utf8")]) {
      assert.ok(!output.includes(accessKey));
    }
  } finally {
    if (old === undefined) delete process.env.KANE_CLI;
    else process.env.KANE_CLI = old;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a rejected Kane balance check masks the key in its diagnostic", async () => {
  const dir = temp();
  try {
    const bin = executable(dir, "kane", `
      console.error("401 key " + process.argv.at(-1) + " was rejected");
      process.exitCode = 1;
    `);
    const login = await kaneLogin(bin, { ...process.env, LT_USERNAME: "fixture-user", LT_ACCESS_KEY: "fixture-access-key" });
    assert.equal(login.state, "keys_rejected");
    assert.match(login.detail, /401 key \*\*\* was rejected/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
