import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CLI = fileURLToPath(new URL("../proofed.ts", import.meta.url));
const FAKE_KANE = fileURLToPath(new URL("../testing/fake-kane.ts", import.meta.url));

function repo(t: TestContext, scenarios: Record<string, { mode: string; path?: string }> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "proofed-agent-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: dir, stdio: "ignore" });
  const log = join(dir, "tmp/kane.ndjson");
  mkdirSync(join(dir, "tmp"));
  writeFileSync(join(dir, ".gitignore"), "tmp/\n");
  // Cloud preparation hands an artifact ID straight to fake Kane, with no local device or browser.
  for (const [id, { mode, path = "app.js" }] of Object.entries(scenarios)) {
    mkdirSync(join(dir, ".proofed/scenarios"), { recursive: true });
    writeFileSync(join(dir, `.proofed/scenarios/${id}.md`), `---\nname: Scenario ${id}\npaths: [${path}]\ntarget: android\nexecution: cloud\napp: APP123\n---\nCheck the app. [fake:${mode}] [delay:5]\n`);
  }
  writeFileSync(join(dir, "app.js"), "export const price = 1;\n");
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-qm", "init");
  writeFileSync(join(dir, "app.js"), "export const price = 2;\n");
  const env: Record<string, string> = {
    KANE_CLI: FAKE_KANE, FAKE_KANE_LOG: log, TMPDIR: join(dir, "tmp"), TEMP: join(dir, "tmp"), TMP: join(dir, "tmp"),
  };
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !(key in env) && !/^(?:PROOFED_|FAKE_KANE_|LT_USERNAME$|LT_ACCESS_KEY$)/.test(key)) env[key] = value;
  }
  return {
    dir, env,
    calls: () => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { args?: string[]; child?: number }) : [],
    stop(active = false, extra: NodeJS.ProcessEnv = {}) {
      const input = JSON.stringify({ session_id: "test-session", cwd: dir, transcript_path: join(dir, "transcript.jsonl"), stop_hook_active: active });
      const ran = spawnSync(process.execPath, [CLI, "hook", "claude-stop"], { cwd: tmpdir(), env: { ...env, ...extra }, input, encoding: "utf8", timeout: 60_000 });
      assert.equal(ran.status, 0, ran.stderr || String(ran.error));
      return ran;
    },
  };
}

async function mcp(r: ReturnType<typeof repo>, env: Record<string, string> = r.env) {
  const client = new Client({ name: "proofed-test", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [CLI, "mcp"], cwd: r.dir, env, stderr: "pipe" });
  await client.connect(transport);
  return { client, transport };
}

function toolText(result: Awaited<ReturnType<Client["callTool"]>>) {
  assert.ok(Array.isArray(result.content));
  const [content] = result.content;
  assert.ok(content?.type === "text");
  return content.text as string;
}

const secret = 'fixture-token-with-"quotes"';
const observed = {
  GITHUB_TOKEN: secret,
  FAKE_KANE_FAILURE_REASON: `Shipping shows a wrong price. ${secret}\n${"x".repeat(2000)}`,
};

// Generous limits: these spawn the CLI several times, and a full parallel test run (or a CI runner) is slow.
test("MCP initializes, lists tools, estimates selection and returns normal results for a fail and a pass", { timeout: 120_000 }, async (t) => {
  const r = repo(t, { shipping: { mode: "fail" }, checkout: { mode: "pass", path: "checkout.js" } });
  const { client } = await mcp(r, { ...r.env, ...observed });
  try {
    assert.equal(client.getServerVersion()?.name, "proofed");
    assert.deepEqual((await client.listTools()).tools.map(({ name }) => name).sort(), ["proofed_check", "proofed_doctor", "proofed_list"]);
    const list = async (all: boolean) => JSON.parse(toolText(await client.callTool({ name: "proofed_list", arguments: { base: "main", all } })));
    assert.deepEqual((await list(false)).scenarios.map((s: { selected: boolean }) => s.selected), [false, true]);
    assert.deepEqual((await list(true)).scenarios.map((s: { selected: boolean }) => s.selected), [true, true]);
    assert.match(toolText(await client.callTool({ name: "proofed_doctor" })), /"checks":/);
    assert.equal(r.calls().filter((call) => call.args?.[0] === "run").length, 0);

    const progress: number[] = [];
    const fail = await client.callTool({ name: "proofed_check" }, undefined, { onprogress: (event) => progress.push(event.progress) });
    assert.ok(progress.length);
    assert.equal(fail.isError, undefined);
    const [summary, ...rest] = toolText(fail).split("\n");
    assert.match(summary!, /1 of 1 broke/);
    const [failedScenario] = JSON.parse(rest.join("\n")).scenarios;
    assert.equal(failedScenario.outcome, "failed");
    assert.match(failedScenario["Kane saw"].reason, /Shipping shows/);
    assert.match(failedScenario["Kane saw"].reason, /\*\*\*/);
    assert.ok(!failedScenario["Kane saw"].reason.includes(secret));
    assert.ok(failedScenario["Kane saw"].reason.length < 1500);
    assert.match(failedScenario["Kane saw"].diagnosis, /shipping threshold/);
    assert.match(failedScenario.rerun, /--only shipping/);

    const pass = await client.callTool({ name: "proofed_check", arguments: { only: ["checkout"] } });
    assert.equal(pass.isError, undefined);
    assert.match(toolText(pass), /^1 of 1 passed/);
    const plan = await client.callTool({ name: "proofed_check", arguments: { behavior: "-- verify the label", dryRun: true, target: "android" } });
    assert.equal(plan.isError, undefined);
    assert.match(toolText(plan), /^Would run 1 scenario/);
    const setup = await client.callTool({ name: "proofed_check", arguments: { only: ["missing"] } });
    assert.equal(setup.isError, true);
    assert.match(toolText(setup), /unknown_scenario/);
  } finally {
    await client.close();
  }
});

test("MCP cancellation and disconnect stop Kane and its descendants", { skip: process.platform === "win32", timeout: 120_000 }, async (t) => {
  const r = repo(t, { checkout: { mode: "hang" } });
  const { client, transport } = await mcp(r);
  const until = async (condition: () => boolean) => {
    for (let i = 0; i < 600; i++) {
      if (condition()) return;
      await delay(25);
    }
    assert.fail("timed out waiting for the fixture process");
  };
  const descendants = () => r.calls().flatMap(({ child }) => child ? [child] : []);
  const gone = (pid: number) => {
    const stat = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim();
    return stat === "" || stat.startsWith("Z");
  };
  const controller = new AbortController();
  try {
    const cancelled = client.callTool({ name: "proofed_check" }, undefined, { signal: controller.signal });
    const rejected = assert.rejects(cancelled);
    await until(() => descendants().length === 1);
    controller.abort();
    await rejected;
    await until(() => gone(descendants()[0]!));

    const disconnected = assert.rejects(client.callTool({ name: "proofed_check" }));
    await until(() => descendants().length === 2);
    const serverPid = transport.pid!;
    await transport.close();
    await disconnected;
    await until(() => gone(serverPid) && gone(descendants()[1]!));
  } finally {
    await client.close();
  }
});

test("Stop hook allows a repo with no scenarios and never runs an untouched scenario", (t) => {
  const empty = repo(t);
  const noScenarios = empty.stop();
  assert.equal(noScenarios.stdout + noScenarios.stderr, "");
  assert.deepEqual(empty.calls(), []);
  const untouched = repo(t, { checkout: { mode: "fail", path: "checkout.js" } });
  const unaffected = untouched.stop();
  assert.equal(unaffected.stdout + unaffected.stderr, "");
  assert.equal(untouched.calls().some((call) => call.args?.[0] === "run"), false);
});

test("Stop hook blocks a failure once during continuation and caps a session at three blocks", (t) => {
  const r = repo(t, { shipping: { mode: "fail" } });
  const { decision, reason } = JSON.parse(r.stop(false, observed).stdout);
  assert.equal(decision, "block");
  assert.match(reason, /Scenario shipping/);
  assert.match(reason, /Kane saw: "Shipping shows/);
  assert.match(reason, /\*\*\*/);
  assert.ok(!reason.includes(secret));
  assert.ok(!reason.includes("x".repeat(1500)));
  assert.match(reason, /proofed check --only shipping --json/);
  const repeated = r.stop(true);
  assert.equal(repeated.stdout, "");
  assert.match(repeated.stderr, /already reported/);
  for (let i = 0; i < 2; i++) assert.equal(JSON.parse(r.stop().stdout).decision, "block");
  const capped = r.stop();
  assert.equal(capped.stdout, "");
  assert.match(capped.stderr, /three-block limit/);
});

test("Stop hook allows a passing check and its cached pass", (t) => {
  const r = repo(t, { checkout: { mode: "pass" } });
  for (let i = 0; i < 2; i++) {
    const passed = r.stop();
    assert.equal(passed.stdout + passed.stderr, "");
  }
  assert.equal(r.calls().filter((call) => call.args?.[0] === "run").length, 1);
});

test("Stop hook blocks checks Kane could not verify or finish", (t) => {
  const r = repo(t, { vague: { mode: "noassert" }, interrupted: { mode: "error" } });
  const { decision, reason } = JSON.parse(r.stop().stdout);
  assert.equal(decision, "block");
  assert.match(reason, /Scenario vague" \(not_checked\)/);
  assert.match(reason, /Scenario interrupted" \(error\)/);
});

test("Stop hook allows a setup error and prints its fix", (t) => {
  const r = repo(t, { checkout: { mode: "pass" } });
  const setup = r.stop(false, { FAKE_KANE_SIGNED_IN: "0", FAKE_KANE_VERSION_WARNING: secret, GITHUB_TOKEN: secret });
  assert.equal(setup.stdout, "");
  assert.match(setup.stderr, /kane-cli login/);
  assert.ok(!setup.stderr.includes(secret));
  assert.equal(r.calls().some((call) => call.args?.[0] === "run"), false);
});
