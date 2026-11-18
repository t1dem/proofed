import { checkFix, checkedWhere, fixRefusal, needsWeb, targetScenarios } from "./fixtarget.ts";
import { findGitBash, killTree } from "./process.ts";
// "Fix with Claude": someone ticked the box in the Proofed comment, or commented "/proofed fix [model]".
// The agent gets the failure, Kane's steps and the PR diff; we rebuild, re-run the broken scenarios
// on their targets, and only push a fix that Kane has seen pass. Up to three attempts, each one told why the last one failed.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { askAgent, configuredFixer } from "./agent.ts";
import { editComment, findReport, setStatus } from "./github.ts";
import { putBack } from "./guard.ts";
import { describeFailure } from "./fixprompt.ts";
import { live } from "./live.ts";
import { describeFixer, providerLabel, providerOf } from "./models.ts";
import { changedFiles, ctx, env, pickScenarios, publish, putReport, readEvent, runAll } from "./pipeline.ts";
import { pushHead } from "./push.ts";
import { fixLoop, settled } from "./fixloop.ts";
import { fixRequested, readReportData, WORKING, type FailureData } from "./report.ts";
import { descriptionCheckNote, isDescriptionScenario, replayAskedScenario } from "./requests.ts";
import type { ScenarioResult } from "./run.ts";
import type { Scenario } from "./scenarios.ts";
import { targetChecks } from "./targetchecks.ts";
import { fileWithSecret, maskSecrets } from "./secrets.ts";

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
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trimEnd();
const brokenSha = git("rev-parse", "HEAD");
const fixer = configuredFixer();
const provider = providerLabel(providerOf(fixer.model));
const BOX = /- \[[ x]\] \*\*Fix with (?:Claude|Codex)\*\*.*/;
// Puts a line where the checkbox is, or under the headline when there's none (the fixer gave up last time).
const withLine = (text: string, line: string) =>
  BOX.test(text) ? text.replace(BOX, line) : text.replace(/(### Proofed\n\n[^\n]*\n)/, `$1\n${line}\n`);

if (data.sha !== brokenSha) {
  const note = "This report is for a different commit. Comment `/proofed` to run a fresh check.";
  console.log(note);
  await restoreReport(note, false, null);
  process.exit(0);
}
// Reports written before description checks became best effort may still list one as a failure.
const reportedFailures = data.failures.filter((f) => !(isDescriptionScenario(f) && f.failedCheck === "scenario_doubted"));
const doubtedDescription = reportedFailures.length !== data.failures.length;
if (!reportedFailures.length) {
  console.log("No fix requested. Kane couldn't verify what the PR description asks.");
  process.exit(0);
}
// The app's folder when it isn't the repo root. The agent and git work from the root; build and serve run there.
const appDir = env("PROOFED_DIR", ".");
const sh = (word: string) => (/^[\w./-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`);
// Claude Code allows a compound command only if each part of it is allowed on its own, so it refused
// `cd site && pnpm build`. Wrapped in a script, any build is one simple command, allowed exactly as is.
const buildScript = join(process.env.RUNNER_TEMP || tmpdir(), "proofed-build.sh");
const buildCommand = `bash ${sh(buildScript.replaceAll("\\", "/"))}`;
const agentName = provider === "Codex" ? "Codex" : "Claude Code";

mkdirSync(outDir, { recursive: true });
if (!existsSync(join(outDir, ".gitignore"))) writeFileSync(join(outDir, ".gitignore"), "*\n");
const base = env("PROOFED_BASE_SHA");
const branch = env("PROOFED_HEAD_REF");
// Where scenarios come from when the PR's branch has none (opened before Proofed was added).
const rev = process.env.PROOFED_BASE_REF ? `origin/${process.env.PROOFED_BASE_REF}` : base;

async function checkSetup(scenarios: Scenario[]) {
  const refusal = fixRefusal(scenarios, process.env.PROOFED_BUILD)
    ?? (!process.env.PROOFED_BUILD?.trim() ? "Fix didn't run: set PROOFED_BUILD (the action's build input) so Kane can check the rebuild." : undefined)
    ?? (needsWeb(scenarios) && (!process.env.PROOFED_URL?.trim() || !process.env.PROOFED_SERVE?.trim()) ? "Fix didn't run: web scenarios need url and serve to check the rebuild." : undefined);
  if (refusal) return refusal;
  for (const scenario of scenarios) {
    const checks = await targetChecks(scenario.resolvedTarget!, { pendingBuild: true, launchPending: true });
    const failed = checks.filter((c) => c.status === "fail");
    if (failed.length) return `Fix didn't run: "${scenario.name}" cannot be checked. ${failed.map((c) => `${c.detail}. ${c.fix}`).join(" ")}`;
  }
}

const checkedFiles = pickScenarios({ changed: changedFiles(base), rev }).selected;
const fileIds = reportedFailures.filter((f) => f.file).map((f) => f.id);
const failedFiles = fileIds.length ? pickScenarios({ only: fileIds, rev }).selected : [];
const uniqueScenarios = (scenarios: Scenario[]) => [...new Map(scenarios.map((s) => [s.id, s])).values()];
const refusal = await checkSetup(targetScenarios(uniqueScenarios([...checkedFiles, ...failedFiles])));
if (refusal) {
  console.log(refusal);
  await restoreReport(refusal, false, refusal);
  process.exit(1);
}
const asked: Scenario[] = [];
for (const stored of data.asked ?? []) {
  if (doubtedDescription && isDescriptionScenario(stored)) continue;
  const rebuilt = replayAskedScenario(stored);
  const failure = reportedFailures.find((f) => !f.file && f.id === stored.id);
  if (!rebuilt || (failure && failure.objective !== rebuilt.objective)) continue;
  const targeted = targetScenarios([rebuilt]);
  if (!targeted.length) continue;
  const reason = await checkSetup(targeted);
  if (reason) console.log(reason);
  else asked.push(rebuilt);
}
const failures = reportedFailures.filter((f) => f.file || asked.some((s) => s.id === f.id));
const unverified: ScenarioResult[] = reportedFailures.filter((f) => !failures.includes(f)).map((f) => ({
  scenario: { id: f.id, name: f.name, file: "", paths: [], url: "/", objective: f.objective },
  outcome: "unsure",
  requestUnavailable: true,
  error: `Proofed couldn't re-run this request during the fix. The previous check failed: ${f.reason}`,
  steps: [],
  end: undefined,
  clip: undefined,
}));
if (!failures.length) {
  const note = "Fix didn't run: Proofed couldn't re-run the failed request.";
  console.log(note);
  await restoreReport(note, false, note);
  process.exit(1);
}
const scenariosFor = (ids: string[]) => targetScenarios([...failedFiles, ...asked].filter((s) => ids.includes(s.id)));
writeFileSync(buildScript, `set -e -o pipefail\ncd ${sh(resolve(appDir).replaceAll("\\", "/"))}\n${env("PROOFED_BUILD")}\n`);

if (repo && report) {
  await editComment(repo, report.id, withLine(body, `${WORKING.replace("Claude", provider)} with ${describeFixer(fixer)}. [Follow along](${runUrl})`));
  await setStatus(repo, brokenSha, "pending", `${provider} is fixing, Kane will re-check`, runUrl);
}
// The dashboard follows along: which attempt it is, what's being done, and Kane's re-check.
live.start({ kind: "fix", pr: prNumber, sha: brokenSha, runUrl });
live.track(scenariosFor(failures.map((f) => f.id)));

function prompt(failures: FailureData[], feedback: string) {
  const diff = git("diff", `${base}...HEAD`).slice(0, 40_000);
  const scenarios = scenariosFor(failures.map((f) => f.id));
  const described = failures.map((f) => describeFailure(f, scenarios.find((s) => s.id === f.id))).join("\n\n");

  return `${failures.some((f) => f.failedCheck) ? "A scenario's check did not hold on the page. Kane believes the scenario is out of date; that opinion does not establish whether the app change was intended." : "This pull request broke a user flow."} Proofed checked the scenarios below ${checkedWhere(scenarios)} with Kane CLI against this branch, and they failed.

${described}

The pull request changes this (git diff ${base.slice(0, 7)}...HEAD):
\`\`\`diff
${diff}
\`\`\`
${feedback ? `\nA previous fix attempt didn't work:\n${feedback}\n` : ""}
${failures.some((f) => f.failedCheck) ? "Kane's opinion is not proof that the scenario is wrong. If the app change was intended, stop and explain that the scenario needs review. Otherwise fix the app. Do not make a check pass by changing its expectations." : "Find the cause in the application code and fix it with the smallest change that keeps what the PR set out to do."}
Don't edit anything under .proofed/, don't change the scenario expectations, and don't commit.
Do not run commands other than reading application code and the build. Do not access the network or external services.
You may run \`${buildCommand}\` to check that your change builds (it runs \`${env("PROOFED_BUILD")}\` ${appDir === "." ? "at the repo root" : `in \`${appDir}\``}).
End your answer with one line in English that starts with "SUMMARY:". It goes into the pull request as is, so it says only what was wrong in the code and what you changed, nothing about tools, builds, tests or permissions.`;
}

function askFixer(text: string) {
  const answer = askAgent(text, {
    ...fixer,
    timeoutMs: 10 * 60_000,
    allowedTools: ["Read", "Edit", "Write", "Glob", "Grep", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)", `Bash(${buildCommand})`],
  });
  if (!answer.ok) return answer;
  const summary = /^SUMMARY:\s*(.+)$/m.exec(answer.text)?.[1] ?? answer.text.split("\n").at(-1) ?? "";
  return { ok: true as const, summary: summary.trim() };
}

// Put the original report back, untick the box, and say why. Claude not running at all is an edit;
// Claude giving up (`ended`) is the end of the fix, so the report is posted again for the notification.
async function restoreReport(note: string, ended = false, status: string | null = "Fix didn't run; the original failure stands") {
  await live.end();
  if (!repo || !prNumber || !report) return;
  const box = `- [ ] **Fix with ${provider}**`;
  const original = body.replace(/- \[x\] \*\*Fix with (?:Claude|Codex)\*\*/, box);
  const quoted = `> ${note}`;
  const restored = original.includes(box) ? original.replace(box, `${quoted}\n\n${box}`) : withLine(original, quoted);
  try {
    await (ended ? putReport(repo, prNumber, restored, true) : editComment(repo, report.id, restored));
  } finally {
    // The fix may already be committed locally while the broken commit's status is still pending.
    if (status !== null) await setStatus(repo, brokenSha, "failure", status, runUrl);
  }
}

async function serve() {
  const proc = spawn(env("PROOFED_SERVE"), { shell: true, detached: true, windowsHide: true, stdio: "ignore", cwd: appDir });
  const exited = new Promise<void>((resolve) => { proc.once("exit", () => resolve()); proc.once("error", () => resolve()); });
  const stop = async () => {
    killTree(proc.pid);
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
    killTree(proc.pid, "SIGKILL");
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
  await stop();
  throw new Error(`App didn't come up at ${url}`);
}

// What the fix has changed so far, new files included. -z: names as they are.
const diffPaths = (...args: string[]) => git("diff", "--name-only", "--no-renames", "-z", ...args).split("\0").filter(Boolean);
const untrackedPaths = () => git("ls-files", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean);
const fixChanges = () => [...diffPaths("HEAD"), ...untrackedPaths()];

// Include new files and their contents when deciding whether an in-job result still applies.
const fileStates = () => new Map(fixChanges().map((file) => {
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return [file, "deleted"] as const;
  const content = stat.isSymbolicLink() ? readlinkSync(file) : stat.isFile() ? git("hash-object", "--", file) : "";
  return [file, `${stat.mode}:${content}`] as const;
}));
const treeBeforeCheck = () => [...fileStates()].map(([file, state]) => `${file}\0${state}`).join("\0");
const agentTouched = new Set<string>();
let beforeAnswer = new Map<string, string>();
let lastAttemptTree: string | undefined;

// Ignore rules mark build output even if the project tracks it and the fixer rebuilds it.
// Include HEAD entries so staged deletions are matched too.
const ignoredTrackedPaths = () => new Set(git("ls-files", "-z", "--cached", "--ignored", "--exclude-standard", "--with-tree=HEAD").split("\0").filter(Boolean));

// Checked before the change is built, served to Kane and recorded, since clips and reports are public.
function discardLeak() {
  const leaked = fileWithSecret(fixChanges());
  if (!leaked) return undefined;
  const untracked = untrackedPaths();
  git("checkout", "--", ".");
  for (const file of untracked) rmSync(file, { force: true });
  return `${agentName}'s change put a credential of this job into ${leaked}. Proofed discarded the change`;
}

function build() {
  try {
    execFileSync(findGitBash(), [buildScript.replaceAll("\\", "/")], { stdio: "pipe", windowsHide: true });
    return undefined;
  } catch (e) {
    return e instanceof Error && "stdout" in e && "stderr" in e ? `${e.stdout}${e.stderr}` : String(e);
  }
}

const loop = await fixLoop({
  fixer,
  failures,
  open: data.open ?? data.failures.map((f) => f.id),
  checked: checkedFiles.map((s) => s.id),
  ask: (failures, feedback) => {
    beforeAnswer = fileStates();
    const answer = askFixer(prompt(failures, feedback));
    const leak = discardLeak();
    return leak ? { ok: false, message: leak } : answer;
  },
  putBack: () => {
    const undone = putBack(env("PROOFED_SCENARIOS", ".proofed/scenarios"));
    // Projects can commit their build output. A retry starts with files left by the previous build.
    for (const [file, state] of fileStates()) {
      if (state !== beforeAnswer.get(file)) agentTouched.add(file);
    }
    return undone;
  },
  hasChanges: () => {
    const ignored = ignoredTrackedPaths();
    return fixChanges().some((file) => agentTouched.has(file) && !ignored.has(file));
  },
  build,
  changedFiles: fixChanges,
  allScenarios: () => targetScenarios(pickScenarios({ rev }).selected),
  scenariosFor,
  check: (scenarios, attempt) => {
    const refusal = fixRefusal(scenarios, process.env.PROOFED_BUILD);
    if (refusal) throw new Error(refusal);
    lastAttemptTree = treeBeforeCheck();
    return checkFix(scenarios, serve, (selected) => runAll(selected, `${outDir}/attempt-${attempt}`));
  },
});
const { attempt, summary, tries, feedback } = loop;
const lastResults = loop.results;

if (loop.status === "no-claude") {
  console.log(`${agentName} couldn't run: ${feedback}`);
  git("checkout", "--", ".");
  await restoreReport(`${agentName} couldn't run: ${feedback}. Tick the box, or comment \`/proofed fix\` with a model, to try again.`);
  process.exit(1);
}

if (loop.status === "gave-up") {
  git("checkout", "--", ".");
  // Kane never got to re-run anything (no change, or it didn't build): keep the original report.
  if (lastResults.length === 0) {
    await restoreReport(`${provider} tried ${attempt} times without a change that builds. Last note: ${feedback.split("\n")[0]}`, true);
    process.exit(1);
  }
  // What the last attempt made pass, it broke elsewhere. Nothing was pushed, so the report's failures still stand.
  if (loop.fixing.every(settled)) {
    const names = (results: ScenarioResult[]) => results.map((r) => `"${r.scenario.name}"`).join(", ");
    await restoreReport(
      `${provider} tried ${attempt} times. The last fix Kane checked made ${names(loop.fixing)} pass but broke ${names(loop.broke)}, so nothing was pushed.`,
      true,
      `${provider}'s fix broke another scenario; nothing was pushed`,
    );
    process.exit(1);
  }
  await live.end();
  // Only the scenarios the report had broken: the others ran on the fixer's change, which isn't on the branch.
  await publish({
    repo, pr: prNumber, sha: git("rev-parse", "HEAD"), results: [...loop.fixing, ...unverified], skipped: [], runUrl, outDir, asked, previous: data,
    fix: { status: "gave-up", attempts: attempt, summary, ...fixer, tries },
  });
  process.exit(1);
}

// Reuse this job's last attempt on the same tree, including native results. Rebuild and check
// only missing scenarios; if the tree changed since that attempt or during the build, re-check all.
// Verification and the tree guards still finish before anything is committed or pushed.
const picked = pickScenarios({ changed: [...new Set([...changedFiles(base), ...fixChanges()])], rev });
const final = targetScenarios(uniqueScenarios([...picked.selected, ...failedFiles, ...asked]));
let verifiedFiles = treeBeforeCheck();
const known = new Map(lastAttemptTree === verifiedFiles ? lastResults.map((r) => [r.scenario.id, r]) : []);
let missing = final.filter((s) => !known.has(s.id));
let results: ScenarioResult[] = [];
try {
  const refusal = fixRefusal(final, process.env.PROOFED_BUILD);
  if (refusal) throw new Error(refusal);
  if (missing.length > 0) {
    const buildError = build();
    if (buildError !== undefined) throw new Error(buildError);
    verifiedFiles = treeBeforeCheck();
    // A build can change tracked output or add files. Those results must be checked on this tree.
    if (lastAttemptTree !== verifiedFiles) {
      known.clear();
      missing = final;
    }
  }
  console.log(`Final check: ${final.length - missing.length} result(s) from the last attempt, ${missing.length} to run.`);
  if (missing.length > 0) {
    live.fix({ doing: "checking" });
    const ran = await checkFix(missing, serve, (selected) => runAll(selected, `${outDir}/final`));
    for (const result of ran) known.set(result.scenario.id, result);
  }
  results = final.map((s) => known.get(s.id)!);
} catch (e) {
  git("checkout", "--", ".");
  await restoreReport(`The final check couldn't run: ${String(e)}. Nothing was pushed.`, true, "The final check couldn't run; nothing was pushed");
  process.exit(1);
}
const fixedIds = new Set(failures.map((f) => f.id));
const finalFixed = results.filter((r) => fixedIds.has(r.scenario.id));
const regressed = results.filter((r) => !fixedIds.has(r.scenario.id) && r.outcome === "failed" && !descriptionCheckNote(r) && !(data.open ?? []).includes(r.scenario.id));
const verified = finalFixed.filter((r) => r.outcome === "passed");
if (!verified.length || finalFixed.length !== fixedIds.size || !finalFixed.every(settled) || regressed.length) {
  git("checkout", "--", ".");
  await restoreReport("Kane couldn't confirm the fix in the final check. Nothing was pushed.", true, "The final check didn't pass; nothing was pushed");
  process.exit(1);
}
if (treeBeforeCheck() !== verifiedFiles) {
  git("checkout", "--", ".");
  await restoreReport("The files changed during Kane's final check. Nothing was pushed.", true, "The changed files weren't checked; nothing was pushed");
  process.exit(1);
}
const leak = discardLeak();
if (leak) {
  console.log(leak);
  await restoreReport(`${leak}; nothing was pushed.`, true, "The fix contained a credential; nothing was pushed");
  process.exit(1);
}
const ignored = ignoredTrackedPaths();
const shouldCommit = (file: string) => agentTouched.has(file) && !ignored.has(file);
const buildOnlyTracked = [...new Set([
  ...diffPaths("--diff-filter=a", "HEAD"),
  ...diffPaths("--cached", "--diff-filter=a", "HEAD"),
])].filter((file) => !shouldCommit(file));
if (buildOnlyTracked.length) git("--literal-pathspecs", "checkout", "HEAD", "--", ...buildOnlyTracked);
const buildOnlyAdded = diffPaths("--cached", "--diff-filter=A", "HEAD").filter((file) => !shouldCommit(file));
if (buildOnlyAdded.length) git("--literal-pathspecs", "reset", "HEAD", "--", ...buildOnlyAdded);
const trackedEdits = diffPaths().filter(shouldCommit);
const untracked = untrackedPaths();
const newFiles = untracked.filter(shouldCommit);
const buildOnlyUntracked = new Set(untracked.filter((file) => !shouldCommit(file)));
if (trackedEdits.length) git("--literal-pathspecs", "add", "-u", "--", ...trackedEdits);
if (newFiles.length) git("--literal-pathspecs", "add", "--", ...newFiles);
if (!diffPaths("--cached").length) {
  await restoreReport(`${provider} tried ${attempt} times without a change that builds. Last note: You made no changes to the code.`, true);
  process.exit(1);
}
const changes = git("diff", "--cached", "--numstat").split("\n").filter(Boolean).map((line) => {
  const [added = "", removed = "", file = ""] = line.split("\t");
  return { file, added: Number(added) || 0, removed: Number(removed) || 0 };
});
const names = verified.map((r) => r.scenario.name).join(", ");
live.fix({ doing: "pushing", tries: [...tries] });
const checkedTree = git("write-tree");
// --no-verify: the project's commit hooks (AnkiDroid's runs ktlint through Gradle) can fail or rewrite
// files after Kane checked this exact tree.
git("-c", `user.name=${provider}`, "-c", `user.email=${provider === "Codex" ? "codex@openai.com" : "noreply@anthropic.com"}`, "commit", "--no-verify", "-m",
  `Fix ${names}\n\n${summary}\n\nWritten by ${agentName} from a Proofed report; Kane re-ran the scenarios ${checkedWhere(final)} and the fix passes.\n\nFixed-by: ${fixer.model} (${fixer.effort} effort)`);
if (git("rev-parse", "HEAD^{tree}") !== checkedTree || git("status", "--porcelain", "--untracked-files=no")
  || untrackedPaths().some((file) => !buildOnlyUntracked.has(file))) {
  await restoreReport("The commit changed after Kane checked it. Nothing was pushed.", true, "The committed tree wasn't checked; nothing was pushed");
  process.exit(1);
}
let asApp: boolean;
try {
  asApp = await pushHead(branch);
} catch (e) {
  // Git errors can include remote URLs or output. Keep them out of the report and status; the log
  // keeps a masked copy so a maintainer can see why (a protected branch, a token without access).
  const note = "Proofed couldn't push the fix to the branch.";
  console.log(`${note} ${maskSecrets(e instanceof Error ? e.message : String(e))}`);
  await restoreReport(note, false, note);
  process.exit(1);
}
const sha = git("rev-parse", "HEAD");
console.log(`Pushed ${sha} to ${branch}${asApp ? " as the Proofed app" : ""}`);
// The broken commit was set to "fixing" above; without this it would stay pending for good.
if (repo && report) {
  const status = unverified.length || finalFixed.some(descriptionCheckNote)
    ? `${names} fixed in ${sha.slice(0, 7)}; a request wasn't verified`
    : `${names} broke here; fixed in ${sha.slice(0, 7)}`;
  await setStatus(repo, brokenSha, "failure", status, runUrl).catch(() => {});
}
const skipped = picked.skipped;
const repoUrl = repo && `https://github.com/${repo.owner}/${repo.name}`;
// The app's push has started a check of this commit, which skips Kane when the report is already
// about it (mode.ts). It waits for this job to end, since the workflow's concurrency doesn't let that
// push cancel a run, so the report published here is there by the time it looks.
await live.end();
const broken = await publish({
  repo, pr: prNumber, sha, results: [...results, ...unverified], skipped, runUrl, outDir, asked, previous: data,
  fix: {
    status: "fixed", attempts: attempt, summary, ...fixer, tries, changes,
    commit: sha, commitUrl: repoUrl ? `${repoUrl}/commit/${sha}` : undefined,
  },
});
process.exitCode = broken.length > 0 ? 1 : 0;
