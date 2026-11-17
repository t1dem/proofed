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
  const { jobRepo, handleActionsToken } = await import(${JSON.stringify(new URL("../site/src/worker/actions.ts", import.meta.url).href)});
  const { handleLivePost } = await import(${JSON.stringify(new URL("../site/src/worker/live.ts", import.meta.url).href)});
  const alg = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
  const keys = await crypto.subtle.generateKey(alg, true, ["sign", "verify"]);
  const jwk = { ...await crypto.subtle.exportKey("jwk", keys.publicKey), kid: "github" };
  const env = {
    GITHUB_APP_ID: "123",
    GITHUB_APP_PRIVATE_KEY: Buffer.from(await crypto.subtle.exportKey("pkcs8", keys.privateKey)).toString("base64"),
    DB: { prepare() { throw new Error("Unauthorized request reached the database"); } },
  };
  const api = [];
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith("/.well-known/jwks")) return Response.json({ keys: [jwk] });
    api.push({ url, method: options.method, body: options.body && JSON.parse(options.body) });
    if (String(url).endsWith("/installation")) return Response.json({ id: 5 });
    if (String(url).endsWith("/access_tokens")) return Response.json({ token: "push-token" });
    throw new Error("Unexpected request: " + url);
  };
  const good = {
    iss: "https://token.actions.githubusercontent.com", aud: "proofed", exp: Date.now() / 1000 + 300,
    repository: "owner/repo", repository_id: "123", workflow_ref: "owner/repo/.github/workflows/proofed.yml@refs/heads/main",
  };
  const b64url = (value) => Buffer.from(typeof value === "string" ? value : new Uint8Array(value)).toString("base64url");
  async function request(claims, path = "/api/actions/token") {
    const unsigned = b64url(JSON.stringify({ alg: "RS256", kid: "github" })) + "." + b64url(JSON.stringify(claims));
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(unsigned));
    return new Request("https://proofed.test" + path, { method: "POST", headers: { authorization: "Bearer " + unsigned + "." + b64url(sig) }, body: "{}" });
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
    const token = await handleActionsToken(await request(claims), env);
    assert.equal(token.status, 401);
    assert.deepEqual(await token.json(), { error: "unauthorized" });
    for (const path of ["/api/actions/live", "/api/actions/live/frame"]) {
      const live = await handleLivePost(await request(claims, path), env);
      assert.equal(live.status, 401);
      assert.deepEqual(await live.json(), { error: "unauthorized" });
    }
  }
  assert.deepEqual(api, []);
`));

test("Proofed jobs on branches, tags and PR refs retain their repository-scoped token", () => run(`
  for (const ref of ["refs/heads/main", "refs/heads/feature/menu", "refs/tags/v1", "refs/pull/7/merge"]) {
    const claims = { ...good, workflow_ref: "owner/repo/.github/workflows/proofed.yml@" + ref };
    assert.deepEqual(await jobRepo(await request(claims)), { repo: "owner/repo", repoId: 123 });
    const token = await handleActionsToken(await request(claims), env);
    assert.equal(token.status, 200);
    assert.equal(token.headers.get("cache-control"), "no-store");
    assert.deepEqual(await token.json(), { token: "push-token" });
    assert.deepEqual(api.at(-1).body, { repository_ids: [123], permissions: { contents: "write" } });
    const live = await handleLivePost(await request(claims, "/api/actions/live"), env);
    assert.equal(live.status, 400);
    assert.deepEqual(await live.json(), { error: "bad live state" });
  }
`));
