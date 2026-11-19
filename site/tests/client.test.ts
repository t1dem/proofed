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
    const { fetchInto, mutate } = await import("../src/client/lib.ts");
    let renderedStale = false;
    mutate("/api/pulls", (value) => {
      renderedStale = true;
      return value;
    });
    assert.equal(renderedStale, false);
    assert.equal(stored[legacy], undefined);
    assert.deepEqual(await fetchInto("/api/pulls"), [{ title: "My pull request" }]);
    assert.deepEqual(stored, {});
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
