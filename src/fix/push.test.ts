import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { test, type TestContext } from "node:test";
import { pushHead } from "./push.ts";

const sha = "a".repeat(40);
const branch = "releases/current";
const ref = `refs/heads/${branch}`;
const remote = "https::https://github.com/fixture/repo";

function fixture(t: TestContext, server: string, updated = false) {
  const env = {
    GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "fixture/repo",
    GITHUB_TOKEN: "fixture-job-token", GIT_SSL_NO_VERIFY: "true",
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://oidc.example.test/token",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "fixture-request-token", PROOFED_SERVER: server,
  };
  const previous = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const git = t.mock.method(childProcess, "execFileSync", (_file: string, args: string[], _options?: { env?: NodeJS.ProcessEnv }) => {
    switch (args[0]) {
      case "diff-tree": return "";
      case "rev-parse": return sha;
      case "push":
        if (updated) throw new Error("Push reply lost");
        return "";
      case "ls-remote": return `${sha}\t${ref}\n`;
      default: throw new Error(`Unexpected git command: ${args[0]}`);
    }
  });
  syncBuiltinESMExports();
  return git;
}

test("a failed credentialed push verifies TLS and reconciles the exact remote branch", async (t) => {
  const git = fixture(t, "http://proofed.example.test", true);
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected fetch"); });
  assert.equal(await pushHead(branch), false);
  assert.equal(fetch.mock.callCount(), 0);
  const [, , push, read] = git.mock.calls;
  assert.deepEqual(push?.arguments[1], ["push", "--no-verify", "--", remote, `HEAD:${ref}`]);
  assert.deepEqual(read?.arguments[1], ["ls-remote", "--refs", "--", remote, ref]);
  assert.equal(push?.arguments[2]?.env?.GIT_ALLOW_PROTOCOL, "https");
  assert.equal(push?.arguments[2]?.env?.GIT_SSL_NO_VERIFY, undefined);
  assert.equal(push?.arguments[2]?.env?.GIT_CONFIG_KEY_2, "http.sslVerify");
  assert.equal(push?.arguments[2]?.env?.GIT_CONFIG_VALUE_2, "true");
});

test("the exchange deadline covers the OIDC and Proofed response bodies", async (t) => {
  const git = fixture(t, "http://127.0.0.1");
  for (const stalled of ["oidc", "exchange"]) {
    const deadline = new AbortController();
    const timeout = t.mock.method(AbortSignal, "timeout", () => deadline.signal);
    const fetch = t.mock.method(globalThis, "fetch", async (url: URL, options: RequestInit) => {
      const signal = options.signal;
      assert.equal(signal, deadline.signal);
      const oidc = url.hostname === "oidc.example.test";
      if (oidc && stalled === "exchange") return Response.json({ value: "fixture-oidc-token" });
      const body = new ReadableStream({
        pull(controller) {
          signal!.addEventListener("abort", () => controller.error(signal!.reason), { once: true });
          deadline.abort(new Error("Deadline expired"));
        },
      });
      return new Response(body);
    });
    assert.equal(await pushHead(branch), false);
    assert.equal(git.mock.calls.at(-1)?.arguments[1]?.[0], "push");
    assert.equal(timeout.mock.callCount(), 1);
    assert.equal(fetch.mock.callCount(), stalled === "oidc" ? 1 : 2);
    fetch.mock.restore();
    timeout.mock.restore();
  }
});
