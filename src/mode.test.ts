import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const pr = { number: 7, head: { sha: "head", ref: "fork" }, base: { sha: "base", ref: "main" } };
const report = {
  id: 12, user: { type: "Bot" },
  body: '<!-- proofed -->\n- [x] **Fix with Claude**\n<!-- proofed:data {"sha":"head","failures":[{}]} -->',
};
const comment = (action = "created", body = "/proofed") => ({
  action, issue: { number: 7, pull_request: {} }, sender: { type: "User", login: "reader" },
  comment: action === "edited" ? report : { id: 13, body, user: { type: "User" }, author_association: "MEMBER" },
});

function run(event: object, permission: string | number, replyFails = false, env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "proofed-mode-"));
  try {
    const path = join(dir, "event.json");
    writeFileSync(path, JSON.stringify(event));
    const script = `
      import assert from "node:assert/strict";
      const calls = [];
      process.on("exit", () => console.log("api=" + JSON.stringify(calls)));
      globalThis.fetch = async (url, options) => {
        const path = new URL(url).pathname;
        assert.equal(options.headers.authorization, "Bearer job-token");
        calls.push({ path, method: options.method, body: options.body && JSON.parse(options.body) });
        if (path.endsWith("/permission")) {
          ${typeof permission === "number" ? `return new Response("permission unavailable", { status: ${permission} });` : `return Response.json({ permission: ${JSON.stringify(permission)} });`}
        }
        if (path.endsWith("/comments") && options.method === "POST") {
          return new Response(null, { status: ${replyFails ? 403 : 204} });
        }
        if (path.endsWith("/comments")) return Response.json([${JSON.stringify(report)}]);
        if (path.endsWith("/pulls/7")) return Response.json(${JSON.stringify(pr)});
        throw new Error("Unexpected request: " + path);
      };
      await import(${JSON.stringify(new URL("./mode.ts", import.meta.url).href)});
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
      env: {
        ...process.env, GITHUB_EVENT_PATH: path, GITHUB_TOKEN: "job-token", GITHUB_REPOSITORY: "owner/repo",
        GITHUB_OUTPUT: "", PROOFED_VARS: "{}", PROOFED_FIX: "true", PROOFED_CLAUDE: "false", PROOFED_CODEX: "false", ...env,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const action of ["created", "edited"]) {
  test(`${action} comments require the sender's write permission`, () => {
    for (const permission of ["read", "triage", "none", "maintain", "", 403, 404, 500]) {
      const result = run(comment(action), permission);
      assert.match(result, /^mode=none$/m, String(permission));
      assert.match(result, /\/collaborators\/reader\/permission/);
      assert.doesNotMatch(result, /\/pulls\/7|reactions/);
      if (typeof permission === "number") assert.match(result, /Couldn't check reader's repository permission/);
      if (action === "created") assert.match(result, /"body":"Only people with write access to this repository can run \/proofed\."/);
      else assert.doesNotMatch(result, /"method":"POST"/);
    }
    for (const permission of ["admin", "write"]) {
      assert.match(run(comment(action), permission), new RegExp(`^mode=${action === "edited" ? "fix" : "check"}$`, "m"));
    }
  });
}

test("permission checks fail closed without a sender or when the refusal reply fails", () => {
  assert.match(run({ ...comment(), sender: undefined }, "write"), /^mode=none$/m);
  assert.match(run(comment(), "read", true), /^mode=none$/m);
  assert.match(run(comment("created", "/proofed fix"), "read"), /^mode=none$/m);
});

test("pull request events and unrelated comments need no permission lookup", () => {
  const push = run({ action: "opened", pull_request: pr, sender: { login: "reader" } }, "read");
  assert.match(push, /^mode=check$/m);
  assert.doesNotMatch(push, /\/permission/);
  const unrelated = run(comment("created", "Looks good"), "write");
  assert.match(unrelated, /^mode=none$/m);
  assert.doesNotMatch(unrelated, /\/permission/);
});


test("mode resolves Codex aliases, provider variables and effort before installing", () => {
  const configured = { PROOFED_VARS: JSON.stringify({PROOFED_PROVIDER:"codex",PROOFED_MODEL:"gpt-6.1-terra",PROOFED_EFFORT:"ultra",PROOFED_AUTOFIX:"true"}), PROOFED_CODEX:"true" };
  const check = run({action:"opened",pull_request:pr,sender:{type:"User",login:"writer"}},"write",false,configured);
  assert.match(check, /^provider=codex$/m);
  assert.match(check, /^model=gpt-6.1-terra$/m);
  assert.match(check, /^effort=ultra$/m);
  assert.match(check, /^autofix=true$/m);
  const missing = run({action:"opened",pull_request:pr},"write",false,{...configured,PROOFED_CODEX:"false",PROOFED_CLAUDE:"true"});
  assert.match(missing, /^autofix=false$/m);
  const command = run(comment("created","/proofed fix sol high"),"write",false,{});
  assert.match(command, /^mode=fix$/m);
  assert.match(command, /^provider=codex$/m);
  assert.match(command, /^model=gpt-6.1-sol$/m);
  assert.match(command, /^effort=high$/m);
  const provider = run(comment("created","/proofed fix codex"),"write",false,{});
  assert.match(provider, /^model=gpt-6.1-sol$/m);
  const invalid = run(comment("created","/proofed fix ultra"),"write",false,{});
  assert.match(invalid, /^mode=none$/m);
  assert.match(invalid, /doesn't support/);
});
