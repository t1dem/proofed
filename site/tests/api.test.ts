import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import { test } from "node:test";
import type { UserRow } from "../src/worker/auth.ts";
import type { Env } from "../src/worker/index.ts";
import { resolveFixer } from "../../src/fix/models.ts";

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
        headers: { cookie: "proofed_session=fixture", origin: "https://example.test" },
      }), env, ctx);
      assert.equal(res.status, 400, path + " " + body.slice(0, 50));
      assert.equal(typeof (await res.json() as { error?: string }).error, "string");
    }
  }
  assert.equal(reads, 13, "only authenticated requests read a session");

  // Another site can't make the browser start a demo run or change anything with the user's cookie.
  for (const [path, headers] of [
    ["/api/try", {}],
    ["/api/try", { origin: "https://evil.example" }],
    ["/api/keys", { cookie: "proofed_session=fixture", origin: "https://evil.example" }],
    ["/api/repos/fixture/demo/pause", { cookie: "proofed_session=fixture", "sec-fetch-site": "cross-site" }],
  ] as const) {
    const res = await worker.fetch(new Request("https://example.test" + path, { method: "POST", body: '{"bug":"qty-floor"}', headers }), env, ctx);
    assert.equal(res.status, 403, path + " " + JSON.stringify(headers));
  }
  assert.equal(reads, 13, "a request from another site is turned away before it reads a session");
});

test("GitHub comment rejections explain what to post and upstream failures propagate", async (t) => {
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
      // Reports for queries of the reports table; the runs query only mentions it in a subquery.
      prepare: (sql: string) => ({
        bind: () => ({
          all: async () => ({ results: sql.startsWith("SELECT * FROM reports") ? [report] : [] }),
          first: async () => sql.startsWith("SELECT * FROM reports") ? report : user,
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

test("a partial settings save keeps the fixer coherent and invalidates its cache", async (t) => {
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
  const variables = new Map([["PROOFED_PROVIDER", "claude"], ["PROOFED_MODEL", "claude-opus-5-1"]]);
  let fail: string | undefined = "PROOFED_MODEL";
  let reads = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const path = new URL(input).pathname;
    if (path === "/user/installations") return Response.json({ installations: [{ id: installationId }] });
    if (path === "/user/installations/43/repositories") {
      return Response.json({ repositories: [{ full_name: repo, permissions: { push: true } }] });
    }
    const vars = `/repos/${repo}/actions/variables`;
    if (path === vars && init.method === "GET") {
      reads++;
      return Response.json({ total_count: variables.size, variables: [...variables].map(([name, value]) => ({ name, value })) });
    }
    assert.ok(path === vars || path.startsWith(`${vars}/`));
    const name = path === vars ? (JSON.parse(String(init.body)) as { name: string }).name : path.slice(vars.length + 1);
    if (name === fail && init.method !== "DELETE") return new Response(null, { status: 403 });
    if (init.method === "PATCH" && !variables.has(name)) return new Response(null, { status: 404 });
    if (init.method === "DELETE") variables.delete(name);
    else {
      assert.ok(init.method === "PATCH" || init.method === "POST");
      variables.set(name, (JSON.parse(String(init.body)) as { value: string }).value);
    }
    const choice = resolveFixer({
      provider: variables.get("PROOFED_PROVIDER"),
      model: variables.get("PROOFED_MODEL"),
      effort: variables.get("PROOFED_EFFORT"),
    });
    assert.ok(!("error" in choice), JSON.stringify(Object.fromEntries(variables)));
    return init.method === "POST" ? Response.json({}, { status: 201 }) : new Response(null, { status: 204 });
  });
  const path = `/api/repos/${repo}/fixer`;
  const save = (model: string, effort: string) => handleApi(new Request("https://example.test" + path, {
    method: "POST", headers: { cookie: "proofed_session=fixture" }, body: JSON.stringify({ model, effort }),
  }), env, path);
  const read = () => repoFixer("fixture", repo);
  const initial = await read();
  assert.equal(initial?.model, "claude-opus-5-1");
  assert.equal((await save("gpt-6.1-sol", "ultra")).status, 403);
  const beforeRefresh = reads;
  assert.deepEqual(await read(), initial);
  assert.equal(reads, beforeRefresh + 1);
  assert.equal(variables.get("PROOFED_MODEL"), "claude-opus-5-1");

  fail = undefined;
  const saved = await save("gpt-6.1-sol", "ultra");
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { fixer: { provider: "codex", model: "gpt-6.1-sol", effort: "ultra", auto: false } });
  assert.equal((await read())?.effort, "ultra");

  fail = "PROOFED_EFFORT";
  // The incompatible effort is cleared before the switch. Reject only its replacement.
  assert.equal((await save("claude-opus-5-1", "high")).status, 403);
  assert.deepEqual(await read(), { provider: "claude", model: "claude-opus-5-1", effort: "xhigh", auto: false });
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
