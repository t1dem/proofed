import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { discardLeak, hideCodexAuth, prepareBuild } from "./fixworkspace.ts";
import { kaneSecretValues } from "../kane/kaneauth.ts";

async function listen(t: TestContext) {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

function app(t: TestContext, url: string, script: string) {
  const dir = mkdtempSync(join(tmpdir(), "proofed-serve-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "server.cjs"), script);
  const env = { RUNNER_TEMP: dir, PROOFED_BUILD: "true", PROOFED_SERVE: `"${process.execPath}" server.cjs`, PROOFED_URL: url };
  for (const [key, value] of Object.entries(env)) {
    const original = process.env[key];
    t.after(() => { if (original === undefined) delete process.env[key]; else process.env[key] = original; });
    process.env[key] = value;
  }
  return prepareBuild(dir);
}

test("the build launcher preserves literal backslashes in POSIX paths", { skip: process.platform === "win32" }, (t) => {
  const root = mkdtempSync(join(tmpdir(), "proofed-build-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "app\\directory");
  mkdirSync(dir);
  const originalTemp = process.env.RUNNER_TEMP;
  const originalBuild = process.env.PROOFED_BUILD;
  process.env.RUNNER_TEMP = dir;
  process.env.PROOFED_BUILD = "pwd -L";
  t.after(() => {
    if (originalTemp === undefined) delete process.env.RUNNER_TEMP;
    else process.env.RUNNER_TEMP = originalTemp;
    if (originalBuild === undefined) delete process.env.PROOFED_BUILD;
    else process.env.PROOFED_BUILD = originalBuild;
  });
  const { buildCommand } = prepareBuild(dir);
  assert.equal(execFileSync("bash", ["-c", buildCommand], { encoding: "utf8" }).trimEnd(), dir);
});

test("startup accepts the new server on localhost", async (t) => {
  const { server, url } = await listen(t);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const port = new URL(url).port;
  const localhost = `http://localhost:${port}`;
  const { serve } = app(t, localhost, `require("node:http").createServer((_, res) => res.end("new app")).listen(${port}, "127.0.0.1");`);
  const stop = await serve();
  try {
    assert.equal(await (await fetch(localhost)).text(), "new app");
  } finally {
    await stop();
  }
});

test("startup rejects a port already accepting TCP connections before spawning", async (t) => {
  const { url } = await listen(t);
  const { serve } = app(t, url, "");
  delete process.env.PROOFED_SERVE;
  await assert.rejects(serve(), { message: `Port ${new URL(url).port} is already in use; stop the old server before Proofed starts the app.` });
});

test("startup stops waiting when a server accepts a connection without response headers", async (t) => {
  const { server, url } = await listen(t);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const port = new URL(url).port;
  const timeout = AbortSignal.timeout;
  t.mock.method(AbortSignal, "timeout", (ms: number) => timeout(ms === 30_000 ? 1700 : ms));
  const { serve } = app(t, url, `require("node:http").createServer(() => {}).listen(${port}, "127.0.0.1");`);
  await assert.rejects(serve(), /didn't come up .* within 30 seconds/);
});

test("a credential the fixer writes into an ignored file is found and the file removed", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-leak-test-"));
  const cwd = process.cwd();
  const token = process.env.GITHUB_TOKEN;
  t.after(() => {
    process.chdir(cwd);
    if (token === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = token;
    rmSync(dir, { recursive: true, force: true });
  });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  writeFileSync(join(dir, ".gitignore"), ".env\n");
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
  process.chdir(dir);
  process.env.GITHUB_TOKEN = "ghs_leakedtoken1234567890";
  const since = Date.now();
  writeFileSync(join(dir, ".env"), `TOKEN=${process.env.GITHUB_TOKEN}\n`);
  assert.equal(discardLeak("Claude", since), "Claude's change put a credential of this job into .env. Proofed discarded the change");
  assert.equal(existsSync(join(dir, ".env")), false);
});

test("the Codex subscription login is off disk until it is put back", { skip: process.platform === "win32" }, (t) => {
  const home = mkdtempSync(join(tmpdir(), "proofed-codex-home-"));
  const original = process.env.CODEX_HOME;
  t.after(() => {
    if (original === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = original;
    rmSync(home, { recursive: true, force: true });
  });
  process.env.CODEX_HOME = home;
  const file = join(home, "auth.json");
  writeFileSync(file, '{"tokens":"x"}', { mode: 0o600 });
  const restore = hideCodexAuth();
  assert.equal(existsSync(file), false);
  restore();
  restore();
  assert.equal(readFileSync(file, "utf8"), '{"tokens":"x"}');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const again = hideCodexAuth();
  const asset = join(home, "public.txt");
  writeFileSync(asset, "");
  symlinkSync(asset, file);
  again();
  assert.equal(readFileSync(asset, "utf8"), "");
  assert.equal(lstatSync(file).isSymbolicLink(), false);
  rmSync(file);
  hideCodexAuth()();
  assert.equal(existsSync(file), false);
});

test("Kane's output is still masked for the Codex login while it is off disk", (t) => {
  const home = mkdtempSync(join(tmpdir(), "proofed-codex-home-"));
  const original = process.env.CODEX_HOME;
  t.after(() => {
    if (original === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = original;
    rmSync(home, { recursive: true, force: true });
  });
  process.env.CODEX_HOME = home;
  const env = { PROOFED_CODEX_HOME: home };
  const auth = JSON.stringify({ tokens: { access_token: "access-token-123456", refresh_token: "refresh-token-123456", id_token: "id-token-123456" } });
  writeFileSync(join(home, "auth.json"), auth, { mode: 0o600 });
  const before = kaneSecretValues(env);
  const restore = hideCodexAuth();
  assert.deepEqual(kaneSecretValues(env), before);
  for (const value of [auth, "access-token-123456", "refresh-token-123456", "id-token-123456"]) assert.ok(kaneSecretValues(env).includes(value));
  restore();
  assert.deepEqual(kaneSecretValues(env), before);
  rmSync(join(home, "auth.json"));
  assert.deepEqual(kaneSecretValues(env), []);
});
