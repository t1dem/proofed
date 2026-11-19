import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import { test } from "node:test";
import type { UserRow } from "../src/worker/auth.ts";
import type { Env } from "../src/worker/index.ts";

// The Worker uses extensionless imports that Vite resolves for it.
const source = new URL("../src/", import.meta.url).href;
const hook = registerHooks({
  resolve(specifier, context, next) {
    return next(specifier.startsWith(".") && context.parentURL?.startsWith(source) && !extname(specifier) ? specifier + ".ts" : specifier, context);
  },
});
const { default: worker } = await import("../src/worker/index.ts");
const { handleApi, repoFixer, syncSecrets } = await import("../src/worker/api.ts");
const { encrypt } = await import("../src/worker/crypto.ts");
const { forget, memo } = await import("../src/worker/memo.ts");
hook.deregister();

test("malformed demo and account requests return 400 before changing anything", async (t) => {
  const secret = Buffer.alloc(32, 1).toString("base64");
  const user = { token: await encrypt(secret, "fixture-token"), token_expires: null };
  let reads = 0;
  const env = {
    TRY_REPO: "fixture/demo",
    SECRETS_KEY: secret,
    DB: {
      prepare: (sql: string) => {
        assert.match(sql, /SELECT users\.\*/);
        reads++;
        return { bind: () => ({ first: async () => user }) };
      },
    },
  } as unknown as Env;
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const path = new URL(input).pathname;
    if (path === "/user/installations") return Response.json({ installations: [{ id: 1 }] });
    assert.equal(path, "/user/installations/1/repositories");
    return Response.json({ repositories: [{ full_name: "fixture/demo", permissions: { push: true } }] });
  });
  const ctx = {} as Parameters<typeof worker.fetch>[2];
  for (const [path, bodies] of [
    ["/api/try", ["null", "{", "[]", '{"bug":1}', '{"bug":"qty-floor","extra":"' + "x".repeat(17_000) + '"}']],
    ["/api/keys", ["null", "{", "[]", '{"ltUsername":1}', '{"claudeToken":null}', '{"codexKey":{}}']],
    ["/api/pulls/fixture/demo/1/check", ["null", '{"what":1}']],
    ["/api/repos/fixture/demo/fixer", ["null", '{"model":1,"effort":"high"}', '{"model":"gpt-6.1-sol","effort":1}', '{"model":"gpt-6.1-sol","effort":"high","auto":"true"}', '{"auto":true}']],
  ] as const) {
    for (const body of bodies) {
      const res = await worker.fetch(new Request("https://example.test" + path, {
        method: "POST",
        body,
        headers: { cookie: "proofed_session=fixture" },
      }), env, ctx);
      assert.equal(res.status, 400, path + " " + body.slice(0, 50));
      assert.equal(typeof (await res.json() as { error?: string }).error, "string");
    }
  }
  assert.equal(reads, 13, "only authenticated requests read a session");
});

test("a rejected GitHub comment can be retried but an uncertain result cannot", async (t) => {
  const secret = Buffer.alloc(32, 1).toString("base64");
  const user = { token: await encrypt(secret, "comment-fixture"), token_expires: null };
  const env = {
    SECRETS_KEY: secret,
    DB: {
      prepare: (sql: string) => {
        assert.match(sql, /SELECT users\.\*/);
        return { bind: () => ({ first: async () => user }) };
      },
    },
  } as unknown as Env;
  let status = 403;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const path = new URL(input).pathname;
    if (path === "/user/installations") return Response.json({ installations: [{ id: 7 }] });
    if (path === "/user/installations/7/repositories") {
      return Response.json({ repositories: [{ full_name: "fixture/app", permissions: { push: true } }] });
    }
    assert.equal(path, "/repos/fixture/app/issues/1/comments");
    assert.equal(init.method, "POST");
    return Response.json({}, { status });
  });
  const path = "/api/pulls/fixture/app/1/fix";
  const ask = (route = path, body?: string) => handleApi(new Request("https://example.test" + route, {
    method: "POST", headers: { cookie: "proofed_session=fixture" }, body,
  }), env, route);
  const rejected = await ask();
  assert.equal(rejected.status, 403);
  const fix = await rejected.json() as { retryable: boolean; error: string };
  assert.equal(fix.retryable, true);
  assert.match(fix.error, /\/proofed fix$/);

  status = 422;
  const check = await ask("/api/pulls/fixture/app/1/check", '{"what":"check payment"}');
  assert.match((await check.json() as { error: string }).error, /\/proofed check payment$/);

  status = 502;
  await assert.rejects(ask(), /POST .*\/comments: 502/);
});

test("pulls remain readable when the installation token cannot be refreshed", async (t) => {
  const secret = Buffer.alloc(32, 1).toString("base64");
  const user = { token: await encrypt(secret, "pulls-fixture"), token_expires: null };
  const repo = "fixture/token-expired";
  const report = { repo, pr: 1, state: "passing", updated_at: Date.now() };
  const env = {
    SECRETS_KEY: secret,
    DB: {
      prepare: (sql: string) => ({
        bind: () => ({
          all: async () => ({ results: sql.includes("FROM reports") ? [report] : [] }),
          first: async () => sql.includes("FROM reports") ? report : user,
        }),
      }),
    },
  } as unknown as Env;
  await memo("app-jwt", 60_000, async () => "fixture-jwt");
  t.after(() => forget("app-jwt"));
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const path = new URL(input).pathname;
    if (path === "/user/installations") return Response.json({ installations: [{ id: 8 }] });
    if (path === "/user/installations/8/repositories") {
      return Response.json({ repositories: [{ full_name: repo }] });
    }
    assert.equal(path, "/app/installations/8/access_tokens");
    return new Response(null, { status: 403 });
  });
  for (const path of ["/api/pulls", `/api/pulls/${repo}/1`]) {
    const res = await handleApi(new Request("https://example.test" + path, {
      headers: { cookie: "proofed_session=fixture" },
    }), env, path);
    assert.equal(res.status, 200);
    const body = await res.json() as { repo: string; fixer?: unknown }[] | { pull: { repo: string; fixer?: unknown } };
    const pull = Array.isArray(body) ? body[0] : body.pull;
    assert.equal(pull?.repo, repo);
    assert.equal(pull?.fixer, undefined);
  }
});

test("syncing a Codex-only key selects Codex for repositories without a configured provider", async (t) => {
  const secret = Buffer.alloc(32, 1).toString("base64");
  const user = {
    codex_key: await encrypt(secret, "fixture-codex"),
    claude_token: null, lt_username: null, lt_key: null,
    token: await encrypt(secret, "codex-sync-fixture"), token_expires: null,
  } satisfies Pick<UserRow, "codex_key" | "claude_token" | "lt_username" | "lt_key" | "token" | "token_expires">;
  const installationId = 42;
  const memoKey = `installation:${installationId}`;
  await memo(memoKey, 60_000, async () => ({ token: "fixture", expires: Date.now() + 60_000 }));
  t.after(() => forget(memoKey));
  const env = {
    SECRETS_KEY: secret,
    DB: { prepare: () => ({ bind: () => ({ first: async () => user, run: async () => {} }) }) },
  } as unknown as Env;
  const writes: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const { pathname: path, searchParams } = new URL(input);
    if (path === "/user/installations") return Response.json({ installations: [{ id: installationId }] });
    if (path === "/user/installations/42/repositories") {
      return Response.json({ repositories: [{ full_name: "fixture/no-variables", permissions: { admin: true } }] });
    }
    if (path.endsWith("/public-key")) return Response.json({ key: Buffer.alloc(32, 2).toString("base64"), key_id: "fixture" });
    if (path.endsWith("/secrets/CODEX_API_KEY")) return new Response(null, { status: 204 });
    if (path.endsWith("/secrets/CLAUDE_CODE_OAUTH_TOKEN")) {
      return Response.json({}, { status: path.includes("/with-claude/") ? 200 : 404 });
    }
    assert.ok(path.endsWith("/actions/variables"));
    if (init.method === "GET") {
      if (path.includes("/no-variables/")) return new Response(null, { status: 403 });
      if (!path.includes("/with-model/")) return Response.json({ total_count: 0, variables: [] });
      const variables = searchParams.get("page") === "2"
        ? [{ name: "PROOFED_MODEL", value: "opus" }]
        : Array.from({ length: 100 }, (_, i) => ({ name: `VAR_${i}`, value: "fixture" }));
      return Response.json({ total_count: 101, variables });
    }
    assert.equal(init.method, "POST");
    writes.push({ path, variable: JSON.parse(String(init.body)) });
    return Response.json({}, { status: 201 });
  });
  for (const repo of ["codex-only", "with-claude", "with-model"]) {
    assert.deepEqual(await syncSecrets(env, user, `fixture/${repo}`, installationId), { pushed: ["CODEX_API_KEY"] });
  }

  const post = (path: string, body?: string) => handleApi(new Request("https://example.test" + path, {
    method: "POST", headers: { cookie: "proofed_session=fixture" }, body,
  }), env, path);
  const direct = await post("/api/repos/fixture/no-variables/secrets");
  assert.equal(direct.status, 200);
  const { pushed, warning } = await direct.json() as { pushed: string[]; warning: string };
  assert.deepEqual(pushed, ["CODEX_API_KEY"]);
  assert.match(warning, /accept the Variables permission/);
  const bulk = await post("/api/keys", '{"codexKey":"sk-fixture-not-a-real-key"}');
  assert.equal(bulk.status, 200);
  assert.deepEqual(await bulk.json(), { ok: true, synced: 1, of: 1, warning });
  assert.deepEqual(writes, [{ path: "/repos/fixture/codex-only/actions/variables", variable: { name: "PROOFED_PROVIDER", value: "codex" } }]);
});

test("a partial settings save invalidates the cached fixer", async (t) => {
  const secret = Buffer.alloc(32, 1).toString("base64");
  const user = { token: await encrypt(secret, "fixer-save-fixture"), token_expires: null };
  const env = {
    SECRETS_KEY: secret,
    DB: { prepare: () => ({ bind: () => ({ first: async () => user }) }) },
  } as unknown as Env;
  const repo = "fixture/partial-save";
  const installationId = 43;
  await memo(`installation:${installationId}`, 60_000, async () => ({ token: "fixture", expires: Date.now() + 60_000 }));
  t.after(() => {
    forget(`installation:${installationId}`);
    forget(`fixer:${repo}`);
  });
  let provider = "claude";
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const path = new URL(input).pathname;
    if (path === "/user/installations") return Response.json({ installations: [{ id: installationId }] });
    if (path === "/user/installations/43/repositories") {
      return Response.json({ repositories: [{ full_name: repo, permissions: { push: true } }] });
    }
    const vars = `/repos/${repo}/actions/variables`;
    if (path === vars) return Response.json({ total_count: 1, variables: [{ name: "PROOFED_PROVIDER", value: provider }] });
    assert.equal(init.method, "PATCH");
    if (path === `${vars}/PROOFED_PROVIDER`) {
      provider = (JSON.parse(String(init.body)) as { value: string }).value;
      return new Response(null, { status: 204 });
    }
    assert.equal(path, `${vars}/PROOFED_MODEL`);
    return new Response(null, { status: 403 });
  });
  assert.equal((await repoFixer("fixture", repo))?.provider, "claude");
  const path = `/api/repos/${repo}/fixer`;
  const res = await handleApi(new Request("https://example.test" + path, {
    method: "POST", headers: { cookie: "proofed_session=fixture" }, body: '{"model":"gpt-6.1-sol","effort":"high"}',
  }), env, path);
  assert.equal(res.status, 403);
  assert.equal((await repoFixer("fixture", repo))?.provider, "codex");
});

test("an in-flight read cannot restore a forgotten fixer", async (t) => {
  const key = "fixer:fixture/refresh";
  t.after(() => forget(key));
  const { promise, resolve } = Promise.withResolvers<string>();
  const read = memo(key, 60_000, () => promise);
  forget(key);
  resolve("claude");
  assert.equal(await read, "claude");
  assert.equal(await memo(key, 60_000, async () => "codex"), "codex");
});
