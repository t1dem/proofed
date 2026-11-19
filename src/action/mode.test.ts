import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FIRST_ANDROID_SCENARIO, FIRST_SCENARIO, SETUP_BRANCH } from "./setup.ts";

const repository = { full_name: "owner/repo" };
const pr = {
  number: 7,
  head: { sha: "head", ref: "feature", repo: repository },
  base: { sha: "base", ref: "main", repo: repository },
};
const report = {
  id: 12, user: { type: "Bot" },
  body: '<!-- proofed -->\n- [x] **Fix with Claude**\n<!-- proofed:data {"sha":"head","failures":[{}]} -->',
};
const comment = (action = "created", body = "/proofed") => ({
  action, issue: { number: 7, pull_request: {} }, sender: { type: "User", login: "reader" },
  comment: action === "edited" ? report : { id: 13, body, user: { type: "User" }, author_association: "MEMBER" },
});

function run(event: object, permission: string | number, replyFails = false, env: Record<string, string> = {}, fetchedPr: object = pr, stock?: string) {
  const dir = mkdtempSync(join(tmpdir(), "proofed-mode-"));
  try {
    const path = join(dir, "event.json");
    const summary = join(dir, "summary.md");
    writeFileSync(path, JSON.stringify(event));
    writeFileSync(summary, "");
    const script = `
      import assert from "node:assert/strict";
      const calls = [];
      const stock = ${JSON.stringify(stock)};
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
        if (path.endsWith("/pulls/7")) return Response.json(${JSON.stringify(fetchedPr)});
        if (stock !== undefined && path.endsWith("/contents/.proofed/scenarios")) return Response.json([{ name: "home.md", type: "file" }]);
        if (stock !== undefined && path.endsWith("/contents/.proofed/scenarios/home.md")) return Response.json({ content: Buffer.from(stock).toString("base64") });
        throw new Error("Unexpected request: " + path);
      };
      await import(${JSON.stringify(new URL("./mode.ts", import.meta.url).href)});
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
      env: {
        ...process.env, GITHUB_EVENT_PATH: path, GITHUB_TOKEN: "job-token", GITHUB_REPOSITORY: "owner/repo",
        GITHUB_OUTPUT: "", GITHUB_STEP_SUMMARY: summary, PROOFED_VARS: "{}",
        PROOFED_FIX: "true", PROOFED_CLAUDE: "false", PROOFED_CODEX: "false", ...env,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout + readFileSync(summary, "utf8");
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

test("setup PRs generate scenarios for the matching stock web or cloud Android scenario", () => {
  const event = { action: "opened", pull_request: { ...pr, head: { ...pr.head, ref: SETUP_BRANCH } } };
  const web = { PROOFED_CLAUDE: "true", PROOFED_TARGET: "", PROOFED_EXECUTION: "", PROOFED_SCENARIOS: "" };
  const android = { ...web, PROOFED_TARGET: "android", PROOFED_EXECUTION: "cloud" };
  assert.match(run(event, "write", false, web, pr, FIRST_SCENARIO), /^generate=true$/m);
  assert.match(run(event, "write", false, android, pr, FIRST_ANDROID_SCENARIO), /^generate=true$/m);
  assert.match(run(event, "write", false, android, pr, FIRST_SCENARIO), /^generate=false$/m);
  assert.match(run(event, "write", false, android, pr, FIRST_ANDROID_SCENARIO.trimEnd()), /^generate=false$/m);
  assert.match(run(event, "write", false, { ...android, PROOFED_EXECUTION: "local" }, pr, FIRST_ANDROID_SCENARIO), /^generate=false$/m);
});

test("fork and deleted-head PR comments get one refusal and no checkout ref", () => {
  for (const repo of [{ full_name: "fork/repo" }, null]) {
    const fork = { ...pr, head: { ...pr.head, ref: "main", repo } };
    for (const event of [comment(), comment("created", "/proofed fix"), comment("edited")]) {
      const result = run(event, "write", false, {}, fork);
      assert.match(result, /^mode=none$/m);
      assert.doesNotMatch(result, /^head_(ref|sha)=/m);
      assert.match(result, /"method":"POST","body":\{"body":"Proofed can only run on pull requests from branches in this repository\."/);
      assert.equal(result.match(/"method":"POST"/g)?.length, 1);
    }
  }
});

test("fork pull request events skip without a comment or other API calls", () => {
  const fork = { ...pr, head: { ...pr.head, repo: { full_name: "fork/repo" } } };
  const result = run({ action: "opened", pull_request: fork }, "write");
  assert.match(result, /^mode=none$/m);
  assert.match(result, /^api=\[\]$/m);
  assert.equal(result.match(/^Proofed skipped this fork pull request because it needs repository secrets\.$/gm)?.length, 2);
});

test("fix: false refuses a checked fix box", () => {
  const result = run(comment("edited"), "write", false, { PROOFED_FIX: "false" });
  assert.match(result, /^mode=none$/m);
  assert.doesNotMatch(result, /^head_(ref|sha)=/m);
  assert.match(result, /"method":"POST","body":\{"body":"Fixing is turned off for this repository\."/);
});

test("a queued tick must still match the report data in the current comment", () => {
  const tick = comment("edited");
  const stale = { ...tick, comment: { ...report, body: report.body.replace('"head"', '"old"') } };
  const result = run(stale, "write");
  assert.match(result, /^mode=none$/m);
  assert.match(result, /A newer report has replaced the one the box was ticked in/);
  assert.match(run(tick, "write"), /^mode=fix$/m);
  const unchecked = { ...tick, comment: { ...report, body: report.body.replace("[x]", "[ ]") } };
  assert.match(run(unchecked, "write"), /^mode=none$/m);
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
  assert.match(command, /^model=gpt-6\.2-sol$/m);
  assert.match(command, /^effort=high$/m);
  const provider = run(comment("created","/proofed fix codex"),"write",false,{});
  assert.match(provider, /^model=gpt-6\.2-sol$/m);
  const invalid = run(comment("created","/proofed fix ultra"),"write",true,{});
  assert.match(invalid, /^mode=none$/m);
  assert.match(invalid, /Couldn't reply.*403/);
  assert.match(invalid, /doesn't support/);
});

test("an invalid fixer setting keeps the check and refuses only the fix", () => {
  const bad = { PROOFED_VARS: JSON.stringify({ PROOFED_MODEL: "opus", PROOFED_AUTOFIX: "true" }), PROOFED_CLAUDE: "true" };
  const check = run({ action: "opened", pull_request: pr, sender: { type: "User", login: "writer" } }, "write", false, bad);
  assert.match(check, /^mode=check$/m);
  assert.match(check, /^model=claude-haiku-5-5$/m);
  assert.match(check, /^autofix=false$/m);
  assert.match(check, /^::warning::.*opus/m);
  const tick = run(comment("edited"), "write", false, bad);
  assert.match(tick, /^mode=none$/m);
  assert.match(tick, /"method":"POST".*opus/);
});

test("an unknown provider keeps checks but disables autofix and scenario writing", () => {
  const bad = {
    PROOFED_VARS: JSON.stringify({ PROOFED_PROVIDER: "codx", PROOFED_AUTOFIX: "true" }),
    PROOFED_CLAUDE: "true", PROOFED_CODEX: "true",
  };
  for (const ref of ["fork", SETUP_BRANCH]) {
    const check = run({ action: "opened", pull_request: { ...pr, head: { ...pr.head, ref } } }, "write", false, bad);
    assert.match(check, /^mode=check$/m);
    assert.match(check, /^provider=claude$/m);
    assert.match(check, /^model=claude-haiku-5-5$/m);
    assert.match(check, /^effort=xhigh$/m);
    assert.match(check, /^autofix=false$/m);
    assert.match(check, /^generate=false$/m);
    assert.match(check, /^::warning::.*provider.*`codx`.*claude, codex/m);
    assert.doesNotMatch(check, /Couldn't read/);
    const dir = mkdtempSync(join(tmpdir(), "proofed-report-"));
    try {
      // action.yml passes mode's resolved outputs to cli.ts -> publish -> configuredFixer.
      const resolved = Object.fromEntries(["provider", "model", "effort"].map((name) =>
        [`PROOFED_${name.toUpperCase()}`, new RegExp(`^${name}=(.+)$`, "m").exec(check)![1]!]));
      const script = `
        import { publish } from ${JSON.stringify(new URL("../check/pipeline.ts", import.meta.url).href)};
        await publish({ sha: "head", results: [], skipped: [], outDir: ${JSON.stringify(dir)} });
      `;
      const published = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
        encoding: "utf8", env: { ...process.env, ...resolved, GITHUB_STEP_SUMMARY: "" },
      });
      assert.equal(published.status, 0, published.stderr);
      assert.match(readFileSync(join(dir, "report.md"), "utf8"), /### Proofed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("an unknown provider gets a reply and skips checkbox and command fix requests", () => {
  const bad = { PROOFED_VARS: JSON.stringify({ PROOFED_PROVIDER: "codx" }) };
  for (const event of [comment("edited"), comment("created", "/proofed fix")]) {
    const fix = run(event, "write", false, bad);
    assert.match(fix, /^mode=none$/m);
    assert.match(fix, /"method":"POST".*repository's variables is invalid:.*provider.*`codx`.*claude, codex/);
    assert.doesNotMatch(fix, /^provider=/m);
  }
});

test("provider variables accept case and whitespace and infer from the model when empty", () => {
  for (const provider of [undefined, "", "   ", "Codex", " codex ", " CODEX "]) {
    for (const model of [undefined, "gpt-6.1-sol"]) {
      const check = run({ action: "opened", pull_request: pr }, "write", false, {
        PROOFED_VARS: JSON.stringify({ PROOFED_PROVIDER: provider, PROOFED_MODEL: model }),
      });
      assert.match(check, /^mode=check$/m);
      if (provider?.trim() || model) {
        assert.match(check, /^provider=codex$/m);
        assert.match(check, model ? /^model=gpt-6\.1-sol$/m : /^model=gpt-6\.2-sol$/m);
      } else {
        assert.match(check, /^provider=claude$/m);
        assert.match(check, /^model=claude-haiku-5-5$/m);
      }
      assert.doesNotMatch(check, /::warning::/);
    }
  }
});
