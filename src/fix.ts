// "Fix with Claude": someone ticked the box in the Proofed comment, or commented "/proofed fix [model]".
// Claude Code gets the failure, Kane's steps and the PR diff; we rebuild, re-run the broken scenarios
// in Chrome, and only push a fix that Kane has seen pass. Up to three attempts, each one told why the last one failed.
import { execFileSync, execSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { findReport, setStatus, upsertComment } from "./github.ts";
import { DEFAULT_FIXER, describeFixer, type Fixer } from "./models.ts";
import { changedFiles, ctx, env, pickScenarios, publish, readEvent, runAll } from "./pipeline.ts";
import { fixRequested, FIX_BOX, readReportData, type FailureData, type FixAttempt } from "./report.ts";
import { nothingAsked } from "./requests.ts";
import type { ScenarioResult } from "./run.ts";
import type { Scenario } from "./scenarios.ts";

const MAX_ATTEMPTS = 3;

type CommentEvent = { action: string; comment: { body: string }; issue: { number: number; pull_request?: object } };
const event = readEvent<CommentEvent>();
const { repo, runUrl, outDir } = ctx();
const prNumber = event.issue?.number;
// A ticked box arrives as an edit of the report itself; "/proofed fix" as a new comment next to it.
const fromCommand = event.action === "created";
const report = fromCommand && repo && prNumber ? await findReport(repo, prNumber) : undefined;
const body = (fromCommand ? report?.body : event.comment?.body) ?? "";
const data = readReportData(body);
if (!prNumber || !event.issue?.pull_request || !data || (!fromCommand && !fixRequested(body))) {
  console.log("No fix requested.");
  process.exit(0);
}
// The app's folder when it isn't the repo root. Claude and git work from the root; build and serve run there.
const appDir = env("PROOFED_DIR", ".");
const sh = (word: string) => (/^[\w./-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`);
// Claude Code allows a compound command only if each part of it is allowed on its own, so it refused
// `cd site && pnpm build`. Wrapped in a script, any build is one simple command, allowed exactly as is.
const buildScript = join(process.env.RUNNER_TEMP || tmpdir(), "proofed-build.sh");
writeFileSync(buildScript, `set -e -o pipefail\ncd ${sh(resolve(appDir))}\n${env("PROOFED_BUILD")}\n`);
const buildCommand = `bash ${sh(buildScript)}`;
const fixer: Fixer = {
  model: env("PROOFED_CLAUDE_MODEL", DEFAULT_FIXER.model),
  effort: env("PROOFED_CLAUDE_EFFORT", DEFAULT_FIXER.effort),
};

mkdirSync(outDir, { recursive: true });
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
const base = env("PROOFED_BASE_SHA");
const branch = env("PROOFED_HEAD_REF");
// Where scenarios come from when the PR's branch has none (opened before Proofed was added).
const rev = process.env.PROOFED_BASE_REF ? `origin/${process.env.PROOFED_BASE_REF}` : base;
const asked = data.asked ?? [];
const scenariosFor = (ids: string[]) => [
  ...pickScenarios({ only: ids, rev }).selected,
  ...asked.filter((s) => ids.includes(s.id)),
];

const BOX = new RegExp(`- \\[[ x]\\] \\*\\*${FIX_BOX}\\*\\*.*`);
// Puts a line where the checkbox is, or under the headline when there's none (Claude gave up last time).
const withLine = (text: string, line: string) =>
  BOX.test(text) ? text.replace(BOX, line) : text.replace(/(### Proofed\n\n[^\n]*\n)/, `$1\n${line}\n`);

if (repo) {
  await upsertComment(repo, prNumber, withLine(body, `⏳ **Claude is working on a fix** with ${describeFixer(fixer)}. [Follow along](${runUrl})`));
  await setStatus(repo, git("rev-parse", "HEAD"), "pending", "Claude is fixing, Kane will re-check", runUrl);
}

function prompt(failures: FailureData[], feedback: string) {
  const diff = git("diff", `${base}...HEAD`).slice(0, 40_000);
  // A failure without steps is a page that crashed while loading: Kane never ran (see precheck.ts).
  const described = failures
    .map(
      (f) => `### Scenario "${f.name}" (${f.file || "asked for on the PR"})
Objective checked in Chrome:
${f.objective}

What went wrong: ${f.reason}
${f.diagnosis ? `Diagnosis: ${f.diagnosis}\n` : ""}${f.steps.length ? `\nKane's steps:\n${f.steps.join("\n")}` : ""}`,
    )
    .join("\n\n");

  return `This pull request broke a user flow. Proofed checked the scenarios below in a real Chrome (with Kane CLI, an AI browser agent) against this branch, and they failed.

${described}

The pull request changes this (git diff ${base.slice(0, 7)}...HEAD):
\`\`\`diff
${diff}
\`\`\`
${feedback ? `\nA previous fix attempt didn't work:\n${feedback}\n` : ""}
Find the cause in the application code and fix it with the smallest change that keeps what the PR set out to do.
Don't edit anything under .proofed/, don't change the scenario expectations, and don't commit.
You may run \`${buildCommand}\` to check that your change builds (it runs \`${env("PROOFED_BUILD")}\` ${appDir === "." ? "at the repo root" : `in \`${appDir}\``}).
End your answer with one line in English that starts with "SUMMARY:". It goes into the pull request as is, so it says only what was wrong in the code and what you changed, nothing about tools, builds, tests or permissions.`;
}

type ClaudeResult = { result?: string; is_error?: boolean; api_error_status?: number };

function askClaude(text: string) {
  const run = spawnSync(
    "claude",
    ["-p", text, "--output-format", "json", "--permission-mode", "acceptEdits", "--max-turns", "40",
      "--model", fixer.model, "--effort", fixer.effort,
      "--allowedTools", `Read,Edit,Write,Glob,Grep,Bash(git diff:*),Bash(git log:*),Bash(git show:*),Bash(${buildCommand})`],
    { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 },
  );
  let parsed: ClaudeResult = {};
  try {
    parsed = JSON.parse(run.stdout);
  } catch {
    // No JSON at all: Claude Code itself failed to start.
  }
  const result = parsed.result?.trim() ?? "";
  // Usage limits and API errors come back as is_error with the message in `result`.
  if (parsed.api_error_status === 404) {
    return { ok: false as const, message: `the model \`${fixer.model}\` isn't available to this Claude account` };
  }
  if (run.status !== 0 || parsed.is_error) return { ok: false as const, message: result || run.stderr.trim() || "Claude Code failed" };
  const summary = /^SUMMARY:\s*(.+)$/m.exec(result)?.[1] ?? result.split("\n").at(-1) ?? "";
  return { ok: true as const, summary: summary.trim() };
}

// Claude couldn't run at all: put the original report back, untick the box, and say why.
async function restoreReport(note: string) {
  if (!repo || !prNumber) return;
  const box = `- [ ] **${FIX_BOX}**`;
  const original = body.replace(`- [x] **${FIX_BOX}**`, box);
  const quoted = `> ${note}`;
  await upsertComment(repo, prNumber, original.includes(box) ? original.replace(box, `${quoted}\n\n${box}`) : withLine(original, quoted));
  await setStatus(repo, git("rev-parse", "HEAD"), "failure", "Fix didn't run; the original failure stands", runUrl);
}

// Pushed with the job's GITHUB_TOKEN, Claude's commit leaves every workflow on it (the repo's own CI
// too) waiting for someone to approve it; an app's push doesn't. Proofed's server trades this job's
// OIDC token for a token of the Proofed app that can only push to this repository. A workflow without
// `id-token: write` gets no OIDC token, and the fix is pushed as it always was.
async function appToken() {
  const { ACTIONS_ID_TOKEN_REQUEST_URL: url, ACTIONS_ID_TOKEN_REQUEST_TOKEN: bearer, PROOFED_SERVER: server } = process.env;
  if (!url || !bearer || !server) {
    console.log(`${url && bearer ? "No Proofed server set" : "The workflow has no `id-token: write`"}: pushing with the job's token, so GitHub holds the workflows on the fix for approval.`);
    return undefined;
  }
  try {
    const request = new URL(url);
    request.searchParams.set("audience", "proofed");
    const oidc = await fetch(request, { headers: { authorization: `bearer ${bearer}` } });
    const { value } = oidc.ok ? ((await oidc.json()) as { value?: string }) : {};
    if (!value) throw new Error(`GitHub gave no OIDC token (${oidc.status})`);
    console.log(`::add-mask::${value}`);
    const res = await fetch(new URL("/api/actions/token", server), { method: "POST", headers: { authorization: `Bearer ${value}` } });
    const { token } = res.ok ? ((await res.json()) as { token?: string }) : {};
    if (!token) throw new Error(`${server} answered ${res.status}`);
    console.log(`::add-mask::${token}`);
    return token;
  } catch (e) {
    console.log(`Couldn't get the Proofed app's token (${e instanceof Error ? e.message : e}): pushing with the job's token.`);
    return undefined;
  }
}

// actions/checkout leaves the job's token in the repo's git config as an auth header for github.com,
// and git would send it instead of any other credentials. Config from the environment is read last:
// the empty value clears that header and the next one replaces it. The token stays out of the command
// line, so a failed push can't print it.
function push(token?: string) {
  const args = ["push", "origin", `HEAD:${branch}`];
  if (!token) return void git(...args);
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  console.log(`::add-mask::${basic}`);
  const header = "http.https://github.com/.extraheader";
  execFileSync("git", args, {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: header,
      GIT_CONFIG_VALUE_0: "",
      GIT_CONFIG_KEY_1: header,
      GIT_CONFIG_VALUE_1: `AUTHORIZATION: basic ${basic}`,
    },
  });
}

async function serve() {
  const proc = spawn(env("PROOFED_SERVE"), { shell: true, detached: true, stdio: "ignore", cwd: appDir });
  // detached + negative pid kills the whole process group, not just the shell.
  const stop = () => {
    try {
      if (proc.pid) process.kill(-proc.pid);
    } catch {
      // Already gone.
    }
  };
  const url = env("PROOFED_URL");
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(url)).ok) return stop;
    } catch {
      // Still starting.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  stop();
  throw new Error(`App didn't come up at ${url}`);
}

// A fix counts only when Kane saw the scenario pass; an unsure run hasn't shown anything. A PR
// description that names nothing to check isn't a failure and can't be fixed, so it never holds a fix back.
const settled = (r: ScenarioResult) => r.outcome === "passed" || nothingAsked(r);
const notPassing = (results: ScenarioResult[]) =>
  results
    .filter((r) => !settled(r))
    .map((r) =>
      r.outcome === "unsure"
        ? `"${r.scenario.name}" wasn't confirmed: ${r.end?.reason}`
        : `"${r.scenario.name}" still fails: ${r.end?.reason ?? r.error}${r.pageError ? ` Browser console: ${r.pageError}` : ""}`,
    );
const describe = (results: ScenarioResult[]) => notPassing(results).map((line) => `- ${line}`).join("\n");

let failures = data.failures;
let feedback = "";
let summary = "";
let lastResults: ScenarioResult[] = [];
const tries: FixAttempt[] = [];
let fixed = false;
let attempt = 0;

while (!fixed && attempt < MAX_ATTEMPTS) {
  attempt++;
  console.log(`\n=== Attempt ${attempt}: asking ${fixer.model} (${fixer.effort}) about ${failures.map((f) => f.name).join(", ")}`);
  const answer = askClaude(prompt(failures, feedback));
  if (!answer.ok) {
    console.log(`Claude Code couldn't run: ${answer.message}`);
    git("checkout", "--", ".");
    await restoreReport(`Claude Code couldn't run: ${answer.message}. Tick the box, or comment \`/proofed fix\` with a model, to try again.`);
    process.exit(1);
  }
  summary = answer.summary;
  console.log(`Claude: ${summary}`);

  if (!git("status", "--porcelain")) {
    feedback = "You made no changes to the code.";
    tries.push({ summary, result: "No change to the code." });
    continue;
  }
  try {
    execSync(buildCommand, { stdio: "pipe" });
  } catch (e) {
    const output = e instanceof Error && "stdout" in e && "stderr" in e ? `${e.stdout}${e.stderr}` : String(e);
    feedback = `Your change didn't build:\n${output.slice(-3000)}`;
    tries.push({ summary, result: "It didn't build." });
    continue;
  }

  const stop = await serve();
  try {
    lastResults = await runAll(scenariosFor(failures.map((f) => f.id)), `${outDir}/attempt-${attempt}`);
  } finally {
    stop();
  }
  fixed = lastResults.some((r) => r.outcome === "passed") && lastResults.every(settled);
  tries.push({ summary, result: fixed ? "Kane saw it pass." : notPassing(lastResults).join("; ") });
  if (!fixed) {
    feedback = `Your change was: ${summary}\nThe scenarios were checked again in Chrome:\n${describe(lastResults)}`;
    failures = data.failures.filter((f) => lastResults.some((r) => r.scenario.id === f.id && !settled(r)));
  }
}

if (!fixed) {
  git("checkout", "--", ".");
  // Kane never got to re-run anything (no change, or it didn't build): keep the original report.
  if (lastResults.length === 0) {
    await restoreReport(`Claude tried ${attempt} times without a change that builds. Last note: ${feedback.split("\n")[0]}`);
    process.exit(1);
  }
  await publish({
    repo, pr: prNumber, sha: git("rev-parse", "HEAD"), results: lastResults, skipped: [], runUrl, outDir, asked, previous: data,
    fix: { status: "gave-up", attempts: attempt, summary, ...fixer, tries },
  });
  process.exit(1);
}

// What `commit -a` is about to commit, for "What changed" in the report.
const changes = git("diff", "--numstat", "HEAD").split("\n").filter(Boolean).map((line) => {
  const [added = "", removed = "", file = ""] = line.split("\t");
  return { file, added: Number(added) || 0, removed: Number(removed) || 0 };
});
const names = data.failures.map((f) => f.name).join(", ");
git("-c", "user.name=Claude", "-c", "user.email=noreply@anthropic.com", "commit", "-am",
  `Fix ${names}\n\n${summary}\n\nWritten by Claude Code from a Proofed report; Kane re-ran the scenario in Chrome and it passes.\n\nFixed-by: ${fixer.model} (${fixer.effort} effort)`);
const token = await appToken();
try {
  push(token);
} catch (e) {
  if (!token) throw e;
  console.log(`Pushing as the Proofed app failed (${e instanceof Error ? e.message.split("\n")[0] : e}): pushing with the job's token.`);
  push();
}
const sha = git("rev-parse", "HEAD");
console.log(`Pushed ${sha} to ${branch}${token ? " as the Proofed app" : ""}`);

// The fix passed the scenarios that broke; now everything this PR touches has to pass on the new commit.
// What the last attempt ran is already known for this tree, unless the commit left something out
// (a new file git doesn't track yet); only the rest goes to Kane.
const picked = pickScenarios({ changed: changedFiles(base, sha), rev });
const final: Scenario[] = [...picked.selected, ...asked];
const known = new Map(git("status", "--porcelain") ? [] : lastResults.map((r) => [r.scenario.id, r]));
const missing = final.filter((s) => !known.has(s.id));
console.log(`Final check: ${final.length - missing.length} result(s) from the last attempt, ${missing.length} to run.`);
let ran: ScenarioResult[] = [];
if (missing.length > 0) {
  const stop = await serve();
  try {
    ran = await runAll(missing, `${outDir}/final`);
  } finally {
    stop();
  }
}
const results = final.map((s) => known.get(s.id) ?? ran.find((r) => r.scenario.id === s.id)!);
const skipped = picked.skipped;
const repoUrl = repo && `https://github.com/${repo.owner}/${repo.name}`;
// The app's push has started a check of this commit, which skips Kane when the report is already
// about it (mode.ts). It waits for this job to end, since the workflow's concurrency doesn't let that
// push cancel a run, so the report published here is there by the time it looks.
const broken = await publish({
  repo, pr: prNumber, sha, results, skipped, runUrl, outDir, asked, previous: data,
  fix: {
    status: "fixed", attempts: attempt, summary, ...fixer, tries, changes,
    commit: sha, commitUrl: repoUrl ? `${repoUrl}/commit/${sha}` : undefined,
  },
});
process.exitCode = broken.length > 0 ? 1 : 0;
