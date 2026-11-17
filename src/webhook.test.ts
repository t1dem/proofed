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
  const { handleWebhook } = await import(${JSON.stringify(new URL("../site/src/worker/webhook.ts", import.meta.url).href)});
  const alg = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
  const keys = await crypto.subtle.generateKey(alg, true, ["sign", "verify"]);
  const writes = [], pending = [], api = [];
  const env = {
    GITHUB_APP_SLUG: "proofed-test", GITHUB_APP_ID: "123", GITHUB_WEBHOOK_SECRET: "test-secret",
    GITHUB_APP_PRIVATE_KEY: Buffer.from(await crypto.subtle.exportKey("pkcs8", keys.privateKey)).toString("base64"),
    DB: { prepare(sql) { return { bind(...values) { return { async run() { writes.push({ sql, values }); } }; } }; } },
  };
  const ctx = { waitUntil(task) { pending.push(task); } };
  globalThis.fetch = async (url, options) => {
    api.push(String(url));
    if (String(url).endsWith("/access_tokens")) return Response.json({ token: "app-token", expires_at: new Date(Date.now() + 3600000).toISOString() });
    if (String(url).includes("/contents/pr-7/run-1/run.json")) {
      assert.equal(options.headers.authorization, "Bearer app-token");
      return Response.json({ content: Buffer.from(JSON.stringify({ sha: "head", scenarios: [] })).toString("base64") });
    }
    throw new Error("Unexpected request: " + url);
  };
  const hmac = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.GITHUB_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  async function send(action, user, body = "<!-- proofed -->\\nAll scenarios pass.\\n<!-- proofed:run pr-7/run-1 -->") {
    const payload = JSON.stringify({
      action, repository: { full_name: "owner/repo" }, installation: { id: 5 },
      issue: { number: 7, title: "Fix the menu", state: "open", pull_request: {} },
      comment: { body, html_url: "https://github.com/owner/repo/pull/7#issuecomment-12", user },
    });
    const sig = await crypto.subtle.sign("HMAC", hmac, new TextEncoder().encode(payload));
    const response = await handleWebhook(new Request("https://proofed.test/api/github/webhook", {
      method: "POST", body: payload,
      headers: { "x-github-event": "issue_comment", "x-hub-signature-256": "sha256=" + Buffer.from(sig).toString("hex") },
    }), env, ctx);
    assert.equal(response.status, 200);
    await Promise.all(pending);
  }
`;

function run(script: string) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", setup + script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr + result.stdout);
}

for (const action of ["created", "edited", "deleted"]) {
  test(`${action} comments cannot spoof reports or runs with a pasted marker`, () => run(`
    for (const user of [
      undefined, { type: "User", login: "reader" }, { type: "Bot", login: "other-app[bot]" },
      { type: "User", login: "github-actions[bot]" }, { type: "User", login: "proofed-test[bot]" },
    ]) await send(${JSON.stringify(action)}, user);
    assert.deepEqual(writes, []);
    assert.deepEqual(pending, []);
    assert.deepEqual(api, []);
  `));

  test(`${action} reports from GitHub Actions and the configured app still update the dashboard`, () => run(`
    for (const login of ["github-actions[bot]", "proofed-test[bot]"]) {
      writes.length = 0;
      await send(${JSON.stringify(action)}, { type: "Bot", login });
      assert.equal(writes.length, 2);
      assert.match(writes[0].sql, /INSERT INTO reports/);
      assert.deepEqual(writes[0].values.slice(0, 5), ["owner/repo", 7, "passing", "All scenarios pass.", "https://github.com/owner/repo/pull/7#issuecomment-12"]);
      assert.match(writes[1].sql, /INSERT INTO runs/);
      assert.deepEqual(writes[1].values.slice(0, 4), ["owner/repo", 7, "pr-7/run-1", "head"]);
    }
    writes.length = 0;
    await send(${JSON.stringify(action)}, { type: "Bot", login: "github-actions[bot]" }, "<!-- proofed:old -->");
    assert.deepEqual(writes, []);
  `));
}
