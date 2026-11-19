import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { prepareBuild } from "./fixworkspace.ts";

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
