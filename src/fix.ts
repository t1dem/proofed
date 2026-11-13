// "Fix with Claude": someone ticked the box in the Proofed comment. Claude Code gets the failure,
// Kane's steps and the PR diff; we rebuild, re-run the broken scenarios in Chrome, and only push
// a fix that Kane has seen pass. Up to three attempts, each one told why the last one failed.
import { execFileSync, execSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { setStatus, upsertComment } from "./github.ts";
import { changedFiles, ctx, env, isBroken, pickScenarios, publish, readEvent, runAll } from "./pipeline.ts";
import { fixRequested, FIX_BOX, readReportData, type FailureData } from "./report.ts";
import type { ScenarioResult } from "./run.ts";

const MAX_ATTEMPTS = 3;

type CommentEvent = { comment: { body: string }; issue: { number: number; pull_request?: object } };
const event = readEvent<CommentEvent>();
const body = event.comment?.body ?? "";
const prNumber = event.issue?.number;
const data = readReportData(body);
if (!prNumber || !event.issue?.pull_request || !data || !fixRequested(body)) {
  console.log("No fix requested.");
  process.exit(0);
}

const { repo, runUrl, outDir } = ctx();
mkdirSync(outDir, { recursive: true });
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
const base = env("PROOFED_BASE_SHA");
const branch = env("PROOFED_HEAD_REF");

if (repo) {
  await upsertComment(repo, prNumber, body.replace(new RegExp(`- \\[x\\] \\*\\*${FIX_BOX}\\*\\*.*`), `⏳ **Claude is working on a fix.** [Follow along](${runUrl})`));
  await setStatus(repo, git("rev-parse", "HEAD"), "pending", "Claude is fixing, Kane will re-check", runUrl);
}

function prompt(failures: FailureData[], feedback: string) {
  const diff = git("diff", `${base}...HEAD`).slice(0, 40_000);
  const described = failures
    .map(
      (f) => `### Scenario "${f.name}" (${f.file})
Objective Kane ran in Chrome:
${f.objective}

What Kane saw: ${f.reason}
${f.diagnosis ? `Kane's diagnosis: ${f.diagnosis}\n` : ""}
Kane's steps:
${f.steps.join("\n")}`,
    )
    .join("\n\n");

  return `This pull request broke a user flow. Proofed ran the scenarios below in a real Chrome with Kane CLI against this branch, and they failed.

${described}

The pull request changes this (git diff ${base.slice(0, 7)}...HEAD):
\`\`\`diff
${diff}
\`\`\`
${feedback ? `\nA previous fix attempt didn't work:\n${feedback}\n` : ""}
Find the cause in the application code and fix it with the smallest change that keeps what the PR set out to do.
Don't edit anything under .proofed/, don't change the scenario expectations, and don't commit.
You may run \`${env("PROOFED_BUILD")}\` to check that your change builds.
End your answer with one line in English that starts with "SUMMARY:" and says what was wrong and what you changed.`;
}

type ClaudeResult = { result?: string; is_error?: boolean };

function askClaude(text: string) {
  const run = spawnSync(
    "claude",
    ["-p", text, "--output-format", "json", "--permission-mode", "acceptEdits", "--max-turns", "40",
      "--model", env("PROOFED_CLAUDE_MODEL", "claude-haiku-5-5"), "--effort", env("PROOFED_CLAUDE_EFFORT", "xhigh"),
      "--allowedTools", `Read,Edit,Write,Glob,Grep,Bash(git diff:*),Bash(git log:*),Bash(git show:*),Bash(${env("PROOFED_BUILD")})`],
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
  if (run.status !== 0 || parsed.is_error) return { ok: false as const, message: result || run.stderr.trim() || "Claude Code failed" };
  const summary = /^SUMMARY:\s*(.+)$/m.exec(result)?.[1] ?? result.split("\n").at(-1) ?? "";
  return { ok: true as const, summary: summary.trim() };
}

// Claude couldn't run at all: put the original report back, untick the box, and say why.
async function restoreReport(note: string) {
  if (!repo || !prNumber) return;
  const original = body.replace(`- [x] **${FIX_BOX}**`, `- [ ] **${FIX_BOX}**`);
  await upsertComment(repo, prNumber, original.replace(`- [ ] **${FIX_BOX}**`, `> ${note}\n\n- [ ] **${FIX_BOX}**`));
  await setStatus(repo, git("rev-parse", "HEAD"), "failure", "Fix didn't run; the original failure stands", runUrl);
}

async function serve() {
  const proc = spawn(env("PROOFED_SERVE"), { shell: true, detached: true, stdio: "ignore" });
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

const describe = (results: ScenarioResult[]) =>
  results.filter(isBroken).map((r) => `- "${r.scenario.name}" still fails: ${r.end?.reason ?? r.error}`).join("\n");

let failures = data.failures;
let feedback = "";
let summary = "";
let lastResults: ScenarioResult[] = [];
let fixed = false;
let attempt = 0;

while (!fixed && attempt < MAX_ATTEMPTS) {
  attempt++;
  console.log(`\n=== Attempt ${attempt}: asking Claude about ${failures.map((f) => f.name).join(", ")}`);
  const answer = askClaude(prompt(failures, feedback));
  if (!answer.ok) {
    console.log(`Claude Code couldn't run: ${answer.message}`);
    git("checkout", "--", ".");
    await restoreReport(`Claude Code couldn't run: ${answer.message}. Tick the box again to retry.`);
    process.exit(1);
  }
  summary = answer.summary;
  console.log(`Claude: ${summary}`);

  if (!git("status", "--porcelain")) {
    feedback = "You made no changes to the code.";
    continue;
  }
  try {
    execSync(env("PROOFED_BUILD"), { stdio: "pipe" });
  } catch (e) {
    const output = e instanceof Error && "stdout" in e && "stderr" in e ? `${e.stdout}${e.stderr}` : String(e);
    feedback = `Your change didn't build:\n${output.slice(-3000)}`;
    continue;
  }

  const stop = await serve();
  try {
    const { selected } = pickScenarios({ only: failures.map((f) => f.id) });
    lastResults = await runAll(selected, `${outDir}/attempt-${attempt}`);
  } finally {
    stop();
  }
  fixed = !lastResults.some(isBroken);
  if (!fixed) {
    feedback = `Your change was: ${summary}\nKane re-ran the scenarios in Chrome:\n${describe(lastResults)}`;
    failures = data.failures.filter((f) => lastResults.some((r) => r.scenario.id === f.id && isBroken(r)));
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
    repo, pr: prNumber, sha: git("rev-parse", "HEAD"), results: lastResults, skipped: [], runUrl, outDir,
    fix: { status: "gave-up", attempts: attempt, summary },
  });
  process.exit(1);
}

const names = data.failures.map((f) => f.name).join(", ");
git("-c", "user.name=Claude", "-c", "user.email=noreply@anthropic.com", "commit", "-am",
  `Fix ${names}\n\n${summary}\n\nWritten by Claude Code from a Proofed report; Kane re-ran the scenario in Chrome and it passes.`);
git("push", "origin", `HEAD:${branch}`);
const sha = git("rev-parse", "HEAD");
console.log(`Pushed ${sha} to ${branch}`);

// The fix passed the scenarios that broke; now run everything this PR touches on the new commit.
const stop = await serve();
let results: ScenarioResult[];
let skipped: string[];
try {
  const picked = pickScenarios({ changed: changedFiles(base, sha) });
  skipped = picked.skipped;
  results = await runAll(picked.selected, `${outDir}/final`);
} finally {
  stop();
}
const repoUrl = repo && `https://github.com/${repo.owner}/${repo.name}`;
const broken = await publish({
  repo, pr: prNumber, sha, results, skipped, runUrl, outDir,
  fix: { status: "fixed", attempts: attempt, summary, commit: sha, commitUrl: repoUrl ? `${repoUrl}/commit/${sha}` : undefined },
});
process.exitCode = broken.length > 0 ? 1 : 0;
