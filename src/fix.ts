// "Fix with Claude": someone ticked the box in the Proofed comment, or commented "/proofed fix [model]".
// Claude Code gets the failure, Kane's steps and the PR diff; we rebuild, re-run the broken scenarios
// in Chrome, and only push a fix that Kane has seen pass. Up to three attempts, each one told why the last one failed.
import { execFileSync, execSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { askClaude } from "./claude.ts";
import { editComment, findReport, setStatus } from "./github.ts";
import { putBack } from "./guard.ts";
import { describeFailure } from "./fixprompt.ts";
import { live } from "./live.ts";
import { DEFAULT_FIXER, describeFixer, type Fixer } from "./models.ts";
import { changedFiles, ctx, env, pickScenarios, publish, putReport, readEvent, runAll } from "./pipeline.ts";
import { pushHead } from "./push.ts";
import { fixLoop, settled } from "./fixloop.ts";
import { fixRequested, FIX_BOX, readReportData, WORKING, type FailureData } from "./report.ts";
import type { ScenarioResult } from "./run.ts";
import type { Scenario } from "./scenarios.ts";

type CommentEvent = { action: string; comment: { id: number; body: string }; issue: { number: number; pull_request?: object } };
const event = readEvent<CommentEvent>();
const { repo, runUrl, outDir } = ctx();
// "Fix automatically" (action.yml): the check that just reported goes on here, on its push event.
const auto = process.env.PROOFED_AUTO === "true";
const prNumber = auto ? Number(process.env.PROOFED_NUMBER) || undefined : event.issue?.number;
// A ticked box arrives as an edit of the report itself; "/proofed fix" as a new comment next to it.
// Either way the fix is of the PR's current report: a box ticked on one a newer report has replaced
// since (the tick raced the new report) asks for nothing.
const fromCommand = event.action === "created";
const ticked = !auto && !fromCommand;
const report = repo && prNumber ? await findReport(repo, prNumber) : undefined;
const body = (ticked ? event.comment?.body : report?.body) ?? "";
const data = readReportData(body);
const replaced = ticked && !!repo && report?.id !== event.comment?.id;
if (!prNumber || !(auto || event.issue?.pull_request) || !data || data.failures.length === 0 || (ticked && !fixRequested(body)) || replaced) {
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

if (repo && report) {
  await editComment(repo, report.id, withLine(body, `${WORKING} with ${describeFixer(fixer)}. [Follow along](${runUrl})`));
  await setStatus(repo, git("rev-parse", "HEAD"), "pending", "Claude is fixing, Kane will re-check", runUrl);
}
// The dashboard follows along: which attempt it is, what's being done, and Kane's re-check.
live.start({ kind: "fix", pr: prNumber, sha: git("rev-parse", "HEAD"), runUrl });
live.track(scenariosFor(data.failures.map((f) => f.id)));

function prompt(failures: FailureData[], feedback: string) {
  const diff = git("diff", `${base}...HEAD`).slice(0, 40_000);
  const described = failures.map(describeFailure).join("\n\n");

  return `${failures.some((f) => f.failedCheck) ? "A scenario's check did not hold on the page. Kane believes the scenario is out of date; that opinion does not establish whether the app change was intended." : "This pull request broke a user flow."} Proofed checked the scenarios below in a real Chrome (with Kane CLI, an AI browser agent) against this branch, and they failed.

${described}

The pull request changes this (git diff ${base.slice(0, 7)}...HEAD):
\`\`\`diff
${diff}
\`\`\`
${feedback ? `\nA previous fix attempt didn't work:\n${feedback}\n` : ""}
${failures.some((f) => f.failedCheck) ? "Kane's opinion is not proof that the scenario is wrong. If the app change was intended, stop and explain that the scenario needs review. Otherwise fix the app. Do not make a check pass by changing its expectations." : "Find the cause in the application code and fix it with the smallest change that keeps what the PR set out to do."}
Don't edit anything under .proofed/, don't change the scenario expectations, and don't commit.
You may run \`${buildCommand}\` to check that your change builds (it runs \`${env("PROOFED_BUILD")}\` ${appDir === "." ? "at the repo root" : `in \`${appDir}\``}).
End your answer with one line in English that starts with "SUMMARY:". It goes into the pull request as is, so it says only what was wrong in the code and what you changed, nothing about tools, builds, tests or permissions.`;
}

function askFixer(text: string) {
  const answer = askClaude(text, {
    ...fixer,
    allowedTools: ["Read", "Edit", "Write", "Glob", "Grep", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)", `Bash(${buildCommand})`],
  });
  if (!answer.ok) return answer;
  const summary = /^SUMMARY:\s*(.+)$/m.exec(answer.text)?.[1] ?? answer.text.split("\n").at(-1) ?? "";
  return { ok: true as const, summary: summary.trim() };
}

// Put the original report back, untick the box, and say why. Claude not running at all is an edit;
// Claude giving up (`ended`) is the end of the fix, so the report is posted again for the notification.
async function restoreReport(note: string, ended = false, status = "Fix didn't run; the original failure stands") {
  await live.end();
  if (!repo || !prNumber || !report) return;
  const box = `- [ ] **${FIX_BOX}**`;
  const original = body.replace(`- [x] **${FIX_BOX}**`, box);
  const quoted = `> ${note}`;
  const restored = original.includes(box) ? original.replace(box, `${quoted}\n\n${box}`) : withLine(original, quoted);
  await (ended ? putReport(repo, prNumber, restored, true) : editComment(repo, report.id, restored));
  await setStatus(repo, git("rev-parse", "HEAD"), "failure", status, runUrl);
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

// What the fix has changed so far, new files included. -z: names as they are.
const fixChanges = () => [
  ...git("diff", "--name-only", "--no-renames", "-z", "HEAD").split("\0"),
  ...git("ls-files", "--others", "--exclude-standard", "-z").split("\0"),
].filter(Boolean);

const loop = await fixLoop({
  fixer,
  failures: data.failures,
  open: data.open ?? data.failures.map((f) => f.id),
  checked: pickScenarios({ changed: changedFiles(base), rev }).selected.map((s) => s.id),
  ask: (failures, feedback) => askFixer(prompt(failures, feedback)),
  putBack: () => putBack(env("PROOFED_SCENARIOS", ".proofed/scenarios")),
  hasChanges: () => !!git("status", "--porcelain"),
  build: () => {
    try {
      execSync(buildCommand, { stdio: "pipe" });
      return undefined;
    } catch (e) {
      return e instanceof Error && "stdout" in e && "stderr" in e ? `${e.stdout}${e.stderr}` : String(e);
    }
  },
  changedFiles: fixChanges,
  allScenarios: () => pickScenarios({ rev }).selected,
  scenariosFor,
  check: async (scenarios, attempt) => {
    const stop = await serve();
    try {
      return await runAll(scenarios, `${outDir}/attempt-${attempt}`);
    } finally {
      stop();
    }
  },
});
const { attempt, summary, tries, feedback } = loop;
const lastResults = loop.results;

if (loop.status === "no-claude") {
  console.log(`Claude Code couldn't run: ${feedback}`);
  git("checkout", "--", ".");
  await restoreReport(`Claude Code couldn't run: ${feedback}. Tick the box, or comment \`/proofed fix\` with a model, to try again.`);
  process.exit(1);
}

if (loop.status === "gave-up") {
  git("checkout", "--", ".");
  // Kane never got to re-run anything (no change, or it didn't build): keep the original report.
  if (lastResults.length === 0) {
    await restoreReport(`Claude tried ${attempt} times without a change that builds. Last note: ${feedback.split("\n")[0]}`, true);
    process.exit(1);
  }
  // What the last attempt made pass, it broke elsewhere. Nothing was pushed, so the report's failures still stand.
  if (loop.fixing.every(settled)) {
    const names = (results: ScenarioResult[]) => results.map((r) => `"${r.scenario.name}"`).join(", ");
    await restoreReport(
      `Claude tried ${attempt} times. The last fix Kane checked made ${names(loop.fixing)} pass but broke ${names(loop.broke)}, so nothing was pushed.`,
      true,
      "Claude's fix broke another scenario; nothing was pushed",
    );
    process.exit(1);
  }
  await live.end();
  // Only the scenarios the report had broken: the others ran on Claude's change, which isn't on the branch.
  await publish({
    repo, pr: prNumber, sha: git("rev-parse", "HEAD"), results: loop.fixing, skipped: [], runUrl, outDir, asked, previous: data,
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
live.fix({ doing: "pushing", tries: [...tries] });
git("-c", "user.name=Claude", "-c", "user.email=noreply@anthropic.com", "commit", "-am",
  `Fix ${names}\n\n${summary}\n\nWritten by Claude Code from a Proofed report; Kane re-ran the scenario in Chrome and it passes.\n\nFixed-by: ${fixer.model} (${fixer.effort} effort)`);
const asApp = await pushHead(branch);
const sha = git("rev-parse", "HEAD");
console.log(`Pushed ${sha} to ${branch}${asApp ? " as the Proofed app" : ""}`);

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
  live.fix({ doing: "checking" });
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
await live.end();
const broken = await publish({
  repo, pr: prNumber, sha, results, skipped, runUrl, outDir, asked, previous: data,
  fix: {
    status: "fixed", attempts: attempt, summary, ...fixer, tries, changes,
    commit: sha, commitUrl: repoUrl ? `${repoUrl}/commit/${sha}` : undefined,
  },
});
process.exitCode = broken.length > 0 ? 1 : 0;
