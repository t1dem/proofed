import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { test, type TestContext } from "node:test";
import { headCommit, person, pushHead } from "./push.ts";

const sha = "a".repeat(40);
const parent = "b".repeat(40);
const tree = "c".repeat(40);
const blob = "d".repeat(40);
const branch = "releases/current";
const ref = `refs/heads/${branch}`;
const remote = "https::https://github.com/fixture/repo";
const plainCommit = `tree ${tree}\nparent ${parent}\nauthor Claude <noreply@anthropic.com> 1795262400 +0100\ncommitter Claude <noreply@anthropic.com> 1795262401 -0530\n\nFix it\n\nBody\n`;

function fixture(t: TestContext, server: string, { updated = false, commit = plainCommit } = {}) {
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
      case "diff-tree":
        // The LFS check lists names; the server push reads raw entries against the parent.
        return args.includes("--name-only") ? "" : `:100644 100644 ${"0".repeat(40)} ${blob} M\0src/app.ts\0:100644 000000 ${"1".repeat(40)} ${"0".repeat(40)} D\0old.txt\0`;
      case "cat-file": return args[1] === "commit" ? commit : Buffer.from("fixed");
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

const gitPush = (git: ReturnType<typeof fixture>) => git.mock.calls.filter((c) => c.arguments[1]?.[0] === "push");

test("a person line keeps its instant and offset, as GitHub needs to recreate the same commit", () => {
  assert.deepEqual(person("A B <a@b.c> 1795262400 +0100"), { name: "A B", email: "a@b.c", date: "2026-11-21T13:00:00+01:00" });
  assert.deepEqual(person("A <a@b.c> 1795262400 -0530"), { name: "A", email: "a@b.c", date: "2026-11-21T06:30:00-05:30" });
  assert.equal(person("broken"), undefined);
});

test("the server push sends the commit's files and metadata, and git doesn't push", async (t) => {
  const git = fixture(t, "http://127.0.0.1");
  const bodies: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (url: URL, options: RequestInit) => {
    if (url.hostname === "oidc.example.test") return Response.json({ value: "fixture-oidc-token" });
    assert.equal(url.pathname, "/api/actions/push");
    assert.equal(new Headers(options.headers).get("authorization"), "Bearer fixture-oidc-token");
    bodies.push(JSON.parse(String(options.body)));
    return Response.json({ sha });
  });
  assert.equal(await pushHead(branch), true);
  assert.equal(gitPush(git).length, 0);
  assert.deepEqual(bodies, [{
    branch,
    commit: {
      sha, tree, parent, message: "Fix it\n\nBody\n",
      author: { name: "Claude", email: "noreply@anthropic.com", date: "2026-11-21T13:00:00+01:00" },
      committer: { name: "Claude", email: "noreply@anthropic.com", date: "2026-11-21T06:30:01-05:30" },
    },
    files: [
      { path: "src/app.ts", mode: "100644", sha: blob, content: Buffer.from("fixed").toString("base64") },
      { path: "old.txt", mode: "100644", sha: null },
    ],
  }]);
});

test("a refused server push, or one that names another commit, falls back to the job's token", async (t) => {
  for (const answer of [Response.json({ error: "nope" }, { status: 409 }), Response.json({ sha: parent })]) {
    const git = fixture(t, "http://127.0.0.1");
    const fetch = t.mock.method(globalThis, "fetch", async (url: URL) =>
      url.hostname === "oidc.example.test" ? Response.json({ value: "fixture-oidc-token" }) : answer);
    assert.equal(await pushHead(branch), false);
    assert.equal(gitPush(git).length, 1);
    assert.equal(gitPush(git)[0]?.arguments[2]?.env?.GIT_CONFIG_VALUE_1, `AUTHORIZATION: basic ${Buffer.from("x-access-token:fixture-job-token").toString("base64")}`);
    fetch.mock.restore();
    git.mock.restore();
  }
});

test("a commit the server couldn't recreate exactly is pushed with the job's token without asking it", async (t) => {
  for (const commit of [
    plainCommit.replace("committer", "gpgsig -----BEGIN PGP SIGNATURE-----\n -----END PGP SIGNATURE-----\ncommitter"),
    plainCommit.replace(`parent ${parent}\n`, `parent ${parent}\nparent ${tree}\n`),
    plainCommit.replace("committer", "encoding ISO-8859-1\ncommitter"),
  ]) {
    const git = fixture(t, "http://127.0.0.1", { commit });
    assert.equal(headCommit(branch), undefined);
    const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected fetch"); });
    assert.equal(await pushHead(branch), false);
    assert.equal(fetch.mock.callCount(), 0);
    assert.equal(gitPush(git).length, 1);
    fetch.mock.restore();
    git.mock.restore();
  }
});

test("a failed credentialed push verifies TLS and reconciles the exact remote branch", async (t) => {
  const git = fixture(t, "http://proofed.example.test", { updated: true });
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected fetch"); });
  assert.equal(await pushHead(branch), false);
  assert.equal(fetch.mock.callCount(), 0);
  const calls = git.mock.calls.map((c) => c.arguments);
  const push = calls.find((a) => a[1]?.[0] === "push");
  const read = calls.find((a) => a[1]?.[0] === "ls-remote");
  assert.deepEqual(push?.[1], ["push", "--no-verify", "--", remote, `HEAD:${ref}`]);
  assert.deepEqual(read?.[1], ["ls-remote", "--refs", "--", remote, ref]);
  assert.equal(push?.[2]?.env?.GIT_ALLOW_PROTOCOL, "https");
  assert.equal(push?.[2]?.env?.GIT_SSL_NO_VERIFY, undefined);
  assert.equal(push?.[2]?.env?.GIT_CONFIG_KEY_2, "http.sslVerify");
  assert.equal(push?.[2]?.env?.GIT_CONFIG_VALUE_2, "true");
});

test("a stalled OIDC or Proofed answer ends in the job's push", async (t) => {
  for (const stalled of ["oidc", "push"]) {
    const git = fixture(t, "http://127.0.0.1");
    const deadline = new AbortController();
    const timeout = t.mock.method(AbortSignal, "timeout", () => deadline.signal);
    const fetch = t.mock.method(globalThis, "fetch", async (url: URL, options: RequestInit) => {
      const signal = options.signal!;
      if (url.hostname === "oidc.example.test" && stalled === "push") return Response.json({ value: `fixture-oidc-token-${stalled}` });
      const body = new ReadableStream({
        pull(controller) {
          signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
          deadline.abort(new Error("Deadline expired"));
        },
      });
      return new Response(body);
    });
    assert.equal(await pushHead(branch), false);
    assert.equal(gitPush(git).length, 1);
    fetch.mock.restore();
    timeout.mock.restore();
    git.mock.restore();
  }
});
