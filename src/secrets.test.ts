import { delimiter } from "node:path";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { askAgent } from "./agent.ts";
import { dataComment } from "./report.ts";
import { fileWithSecret, maskSecrets, secretValues } from "./secrets.ts";

const TOKEN = "ghs_proofedTestTokenNotReal0123456789";
const header = Buffer.from(`x-access-token:${TOKEN}`).toString("base64");
const root = fileURLToPath(new URL("..", import.meta.url));

function withEnv(values: Record<string, string | undefined>, run: () => void) {
  const before = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(values)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  try {
    run();
  } finally {
    for (const [k, v] of Object.entries(before)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
}

test("both action checkouts leave no token in .git/config", () => {
  for (const file of ["action.yml", "fix/action.yml"]) {
    const yml = readFileSync(join(root, file), "utf8");
    const steps = yml.split(/\n(?=\s+- )/).filter((s) => s.includes("actions/checkout"));
    assert.ok(steps.length > 0, file);
    for (const step of steps) assert.match(step, /\n\s+persist-credentials: false(\n|$)/, file);
  }
});

test("job credentials are found in written files and masked in text, raw and as a git auth header", () => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-secrets-"));
  try {
    const values = secretValues({ GITHUB_TOKEN: TOKEN, LT_USERNAME: "someone" });
    writeFileSync(join(dir, "clean.js"), "export const a = 1;\n");
    writeFileSync(join(dir, "header.txt"), `AUTHORIZATION: basic ${header}\n`);
    writeFileSync(join(dir, "raw.js"), `fetch(x, { headers: { t: "${TOKEN}" } })`);
    const files = ["clean.js", "gone.js", "header.txt", "raw.js"].map((f) => join(dir, f));
    assert.equal(fileWithSecret([files[0]!, files[1]!], values), undefined);
    assert.equal(fileWithSecret(files, values), files[2]);
    assert.equal(fileWithSecret([files[3]!], values), files[3]);
    assert.equal(maskSecrets(`SUMMARY: used ${TOKEN} and ${header}`, values), "SUMMARY: used *** and ***");
    assert.deepEqual(secretValues({}), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Claude runs without the job's tokens, keeps its own and the build's environment, and its answer is masked", () => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-fake-claude-"));
  const capture = join(dir, "env.json");
  writeFileSync(join(dir, "claude"), `#!/usr/bin/env node
    require('node:fs').writeFileSync(${JSON.stringify(capture)}, JSON.stringify(process.env));
    console.log(JSON.stringify({ result: "SUMMARY: fixed, token ${TOKEN}" }));
  `, { mode: 0o755 });
  try {
    withEnv({
      PATH: `${dir}${delimiter}${process.env.PATH}`, GITHUB_TOKEN: TOKEN, GH_TOKEN: TOKEN, LT_ACCESS_KEY: "lt-key-not-real-123",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc-request-not-real", ACTIONS_ID_TOKEN_REQUEST_URL: "https://example.invalid",
      CLAUDE_CODE_OAUTH_TOKEN: "claude-oauth-not-real", NPM_CONFIG_REGISTRY: "https://registry.example",
    }, () => {
      const answer = askAgent("fix", { model: "opus", effort: "low", allowedTools: [] });
      assert.deepEqual(answer, { ok: true, text: "SUMMARY: fixed, token ***" });
      const env = JSON.parse(readFileSync(capture, "utf8")) as Record<string, string>;
      for (const name of ["GITHUB_TOKEN", "GH_TOKEN", "LT_ACCESS_KEY", "ACTIONS_ID_TOKEN_REQUEST_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_URL"]) assert.equal(env[name], undefined, name);
      assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "claude-oauth-not-real");
      assert.equal(env.NPM_CONFIG_REGISTRY, "https://registry.example");
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("without credentials in .git/config, the push sends the job token as a header and never on the command line", { skip: process.platform === "win32" ? "The git interception fixture is a POSIX shebang executable" : false }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-fake-git-"));
  const capture = join(dir, "git.json");
  writeFileSync(join(dir, "git"), `#!/usr/bin/env node
    const keys = Object.keys(process.env).filter((k) => k.startsWith('GIT_CONFIG_'));
    require('node:fs').writeFileSync(${JSON.stringify(capture)}, JSON.stringify({ args: process.argv.slice(2), config: Object.fromEntries(keys.map((k) => [k, process.env[k]])) }));
  `, { mode: 0o755 });
  const { pushHead } = await import("./push.ts");
  const path = process.env.PATH;
  const saved = { GITHUB_TOKEN: process.env.GITHUB_TOKEN, ACTIONS_ID_TOKEN_REQUEST_URL: process.env.ACTIONS_ID_TOKEN_REQUEST_URL };
  process.env.PATH = `${dir}${delimiter}${path}`;
  process.env.GITHUB_TOKEN = TOKEN;
  delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  try {
    assert.equal(await pushHead("feature"), false);
    const called = JSON.parse(readFileSync(capture, "utf8")) as { args: string[]; config: Record<string, string> };
    assert.deepEqual(called.args, ["push", "origin", "HEAD:feature"]);
    assert.equal(called.config.GIT_CONFIG_KEY_1, "http.https://github.com/.extraheader");
    assert.equal(called.config.GIT_CONFIG_VALUE_1, `AUTHORIZATION: basic ${header}`);
  } finally {
    process.env.PATH = path;
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a fix that writes a job credential is discarded before it is built, checked or pushed", () => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-fix-leak-"));
  const bin = join(dir, "bin");
  const repo = join(dir, "repo");
  mkdirSync(bin);
  mkdirSync(join(repo, ".proofed/scenarios"), { recursive: true });
  mkdirSync(join(repo, "src"));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: repo, encoding: "utf8" }).trim();
  try {
    // A hostile or confused agent that found the token somewhere on the runner.
    writeFileSync(join(bin, "claude"), `#!/usr/bin/env node
      const fs = require('node:fs');
      fs.writeFileSync('src/app.js', 'export const t = "${TOKEN}";\\n');
      fs.writeFileSync('notes.txt', '${header}\\n');
      console.log(JSON.stringify({ result: "SUMMARY: fixed the button" }));
    `, { mode: 0o755 });
    writeFileSync(join(repo, "src/app.js"), "export const t = 1;\n");
    writeFileSync(join(repo, ".proofed/scenarios/home.md"), "---\nname: Home\nurl: /\n---\nCheck that the heading reads \"Home\".\n");
    git("init", "-q", "-b", "main");
    git("add", "-A");
    git("commit", "-qm", "base");
    const base = git("rev-parse", "HEAD");
    const failure = { id: "home", name: "Home", file: ".proofed/scenarios/home.md", objective: "Check", reason: "missing", diagnosis: "", steps: [] };
    const body = `<!-- proofed -->\n### Proofed\n\n- [x] **Fix with Claude**\n${dataComment({ sha: base, failures: [failure] })}`;
    writeFileSync(join(dir, "event.json"), JSON.stringify({ action: "edited", comment: { id: 1, body }, issue: { number: 7, pull_request: {} } }));
    const run = spawnSync(process.execPath, [join(root, "src/fix.ts")], {
      cwd: repo, encoding: "utf8", timeout: 60_000,
      env: {
        SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, USERPROFILE: process.env.USERPROFILE,
        PATH: `${bin}${delimiter}${process.env.PATH}`, HOME: process.env.HOME, GITHUB_TOKEN: TOKEN, GITHUB_EVENT_PATH: join(dir, "event.json"),
        PROOFED_OUT: join(dir, "out"), PROOFED_BUILD: `touch ${join(dir, "built")}`, PROOFED_SERVE: "true", PROOFED_URL: "http://127.0.0.1:9",
        PROOFED_BASE_SHA: base, PROOFED_HEAD_REF: "feature", PROOFED_MODEL: "claude-opus-5-5", RUNNER_TEMP: dir,
      },
    });
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stdout, /put a credential of this job into src\/app\.js\. Proofed discarded the change/);
    assert.ok(!run.stdout.includes(TOKEN) && !run.stderr.includes(TOKEN));
    assert.equal(readFileSync(join(repo, "src/app.js"), "utf8"), "export const t = 1;\n");
    assert.equal(existsSync(join(repo, "notes.txt")), false);
    assert.equal(existsSync(join(dir, "built")), false);
    assert.equal(git("rev-parse", "HEAD"), base);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
