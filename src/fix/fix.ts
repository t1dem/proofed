// A report checkbox, /proofed fix, or an automatic fix starts this job. Only a tree Kane checked can be pushed.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { configuredFixer } from "./agent.ts";
import { changedFiles } from "../changes.ts";
import { env } from "../env.ts";
import { fixLoop, settled, type FixLoopEnd } from "./fixloop.ts";
import { askFixer, fixPrompt } from "./fixprompt.ts";
import { gaveUpReport } from "./fixreport.ts";
import { checkFix, checkedWhere, fixRefusal, needsWeb, targetScenarios } from "./fixtarget.ts";
import { changesLfsFiles, diffPaths, discardLeak, fileStates, fixChanges, git, ignoredTrackedPaths, LFS_REFUSAL, prepareBuild, stageCheckedFiles, stagedFilesMatch, treeBeforeCheck, untrackedPaths } from "./fixworkspace.ts";
import { ctx, editComment, findReport, readEvent, setStatus, type Comment } from "../github.ts";
import { putBack } from "./guard.ts";
import { live } from "../report/live.ts";
import { COMMENT_LIMIT } from "../report/reportdata.ts";
import { describeFixer, providerLabel, providerOf, type Fixer } from "./models.ts";
import { publish, putReport, runAll } from "../check/pipeline.ts";
import { pushHead } from "./push.ts";
import { FIX_BOX_LINE, fixRequested, readReportData, readRunKey, sameFixRequest, WORKING, type FileChange, type FixNote, type ReportData } from "../report/report.ts";
import { avoidFileId, descriptionCheckNote, isDescriptionScenario, replayAskedScenario } from "../action/requests.ts";
import { affectedBy, pickScenarios, type Scenario } from "../scenarios.ts";
import { maskSecrets } from "../secrets.ts";
import { targetChecks } from "../targets/targetchecks.ts";
import { timedAsync } from "../timing.ts";
import type { ScenarioResult } from "../types.ts";

type CommentEvent = { action: string; comment: { id: number; body: string }; issue: { number: number; pull_request?: object } };
type FixRequest = ReturnType<typeof ctx> & {
  pr: number;
  report: Comment | undefined;
  body: string;
  data: ReportData;
};
type FixReport = FixRequest & {
  brokenSha: string;
  provider: ReturnType<typeof providerLabel>;
};
type FixContext = FixReport & {
  fixer: Fixer;
  agentName: string;
};
type Restore = {
  kind: "restore";
  request: FixReport;
  log?: string;
  repost?: boolean;
  status?: string | null;
  code?: 0 | 1;
} & ({ note: string; attempt?: never } | { attempt: { fix: FixNote; passing: string[] }; note?: never });
type FixOutcome =
  | { kind: "skip"; note: string }
  | Restore
  | { kind: "pushed"; input: Parameters<typeof publish>[0]; originalStatus?: { sha: string; description: string } };
type Phase<T> = { value: T } | { outcome: FixOutcome };

// Puts a line where the checkbox is, or under the headline when there's none.
const withLine = (text: string, line: string) =>
  FIX_BOX_LINE.test(text) ? text.replace(FIX_BOX_LINE, () => line) : text.replace(/(### Proofed\n\n[^\n]*\n)/, (_, headline: string) => `${headline}\n${line}\n`);
const uniqueScenarios = (scenarios: Scenario[]) => [...new Map(scenarios.map((s) => [s.id, s])).values()];

async function loadRequest(): Promise<FixRequest | undefined> {
  const event = readEvent<CommentEvent>();
  const context = ctx();
  const auto = process.env.PROOFED_AUTO === "true";
  const pr = auto ? Number(process.env.PROOFED_NUMBER) || undefined : event.issue?.number;
  const ticked = !auto && event.action !== "created";
  const report = context.repo && pr ? await findReport(context.repo, pr) : undefined;
  const body = (ticked ? event.comment?.body : report?.body) ?? "";
  const data = readReportData(body);
  // A new check can update the same comment while this checkbox event is waiting.
  const replaced = ticked && !!context.repo && (report?.id !== event.comment?.id || !sameFixRequest(report?.body, body));
  if (!pr || !(auto || event.issue?.pull_request) || !data?.failures.length || (ticked && !fixRequested(body)) || replaced) return undefined;
  return { ...context, pr, report, body, data };
}

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

type FixPlan = FixContext & {
  appDir: string;
  base: string;
  branch: string;
  rev: string;
  checkedFiles: Scenario[];
  failedFiles: Scenario[];
  asked: Scenario[];
  failures: ReportData["failures"];
  unverified: ScenarioResult[];
};

async function validateRequest(request: FixContext): Promise<Phase<FixPlan>> {
  const { data, brokenSha, outDir } = request;
  if (data.sha !== brokenSha) {
    // The new commit's own check is usually already running.
    const note = "This report is for an older commit. Proofed checks new commits on its own; comment `/proofed` only if no check is running.";
    return { outcome: { kind: "restore", request, note, log: note, status: null, code: 0 } };
  }
  // Older reports may count a best-effort description check as a failure.
  const fixable = (f: ReportData["failures"][number]) => !(isDescriptionScenario(f) && f.failedCheck === "scenario_doubted");
  if (!data.failures.some(fixable)) return { outcome: { kind: "skip", note: "No fix requested. Kane couldn't verify what the PR description asks." } };

  const appDir = env("PROOFED_DIR", ".");
  mkdirSync(outDir, { recursive: true });
  if (!existsSync(join(outDir, ".gitignore"))) writeFileSync(join(outDir, ".gitignore"), "*\n");
  const base = env("PROOFED_BASE_SHA");
  const branch = env("PROOFED_HEAD_REF");
  // Fall back to the base for scenarios when the PR branch has none.
  const rev = process.env.PROOFED_BASE_REF ? `origin/${process.env.PROOFED_BASE_REF}` : base;
  const allFiles = pickScenarios({ rev }).selected;
  const checkedFiles = affectedBy(allFiles, changedFiles(base));
  // Older reports may already share an ID with a file selected for the fix.
  const originalFailures = data.failures.map((f) => avoidFileId(f, allFiles));
  const reported = originalFailures.filter(fixable);
  const failedIds = reported.filter((f) => f.file).map((f) => f.id);
  const failedFiles = failedIds.length ? pickScenarios({ only: failedIds, rev }).selected : [];
  const refusal = await checkSetup(targetScenarios(uniqueScenarios([...checkedFiles, ...failedFiles])));
  if (refusal) return { outcome: { kind: "restore", request, note: refusal, log: refusal, status: refusal } };

  const asked: Scenario[] = [];
  for (const request of data.asked ?? []) {
    const stored = avoidFileId(request, allFiles);
    if (reported.length !== data.failures.length && isDescriptionScenario(stored)) continue;
    const rebuilt = replayAskedScenario(stored);
    const failure = reported.find((f) => !f.file && f.id === stored.id);
    if (!rebuilt || (failure?.objective && failure.objective !== rebuilt.objective)) continue;
    const targeted = targetScenarios([rebuilt]);
    if (!targeted.length) continue;
    const reason = await checkSetup(targeted);
    if (reason) console.log(reason);
    else asked.push(rebuilt);
  }
  const failures = reported.filter((f) => f.file || asked.some((s) => s.id === f.id));
  if (!failures.length) {
    const note = "Fix didn't run: Proofed couldn't re-run the failed request.";
    return { outcome: { kind: "restore", request, note, log: note, status: note } };
  }
  const unverified: ScenarioResult[] = reported.filter((f) => !failures.includes(f)).map((f) => ({
    scenario: { id: f.id, name: f.name, file: "", paths: [], url: "/", objective: f.objective },
    outcome: "unsure",
    requestUnavailable: true,
    error: `Proofed couldn't re-run this request during the fix. The previous check failed: ${f.reason}`,
    steps: [],
    end: undefined,
    clip: undefined,
  }));
  return { value: { ...request, data: { ...data, failures: originalFailures }, appDir, base, branch, rev, checkedFiles, failedFiles, asked, failures, unverified } };
}

function scenariosFor({ failedFiles, asked }: FixPlan, ids: string[]) {
  return targetScenarios([...failedFiles, ...asked].filter((s) => ids.includes(s.id)));
}

async function markFixing(plan: FixPlan) {
  const { repo, report, body, fixer, provider, runUrl, brokenSha, pr, failures } = plan;
  if (repo && report) {
    const current = await findReport(repo, pr);
    if (current?.id !== report.id || !sameFixRequest(current.body, body)) return false;
    const working = withLine(body, `${WORKING.replace("Claude", provider)} with ${describeFixer(fixer)}. [Follow along](${runUrl})`);
    if (working.length <= COMMENT_LIMIT) await editComment(repo, report.id, working);
    await setStatus(repo, brokenSha, "pending", `${provider} is fixing, Kane will re-check`, runUrl);
  }
  live.start({ kind: "fix", pr, sha: brokenSha, runUrl });
  live.track(scenariosFor(plan, failures.map((f) => f.id)));
  return true;
}

function forgetMissingChanges(agentTouched: Set<string>, changed: { has(file: string): boolean }) {
  for (const file of agentTouched) if (!changed.has(file)) agentTouched.delete(file);
}

async function runAttempts(plan: FixPlan, app: ReturnType<typeof prepareBuild>) {
  const { fixer, data, failures, checkedFiles, base, appDir, agentName, rev, outDir } = plan;
  const { build, buildCommand, buildInput, serve } = app;
  const agentTouched = new Set<string>();
  let beforeAnswer = new Map<string, string>();
  let lastAttemptTree: string | undefined;
  const loop = await fixLoop({
    fixer,
    failures,
    previouslyFailed: data.failures.map((f) => f.id),
    open: data.open ?? data.failures.map((f) => f.id),
    checked: checkedFiles.map((s) => s.id),
    ask: (failures, feedback) => {
      beforeAnswer = fileStates();
      forgetMissingChanges(agentTouched, beforeAnswer);
      const diff = git("diff", `${base}...HEAD`).slice(0, 40_000);
      const scenarios = scenariosFor(plan, failures.map((f) => f.id));
      const answer = askFixer(fixPrompt({ failures, feedback, diff, scenarios, base, appDir, buildCommand, buildInput }), fixer, buildCommand);
      const leak = discardLeak(agentName);
      return leak ? { ok: false, message: leak } : answer;
    },
    putBack: () => {
      const undone = putBack(env("PROOFED_SCENARIOS", ".proofed/scenarios"));
      // A retry starts with files left by the previous build.
      const afterAnswer = fileStates();
      forgetMissingChanges(agentTouched, afterAnswer);
      for (const [file, state] of afterAnswer) {
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
    scenariosFor: (ids) => scenariosFor(plan, ids),
    check: (scenarios, attempt) => {
      const refusal = fixRefusal(scenarios, process.env.PROOFED_BUILD);
      if (refusal) throw new Error(refusal);
      lastAttemptTree = treeBeforeCheck();
      return checkFix(scenarios, serve, (selected) => runAll(selected, `${outDir}/attempt-${attempt}`));
    },
  });
  return { loop, lastAttemptTree, agentTouched };
}

function stopAfterAttempts(plan: FixPlan, loop: FixLoopEnd): FixOutcome {
  const { attempt, summary, tries, feedback } = loop;
  const { provider, agentName, fixer } = plan;
  git("checkout", "--", ".");
  const restore = { kind: "restore", request: plan } as const;
  if (loop.status === "no-claude") {
    const log = `${agentName} couldn't run: ${feedback}`;
    return { ...restore, log, note: `${log}. Tick the box, or comment \`/proofed fix\` with a model, to try again.` };
  }
  if (loop.results.length === 0) {
    const reason = loop.failureStage === "check" ? "without a completed check of the rebuild" : "without a change that builds";
    return { ...restore, repost: true, note: `${provider} tried ${attempt} times ${reason}. Last note: ${feedback.split("\n")[0]}` };
  }
  if (loop.fixing.length === plan.failures.length && loop.fixing.every(settled) && loop.broke.length > 0) {
    const names = (results: ScenarioResult[]) => results.map((r) => `"${r.scenario.name}"`).join(", ");
    return {
      ...restore, repost: true,
      note: `${provider} tried ${attempt} times. The last fix Kane checked made ${names(loop.fixing)} pass but broke ${names(loop.broke)}, so nothing was pushed.`,
      status: `${provider}'s fix broke another scenario; nothing was pushed`,
    };
  }
  return {
    ...restore, repost: true, status: "The original failures stand. Nothing was pushed.",
    attempt: {
      fix: { status: "gave-up", attempts: attempt, summary, ...fixer, tries },
      passing: loop.fixing.filter((r) => r.outcome === "passed").map((r) => r.scenario.name),
    },
  };
}

type VerifiedFix = {
  results: ScenarioResult[];
  final: Scenario[];
  skipped: string[];
  verified: ScenarioResult[];
  finalFixed: ScenarioResult[];
  files: string;
};

async function verifyTree(
  plan: FixPlan, { build, serve }: ReturnType<typeof prepareBuild>, { loop, lastAttemptTree, agentTouched }: Awaited<ReturnType<typeof runAttempts>>,
): Promise<Phase<VerifiedFix>> {
  const { base, rev, failedFiles, asked, outDir, data, failures, agentName } = plan;
  const refuse = (note: string, status: string): Phase<VerifiedFix> => {
    git("checkout", "--", ".");
    return { outcome: { kind: "restore", request: plan, note, status, repost: true } };
  };
  // Reuse the last attempt only when both the files and the build are still current.
  const pickFinal = () => {
    const allFiles = pickScenarios({ rev }).selected;
    const selected = affectedBy(allFiles, [...new Set([...changedFiles(base), ...fixChanges()])]);
    const final = targetScenarios(uniqueScenarios([...selected, ...failedFiles, ...asked]));
    const included = new Set([...selected, ...final.filter((s) => s.file)].map((s) => s.id));
    return { final, skipped: allFiles.filter((s) => !included.has(s.id)).map((s) => s.name) };
  };
  let final: Scenario[];
  let skipped: string[];
  let verifiedFiles: string;
  let results: ScenarioResult[];
  try {
    ({ final, skipped } = pickFinal());
    const checkSupported = () => {
      const refusal = fixRefusal(final, process.env.PROOFED_BUILD);
      if (refusal) throw new Error(refusal);
    };
    checkSupported();
    verifiedFiles = treeBeforeCheck();
    let byId = new Map(loop.results.map((r) => [r.scenario.id, r]));
    const canReuse = lastAttemptTree === verifiedFiles && final.every((s) => byId.has(s.id));
    if (!canReuse) {
      forgetMissingChanges(agentTouched, new Set(fixChanges()));
      const buildError = build();
      if (buildError !== undefined) throw new Error(buildError);
      verifiedFiles = treeBeforeCheck();
      ({ final, skipped } = pickFinal());
      checkSupported();
    }
    console.log(`Final check: ${canReuse ? final.length : 0} result(s) from the last attempt, ${canReuse ? 0 : final.length} to run.`);
    if (!canReuse) {
      live.fix({ doing: "checking" });
      const checked = await checkFix(final, serve, (selected) => runAll(selected, `${outDir}/final`));
      byId = new Map(checked.filter(Boolean).map((r) => [r.scenario.id, r]));
    }
    results = final.map((s) => {
      const result = byId.get(s.id);
      if (!result) throw new Error(`Kane returned no result for "${s.name}"`);
      return result;
    });
    if (treeBeforeCheck() !== verifiedFiles) {
      return refuse("The files changed during Kane's final check. Nothing was pushed.", "The changed files weren't checked; nothing was pushed");
    }
  } catch (e) {
    return refuse(`The final check couldn't run: ${maskSecrets(String(e))}. Nothing was pushed.`, "The final check couldn't run; nothing was pushed");
  }
  const fixedIds = new Set(failures.map((f) => f.id));
  const finalFixed = results.filter((r) => fixedIds.has(r.scenario.id));
  const previouslyFailed = new Set(data.failures.map((f) => f.id));
  const regressed = results.filter((r) => r.outcome === "failed" && !descriptionCheckNote(r) && !previouslyFailed.has(r.scenario.id));
  const verified = finalFixed.filter((r) => r.outcome === "passed");
  if (!verified.length || finalFixed.length !== fixedIds.size || !finalFixed.every(settled) || regressed.length) {
    return refuse("Kane couldn't confirm the fix in the final check. Nothing was pushed.", "The final check didn't pass; nothing was pushed");
  }
  const leak = discardLeak(agentName);
  if (leak) {
    return { outcome: {
      kind: "restore", request: plan, log: leak, note: `${leak}; nothing was pushed.`, repost: true, status: "The fix contained a credential; nothing was pushed",
    } };
  }
  return { value: { results, final, skipped, verified, finalFixed, files: verifiedFiles } };
}

type CommittedFix = { names: string; changes: FileChange[] };

function commitFix(plan: FixPlan, verified: VerifiedFix, { loop, agentTouched }: Awaited<ReturnType<typeof runAttempts>>): Phase<CommittedFix> {
  const { provider, agentName, fixer } = plan;
  const { summary, attempt, tries } = loop;
  const restore = { kind: "restore", request: plan, repost: true } as const;
  const changed = {
    ...restore, note: "The commit changed after Kane checked it. Nothing was pushed.",
    status: "The committed tree wasn't checked; nothing was pushed",
  };
  if (treeBeforeCheck() !== verified.files) return { outcome: changed };
  stageCheckedFiles(agentTouched);
  if (changesLfsFiles(diffPaths("--cached", "--diff-filter=AMT"), true)) {
    return { outcome: { ...restore, note: LFS_REFUSAL, status: "The fix changed Git LFS files. Nothing was pushed." } };
  }
  if (untrackedPaths().length) {
    return { outcome: {
      ...restore, note: "Kane checked the fix with untracked build outputs that would be left out of the commit. Nothing was pushed.",
      status: "The staged tree wasn't checked. Nothing was pushed.",
    } };
  }
  if (treeBeforeCheck() !== verified.files || !stagedFilesMatch()) return { outcome: changed };
  if (!diffPaths("--cached").length) {
    return { outcome: { ...restore, note: `${provider} tried ${attempt} times without a change that builds. Last note: You made no changes to the code.` } };
  }
  const changes = git("diff", "--cached", "--numstat").split("\n").filter(Boolean).map((line) => {
    const [added = "", removed = "", file = ""] = line.split("\t");
    return { file, added: Number(added) || 0, removed: Number(removed) || 0 };
  });
  const names = verified.verified.map((r) => r.scenario.name).join(", ");
  live.fix({ doing: "pushing", tries: [...tries] });
  const checkedTree = git("write-tree");
  // Hooks can fail or rewrite files after Kane checked the tree.
  git("-c", `user.name=${provider}`, "-c", `user.email=${provider === "Codex" ? "codex@openai.com" : "noreply@anthropic.com"}`, "commit", "--no-verify", "-m",
    `Fix ${names}\n\n${summary}\n\nWritten by ${agentName} from a Proofed report; Kane re-ran the scenarios ${checkedWhere(verified.final)} and the fix passes.\n\nFixed-by: ${fixer.model} (${fixer.effort} effort)`);
  if (git("rev-parse", "HEAD^{tree}") !== checkedTree || git("status", "--porcelain", "--untracked-files=all", "--ignore-submodules=none")) {
    return { outcome: changed };
  }
  return { value: { changes, names } };
}

async function pushFix(plan: FixPlan, verified: VerifiedFix, committed: CommittedFix, loop: FixLoopEnd): Promise<FixOutcome> {
  const { branch, repo, report, pr, runUrl, outDir, asked, data, fixer, unverified, brokenSha } = plan;
  const { results, skipped, finalFixed } = verified;
  const { names, changes } = committed;
  const sha = git("rev-parse", "HEAD");
  let asApp: boolean;
  try {
    asApp = await timedAsync("push", () => pushHead(branch));
  } catch (e) {
    // Keep remote URLs and other git output out of the report and status.
    const note = "Proofed couldn't push the fix to the branch.";
    return { kind: "restore", request: plan, note, status: note, log: `${note} ${maskSecrets(e instanceof Error ? e.message : String(e))}` };
  }
  console.log(`Pushed ${sha} to ${branch}${asApp ? " as the Proofed app" : ""}`);
  const description = unverified.length || finalFixed.some(descriptionCheckNote)
    ? `${names} fixed in ${sha.slice(0, 7)}; a request wasn't verified`
    : `${names} broke here; fixed in ${sha.slice(0, 7)}`;
  const repoUrl = repo && `https://github.com/${repo.owner}/${repo.name}`;
  return {
    kind: "pushed",
    originalStatus: repo && report ? { sha: brokenSha, description } : undefined,
    input: {
      repo, pr, sha, results: [...results, ...unverified], skipped, runUrl, outDir, asked, previous: data,
      fix: {
        status: "fixed", attempts: loop.attempt, summary: loop.summary, ...fixer, tries: loop.tries, changes,
        commit: sha, commitUrl: repoUrl ? `${repoUrl}/commit/${sha}` : undefined,
      },
    },
  };
}

async function executeFix(plan: FixPlan): Promise<FixOutcome> {
  const app = prepareBuild(plan.appDir);
  try {
    if (!(await markFixing(plan))) return { kind: "skip", note: "A newer report has replaced the one this fix was requested for." };
    const attempt = await runAttempts(plan, app);
    if (attempt.loop.status !== "fixed") return stopAfterAttempts(plan, attempt.loop);
    const verification = await verifyTree(plan, app, attempt);
    if ("outcome" in verification) return verification.outcome;
    const verified = verification.value;
    let commit: Phase<CommittedFix>;
    try {
      commit = commitFix(plan, verified, attempt);
    } catch (e) {
      const note = "Proofed couldn't commit the fix. Nothing was pushed.";
      const diagnostic = e instanceof Error ? e.message : String(e);
      return { kind: "restore", request: plan, note, status: note, log: `${note} ${maskSecrets(diagnostic)}` };
    }
    if ("outcome" in commit) return commit.outcome;
    return await pushFix(plan, verified, commit.value, attempt.loop);
  } finally {
    try {
      app.cleanup();
    } catch (e) {
      console.log(`Couldn't remove the fix build script. ${maskSecrets(String(e))}`);
    }
  }
}

export async function runFix(): Promise<FixOutcome> {
  const request = await loadRequest();
  if (!request) return { kind: "skip", note: "No fix requested." };
  let provider: FixReport["provider"] = FIX_BOX_LINE.exec(request.body)?.[0].includes("Fix with Codex") ? "Codex" : "Claude";
  try {
    const brokenSha = git("rev-parse", "HEAD");
    const fixer = configuredFixer();
    provider = providerLabel(providerOf(fixer.model));
    const validation = await validateRequest({ ...request, brokenSha, fixer, provider, agentName: provider === "Codex" ? "Codex" : "Claude Code" });
    return "outcome" in validation ? validation.outcome : await executeFix(validation.value);
  } catch (e) {
    const note = "Proofed couldn't finish the fix. See the workflow logs and try again.";
    const diagnostic = e instanceof Error ? e.stack ?? e.message : String(e);
    return { kind: "restore", request: { ...request, brokenSha: request.data.sha, provider }, note, status: note, log: `${note} ${maskSecrets(diagnostic)}` };
  }
}

async function finalize(outcome: FixOutcome): Promise<number> {
  switch (outcome.kind) {
    case "skip":
      console.log(outcome.note);
      return 0;
    case "restore": {
      if (outcome.log) console.log(outcome.log);
      await live.end();
      const { repo, pr, report, brokenSha, body, provider, runUrl } = outcome.request;
      let restored: string;
      if (outcome.attempt) {
        restored = await gaveUpReport(outcome.request, outcome.attempt.fix, outcome.attempt.passing);
      } else {
        const box = `- [ ] **Fix with ${provider}**`;
        const original = body.replace(/- \[x\] \*\*Fix with (?:Claude|Codex)\*\*/, box);
        const quoted = `> ${outcome.note}`;
        restored = original.includes(box) ? original.replace(box, () => `${quoted}\n\n${box}`) : withLine(original, quoted);
        if (restored.length > COMMENT_LIMIT) restored = original;
      }
      if (repo && report) {
        try {
          const current = await findReport(repo, pr);
          // The working line may have changed, while a newer run changes the report data or archive.
          if (current?.id === report.id && current.body && readRunKey(current.body) === readRunKey(body) &&
              isDeepStrictEqual(readReportData(current.body), readReportData(body))) {
            await (outcome.repost ? putReport(repo, pr, restored, true) : editComment(repo, report.id, restored));
          }
        } finally {
          const status = outcome.status === undefined ? "Fix didn't run; the original failure stands" : outcome.status;
          if (status !== null) await setStatus(repo, brokenSha, "failure", status, runUrl);
        }
      }
      return outcome.code ?? 1;
    }
    case "pushed": {
      const { repo, runUrl } = outcome.input;
      if (repo && outcome.originalStatus) {
        const { sha, description } = outcome.originalStatus;
        await setStatus(repo, sha, "failure", description, runUrl).catch(() => {});
      }
      await live.end();
      const broken = await publish(outcome.input);
      return broken.length > 0 ? 1 : 0;
    }
  }
}

if (import.meta.main) process.exitCode = await finalize(await runFix());
