import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import { test } from "node:test";

test("the dashboard ignores legacy data from a different sign-in", async (t) => {
  const legacy = "proofed-cache:/api/pulls";
  const stored: Record<string, string> = { [legacy]: '[{"title":"Private pull request"}]' };
  Object.defineProperty(globalThis, "location", { configurable: true, value: new URL("https://proofed.test/app") });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      ...stored,
      getItem: (key: string) => stored[key] ?? null,
      setItem: (key: string, value: string) => { stored[key] = value; },
      removeItem: (key: string) => { delete stored[key]; },
    },
  });
  t.mock.method(globalThis, "fetch", async () => Response.json([{ title: "My pull request" }]));
  const source = new URL("../src/", import.meta.url).href;
  const hook = registerHooks({
    resolve(specifier, context, next) {
      return next(specifier.startsWith(".") && context.parentURL?.startsWith(source) && !extname(specifier) ? specifier + ".ts" : specifier, context);
    },
  });
  try {
    const { api, canAskAgain, fetchInto, mutate } = await import("../src/client/lib.ts");
    let renderedStale = false;
    mutate("/api/pulls", (value) => {
      renderedStale = true;
      return value;
    });
    assert.equal(renderedStale, false);
    assert.equal(stored[legacy], undefined);
    assert.deepEqual(await fetchInto("/api/pulls"), [{ title: "My pull request" }]);
    assert.deepEqual(stored, {});

    await t.test("an in-flight refresh keeps a confirmed fixer choice", async (t) => {
      const path = "/api/repos";
      t.mock.method(globalThis, "fetch", async () => Response.json({ model: "claude", paused: false }));
      await fetchInto(path);
      const { promise, resolve } = Promise.withResolvers<Response>();
      t.mock.method(globalThis, "fetch", () => promise);
      const refresh = fetchInto<{ model: string; paused: boolean }>(path);
      mutate<{ model: string }>(path, (repo) => ({ ...repo, model: "codex" }), { preserveDuringRefresh: true });
      resolve(Response.json({ model: "claude", paused: true }));
      assert.deepEqual(await refresh, { model: "codex", paused: true });
    });

    await t.test("reconciling a save reads settings after an older request finishes", async (t) => {
      const path = "/api/repos";
      const { promise, resolve } = Promise.withResolvers<Response>();
      let reads = 0;
      t.mock.method(globalThis, "fetch", () => ++reads === 1 ? promise : Promise.resolve(Response.json({ model: "codex" })));
      const stale = fetchInto(path);
      const fresh = fetchInto(path, { afterInFlight: true });
      assert.equal(reads, 1);
      resolve(Response.json({ model: "claude" }));
      assert.deepEqual(await stale, { model: "claude" });
      assert.deepEqual(await fresh, { model: "codex" });
      assert.equal(reads, 2);
    });

    await t.test("ask failures distinguish network and upstream errors from permanent rejections", async (t) => {
      let respond = async (): Promise<Response> => { throw new TypeError("Failed to fetch"); };
      t.mock.method(globalThis, "fetch", () => respond());
      const ask = () => api("/api/pulls/fixture/app/1/fix", { method: "POST" });
      const retryable = (expected: boolean) => (error: { message: string; retryable: boolean }) => {
        assert.equal(canAskAgain({ error: error.message, retryable: error.retryable }), expected);
        return true;
      };
      await assert.rejects(ask, retryable(true));
      respond = async () => Response.json(null, { status: 502 });
      await assert.rejects(ask, retryable(true));
      respond = async () => Response.json({ error: "Write access required" }, { status: 403 });
      await assert.rejects(ask, retryable(false));
      respond = async () => Response.json({ error: "Post /proofed fix", retryable: true }, { status: 403 });
      await assert.rejects(ask, retryable(true));
    });
  } finally {
    hook.deregister();
    Reflect.deleteProperty(globalThis, "location");
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("unavailable storage does not prevent the dashboard theme from loading", async () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get: () => { throw new DOMException("Storage is unavailable", "SecurityError"); },
  });
  try {
    const { storedTheme } = await import("../src/client/theme.ts");
    assert.equal(storedTheme(), "dark");
  } finally {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});
