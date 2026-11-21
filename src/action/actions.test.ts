import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const setup = `
  import assert from "node:assert/strict";
  import { registerHooks } from "node:module";
  registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\\.[a-z]+$/i.test(specifier)) specifier += ".ts";
    return nextResolve(specifier, context);
  } });
  const { jobRepo, handleActionsPush } = await import(${JSON.stringify(new URL("../../site/src/worker/actions.ts", import.meta.url).href)});
  const { handleLivePost } = await import(${JSON.stringify(new URL("../../site/src/worker/live.ts", import.meta.url).href)});
  const alg = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
  const keys = await crypto.subtle.generateKey(alg, true, ["sign", "verify"]);
  const jwk = { ...await crypto.subtle.exportKey("jwk", keys.publicKey), kid: "github" };
  const env = {
    GITHUB_APP_ID: "123",
    GITHUB_APP_PRIVATE_KEY: Buffer.from(await crypto.subtle.exportKey("pkcs8", keys.privateKey)).toString("base64"),
    DB: { prepare() { throw new Error("Unauthorized request reached the database"); } },
  };
  const api = [];
  // A fake GitHub: the branch "feature/menu" is an open PR's head at "p".repeat(40).
  const sha = (c) => c.repeat(40);
  const github = { pulls: [{ head: { ref: "feature/menu", repo: { id: 123 } }, base: { repo: { default_branch: "main" } } }], tip: sha("a"), blob: sha("b"), tree: sha("e"), commit: sha("c") };
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith("/.well-known/jwks")) return Response.json({ keys: [jwk] });
    const u = new URL(String(url));
    api.push({ url: String(url), path: u.pathname, method: options.method, auth: options.headers?.authorization, body: options.body && JSON.parse(options.body) });
    if (u.pathname.endsWith("/installation")) return Response.json({ id: 5 });
    if (u.pathname.endsWith("/access_tokens")) return Response.json({ token: "push-token" });
    if (u.pathname === "/repos/owner/repo/pulls") return Response.json(github.pulls.filter((p) => "owner:" + p.head.ref === u.searchParams.get("head")));
    if (u.pathname.startsWith("/repos/owner/repo/git/ref/heads/")) return Response.json({ object: { sha: github.tip } });
    if (u.pathname.startsWith("/repos/owner/repo/git/commits/")) return Response.json({ tree: { sha: sha("0") } });
    if (u.pathname === "/repos/owner/repo/git/blobs") return Response.json({ sha: github.blob });
    if (u.pathname === "/repos/owner/repo/git/trees") return Response.json({ sha: github.tree });
    if (u.pathname === "/repos/owner/repo/git/commits") return Response.json({ sha: github.commit });
    if (u.pathname.startsWith("/repos/owner/repo/git/refs/heads/")) return Response.json({});
    throw new Error("Unexpected request: " + url);
  };
  const person = { name: "Claude", email: "noreply@anthropic.com", date: "2026-11-21T13:00:00+01:00" };
  const push = (over = {}) => ({
    branch: "feature/menu",
    commit: { sha: sha("c"), tree: sha("e"), parent: sha("a"), message: "Fix it\\n", author: person, committer: person },
    files: [{ path: "src/app.ts", mode: "100644", sha: sha("b"), content: "aGk=" }, { path: "old.txt", mode: "100644", sha: null }],
    ...over,
  });
  const good = {
    iss: "https://token.actions.githubusercontent.com", aud: "proofed", exp: Date.now() / 1000 + 300,
    repository: "owner/repo", repository_id: "123", workflow_ref: "owner/repo/.github/workflows/proofed.yml@refs/heads/main",
  };
  const b64url = (value) => Buffer.from(typeof value === "string" ? value : new Uint8Array(value)).toString("base64url");
  async function request(claims, path = "/api/actions/push", body = push()) {
    const unsigned = b64url(JSON.stringify({ alg: "RS256", kid: "github" })) + "." + b64url(JSON.stringify(claims));
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(unsigned));
    return new Request("https://proofed.test" + path, { method: "POST", headers: { authorization: "Bearer " + unsigned + "." + b64url(sig) }, body: JSON.stringify(body) });
  }
`;

function run(script: string) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", setup + script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr + result.stdout);
}

test("only the repository's Proofed workflow can get a push token or post live progress", () => run(`
  for (const workflow_ref of [
    undefined, null, 42, "", "owner/repo/.github/workflows/deploy.yml@refs/heads/main",
    "other/repo/.github/workflows/proofed.yml@refs/heads/main", "owner/repo/.github/workflows/proofed.yml.evil@refs/heads/main",
    "owner/repo/.github/workflows/proofed.yml", "owner/repo/.github/workflows/proofed.yml@",
  ]) {
    const claims = { ...good, workflow_ref };
    assert.equal(await jobRepo(await request(claims)), undefined, String(workflow_ref));
    const pushed = await handleActionsPush(await request(claims), env);
    assert.equal(pushed.status, 401);
    assert.deepEqual(await pushed.json(), { error: "unauthorized" });
    for (const path of ["/api/actions/live", "/api/actions/live/frame"]) {
      const live = await handleLivePost(await request(claims, path), env);
      assert.equal(live.status, 401);
      assert.deepEqual(await live.json(), { error: "unauthorized" });
    }
  }
  assert.deepEqual(api, []);
`));

test("Proofed jobs on branches, tags and PR refs are recognised for their own repository", () => run(`
  for (const ref of ["refs/heads/main", "refs/heads/feature/menu", "refs/tags/v1", "refs/pull/7/merge"]) {
    const claims = { ...good, workflow_ref: "owner/repo/.github/workflows/proofed.yml@" + ref };
    assert.deepEqual(await jobRepo(await request(claims)), { repo: "owner/repo", repoId: 123 });
    const live = await handleLivePost(await request(claims, "/api/actions/live"), env);
    assert.equal(live.status, 400);
    assert.deepEqual(await live.json(), { error: "bad live state" });
  }
`));

test("the server pushes the run's exact commit to the PR branch and never returns a token", () => run(`
  const res = await handleActionsPush(await request(good), env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const answer = await res.json();
  assert.deepEqual(answer, { sha: sha("c") });
  assert.ok(!JSON.stringify(answer).includes("push-token"));
  assert.deepEqual(api.find((r) => r.path.endsWith("/access_tokens")).body, { repository_ids: [123], permissions: { contents: "write", pull_requests: "read" } });
  assert.deepEqual(api.find((r) => r.path.endsWith("/git/trees")).body, {
    base_tree: sha("0"),
    tree: [{ path: "src/app.ts", mode: "100644", type: "blob", sha: sha("b") }, { path: "old.txt", mode: "100644", type: "blob", sha: null }],
  });
  assert.deepEqual(api.find((r) => r.path === "/repos/owner/repo/git/commits").body, {
    message: "Fix it\\n", tree: sha("e"), parents: [sha("a")], author: person, committer: person,
  });
  const update = api.at(-1);
  assert.equal(update.method, "PATCH");
  assert.equal(update.path, "/repos/owner/repo/git/refs/heads/feature/menu");
  assert.deepEqual(update.body, { sha: sha("c"), force: false });
  assert.ok(api.filter((r) => r.path.startsWith("/repos/")).every((r) => r.auth === "Bearer push-token" || r.path.endsWith("/installation")));
`));

test("the server refuses anything but one fast-forward commit on an open PR branch of the same repository", () => run(`
  const refusals = [
    [push({ branch: "main" }), 409],
    [push({ branch: "other" }), 409],
    [push({ branch: "../main" }), 400],
    [push({ branch: "-x" }), 400],
    [push({ files: [{ path: ".github/workflows/proofed.yml", mode: "100644", sha: sha("b"), content: "aGk=" }] }), 400],
    [push({ files: [{ path: ".GitHub/Workflows/x", mode: "100644", sha: null }] }), 400],
    [push({ files: [{ path: "a/../../x", mode: "100644", sha: null }] }), 400],
    [push({ files: [{ path: "a/.git/config", mode: "100644", sha: null }] }), 400],
    [push({ files: [{ path: "sub", mode: "160000", sha: sha("b"), content: "" }] }), 400],
    [push({ files: [{ path: "x", mode: "100644", sha: sha("b"), content: "not base64!" }] }), 400],
  ];
  for (const [body, status] of refusals) {
    api.length = 0;
    const res = await handleActionsPush(await request(good, "/api/actions/push", body), env);
    assert.equal(res.status, status, JSON.stringify(body));
    assert.ok(!api.some((r) => r.method === "PATCH" || r.path.endsWith("/git/blobs")), JSON.stringify(body));
  }
  // The PR comes from a fork with the same branch name.
  github.pulls[0].head.repo.id = 999;
  assert.equal((await handleActionsPush(await request(good), env)).status, 409);
  github.pulls[0].head.repo.id = 123;
  // The branch moved, or GitHub would make a different blob, tree or commit than the run did.
  for (const key of ["tip", "blob", "tree", "commit"]) {
    const kept = github[key];
    github[key] = sha("9");
    api.length = 0;
    const res = await handleActionsPush(await request(good), env);
    assert.equal(res.status, 409, key);
    assert.ok(!api.some((r) => r.method === "PATCH"), key);
    github[key] = kept;
  }
  // Too large for one request.
  const big = new Request("https://proofed.test/api/actions/push", { method: "POST", headers: (await request(good)).headers, body: "x".repeat(32 * 1024 * 1024 + 1) });
  assert.equal((await handleActionsPush(big, env)).status, 413);
`));
