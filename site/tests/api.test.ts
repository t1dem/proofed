import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import type { Env } from "../src/worker/index.ts";

// The Worker uses extensionless imports that Vite resolves for it.
const hook = registerHooks({
  resolve(specifier, context, next) {
    return next(specifier.startsWith(".") && context.parentURL?.includes("/src/") && !/\.[cm]?tsx?$/.test(specifier) ? specifier + ".ts" : specifier, context);
  },
});
const { default: worker } = await import("../src/worker/index.ts");
const { encrypt } = await import("../src/worker/crypto.ts");
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
    ["/api/repos/fixture/demo/fixer", ["null", '{"model":1}', '{"effort":1}', '{"auto":"true"}']],
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
  assert.equal(reads, 12, "only authenticated requests read a session");
});
