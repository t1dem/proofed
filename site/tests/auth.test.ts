import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import { test } from "node:test";

const source = new URL("../src/", import.meta.url).href;
const hook = registerHooks({
  resolve(specifier, context, next) {
    return next(specifier.startsWith(".") && context.parentURL?.startsWith(source) && !extname(specifier) ? specifier + ".ts" : specifier, context);
  },
});
const { logout } = await import("../src/worker/auth.ts");
hook.deregister();

function signOut(site?: string) {
  const deleted: unknown[] = [];
  const env = {
    DB: { prepare: () => ({ bind: (...args: unknown[]) => ({ run: async () => { deleted.push(...args); } }) }) },
  } as never;
  const headers: Record<string, string> = { cookie: "proofed_session=abc" };
  if (site) headers["sec-fetch-site"] = site;
  return logout(new Request("https://proofed.test/logout", { headers }), env).then((res) => ({ res, deleted }));
}

test("the Sign out link signs out", async () => {
  for (const site of ["same-origin", "none", undefined]) {
    const { res, deleted } = await signOut(site);
    assert.equal(res.status, 302);
    assert.deepEqual(deleted, ["abc"]);
    assert.match(res.headers.get("set-cookie") ?? "", /^proofed_session=;.*Max-Age=0/);
  }
});

test("another site can't sign the user out", async () => {
  for (const site of ["cross-site", "same-site"]) {
    const { res, deleted } = await signOut(site);
    assert.equal(res.status, 302);
    assert.deepEqual(deleted, []);
    assert.equal(res.headers.get("set-cookie"), null);
  }
});
