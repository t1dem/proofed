import { checkedWhere, fixRefusal, targetScenarios } from "./fixtarget.ts";
import { configuredFixer } from "./agent.ts";
import { fixSetup } from "./fixsetup.ts";
import { providerOf } from "./models.ts";
// Shared by the PR check (cli.ts) and the fix loop (fix.ts).
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { clipUrl, editComment, listReports, minimize, postComment, publishClips, setStatus, type Repo } from "./github.ts";
import { live } from "./live.ts";
import { log } from "./log.ts";
import { crashResult, findCrashes } from "./precheck.ts";
import { buildReport, outdated, postsNew, type ClipLinks, type FixNote, type ReportData, type Written } from "./report.ts";
import { descriptionCheckNote } from "./requests.ts";
import { runScenario } from "./run.ts";
import { creditsOf, scenarioDoubted } from "./runresult.ts";
import { FAILED_CHECK_ACTION, FAILED_CHECK_REASON, RUN_FILE, type RunFile } from "./runfile.ts";
import type { Scenario } from "./scenarios.ts";
import { SetupError } from "./setuperror.ts";
import { timedAsync } from "./timing.ts";
import type { RunEvent, ScenarioResult } from "./types.ts";

type RunAllOptions = {
  baseUrl?: string;
  headless?: boolean;
  noRetry?: boolean;
  onEvent?: (event: RunEvent) => void;
  grouped?: boolean;
};

export function runConcurrency(env: NodeJS.ProcessEnv, explicit?: number) {
  const configured = env.PROOFED_CONCURRENCY?.trim();
  const concurrency = explicit ?? (configured ? Number(configured) : 3);
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    const setting = explicit === undefined ? "PROOFED_CONCURRENCY" : "Concurrency";
    throw new SetupError("concurrency_invalid", `${setting} must be a whole number of 1 or more.`, "Set PROOFED_CONCURRENCY to a positive integer or pass --concurrency.");
  }
  return concurrency;
}

// Web scenarios get their own Chrome and run side by side; native and desktop checks run serially.
// A start page that crashes while loading fails its scenarios without Kane (see precheck.ts).
export async function runAll(scenarios: Scenario[], outDir: string, requestedConcurrency?: number, o: RunAllOptions = {}) {
  const concurrency = runConcurrency(process.env, requestedConcurrency);
  scenarios = targetScenarios(scenarios);
  const baseUrl = o.baseUrl ?? process.env.PROOFED_URL ?? "";
  const web = scenarios.filter((s) => s.resolvedTarget!.kind === "web");
  if (web.length && !baseUrl) throw new Error("Missing PROOFED_URL for web scenarios");
  if (!o.grouped && scenarios.some((s) => s.resolvedTarget!.kind !== "web")) {
    const groups = new Map<string, Scenario[]>();
    for (const s of scenarios) {
      const key = s.resolvedTarget!.kind;
      groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    const results: ScenarioResult[] = [];
    for (const [kind, group] of groups) results.push(...await runAll(group, outDir, kind === "web" ? concurrency : 1, { ...o, grouped: true }));
    return scenarios.map((s) => results.find((r) => r.scenario.id === s.id)!);
  }
  const emit = o.onEvent ?? (() => {});
  for (const s of scenarios) emit({ type: "waiting", id: s.id });
  const urlOf = (s: Scenario) => new URL(s.url, baseUrl).href;
  live.track(scenarios);
  const checking = Date.now();
  const crashes = await findCrashes([...new Set(web.map(urlOf))], outDir);
  const checkSeconds = Math.round((Date.now() - checking) / 1000);
  const results: ScenarioResult[] = new Array(scenarios.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < scenarios.length; i = next++) {
      const scenario = scenarios[i]!;
      const crash = scenario.resolvedTarget!.kind === "web" ? crashes.get(urlOf(scenario)) : undefined;
      if (crash) {
        log(`✗ ${scenario.name}: ${urlOf(scenario)} crashed while loading (${crash.error}); Kane not run`);
        const result = { ...crashResult(scenario, crash), seconds: checkSeconds };
        results[i] = result;
        live.scenario(scenario.id, { status: result.outcome });
        emit({ type: "finished", id: scenario.id, result });
        continue;
      }
      log(`▶ ${scenario.name}`);
      emit({ type: "started", id: scenario.id });
      const started = Date.now();
      const kind = scenario.resolvedTarget!.kind;
      const mobile = kind === "ios" || kind === "android";
      // Mobile runs have no browser recorder to publish their status and Kane steps.
      if (mobile) live.scenario(scenario.id, { status: "running", steps: [], startedAt: started });
      const result = await runScenario(scenario, {
        baseUrl,
        outDir,
        username: process.env.LT_USERNAME,
        accessKey: process.env.LT_ACCESS_KEY,
        headless: o.headless,
        noRetry: o.noRetry,
        onEvent: mobile ? (event) => {
          if (event.type === "step") live.step(event.id, event.step);
          if (event.type === "retry") live.scenario(event.id, { steps: [], startedAt: Date.now() });
          emit(event);
        } : o.onEvent,
      });
      const timed = { ...result, seconds: Math.round((Date.now() - started) / 1000) };
      results[i] = timed;
      live.scenario(scenario.id, { status: result.outcome });
      emit({ type: "finished", id: scenario.id, result: timed });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, scenarios.length) }, worker));
  return results;
}

export const isBroken = (r: ScenarioResult) => !descriptionCheckNote(r) && (r.outcome === "failed" || r.outcome === "error");

// Posts the report as a new comment or edits the current one (postsNew). A new one retires the reports
// before it: folded as outdated and left without anything that reads as the report. Neither step can
// fail the run; the newest report is the one everything reads.
export async function putReport(repo: Repo, pr: number, body: string, notify: boolean) {
  const { current, older } = await listReports(repo, pr);
  if (current && !postsNew(current.body, body, notify)) return editComment(repo, current.id, body);
  const posted = await postComment(repo, pr, body);
  for (const old of current ? [...older, current] : older) {
    await editComment(repo, old.id, outdated(old.body ?? "")).catch((e: unknown) => console.log(`Couldn't retire the old report: ${e instanceof Error ? e.message : e}`));
    await minimize(repo, old.node_id).catch((e: unknown) => console.log(`Couldn't fold the old report: ${e instanceof Error ? e.message : e}`));
  }
  return posted;
}

type PublishInput = {
  repo: Repo | undefined;
  pr: number | undefined;
  sha: string;
  results: ScenarioResult[];
  skipped: string[];
  runUrl: string | undefined;
  outDir: string;
  fix?: FixNote;
  asked?: Scenario[];
  previous?: ReportData;
  written?: Written;
  // A person asked for this run (a /proofed comment, or Run again on the dashboard).
  requested?: boolean;
};

// The dashboard's copy of the run. Steps are capped like the comment's, so the file stays small.
// The dashboard counts the same scenarios as the comment.
export function runFile({ sha, results, skipped, runUrl, fix }: PublishInput, clips: Map<string, ClipLinks>): RunFile {
  return {
    sha,
    runUrl,
    skipped,
    scenarios: results.filter((r) => !descriptionCheckNote(r)).map((r) => ({
      id: r.scenario.id,
      name: r.scenario.name,
      outcome: r.outcome,
      reason: scenarioDoubted(r) ? `${r.end?.reason ?? ""} ${FAILED_CHECK_REASON} ${FAILED_CHECK_ACTION}` : (r.outcome === "passed" ? r.end?.summary || r.end?.reason : r.end?.reason || r.error) || undefined,
      ...(scenarioDoubted(r) && { failedCheck: "scenario_doubted" as const }),
      diagnosis: scenarioDoubted(r) ? `Kane's opinion: ${r.end?.verdict?.root_cause ?? ""}` : r.outcome === "passed" ? undefined : r.end?.verdict?.root_cause,
      suggestion: scenarioDoubted(r) ? FAILED_CHECK_ACTION : r.end?.verdict?.suggestion,
      steps: r.steps
        .filter((s) => s.status !== "running" && s.remark)
        .slice(-30)
        .map((s) => ({ remark: s.remark.slice(0, 200), ...(s.status === "failed" && { failed: true }), ...(s.at !== undefined && { at: s.at }) })),
      clip: clips.get(r.scenario.id),
      credits: r.end?.credits_consumed === undefined ? undefined : creditsOf(r),
      creditsSource: "kane_estimate",
      accountBalance: r.accountBalance,
      seconds: r.seconds,
    })),
    fix: fix && {
      status: fix.status,
      model: fix.model,
      effort: fix.effort,
      summary: fix.summary,
      commit: fix.commit,
      attempts: fix.tries,
      files: fix.changes?.map(({ file, added, removed }) => ({ path: file, added, removed })),
    },
  };
}

export function publish(input: PublishInput) {
  return timedAsync("publish", () => publishRun(input));
}

async function publishRun(input: PublishInput) {
  const { repo, pr, sha, results, skipped, runUrl, outDir, fix, asked, previous, written, requested = false } = input;
  const clips = new Map<string, ClipLinks>();
  let runKey: string | undefined;
  if (repo && pr) {
    const prefix = `pr-${pr}/${sha.slice(0, 7)}-${process.env.GITHUB_RUN_ID ?? "local"}`;
    const files = results.flatMap(({ scenario: { id }, clip }) => {
      if (!clip) return [];
      const file = (kind: keyof ClipLinks, local: string) => ({ id, kind, path: `${prefix}/${id}.${kind}`, local });
      // A crash's screenshot comes without a video.
      return [...(clip.mp4 ? [file("gif", clip.gif), file("mp4", clip.mp4)] : []), file("jpg", clip.jpg)];
    });
    for (const f of files) clips.set(f.id, { ...clips.get(f.id), [f.kind]: clipUrl(repo, f.path) });
    // Links use the final branch paths, so the clips and their index can be committed together.
    const local = join(outDir, RUN_FILE);
    writeFileSync(local, JSON.stringify(runFile(input, clips)));
    await publishClips(repo, [...files, { path: `${prefix}/${RUN_FILE}`, local }]);
    runKey = prefix;
  }

  const repoUrl = repo && `https://github.com/${repo.owner}/${repo.name}`;
  const fixer = configuredFixer();
  const counted = results.filter((r) => !descriptionCheckNote(r));
  const refusal = process.env.PROOFED_FIX === "false" ? undefined : fixRefusal(counted.filter((r) => !r.requestUnavailable).map((r) => r.scenario), process.env.PROOFED_BUILD);
  const body = buildReport({
    sha, results, skipped, clips, runUrl, fixEnabled: process.env.PROOFED_FIX !== "false", fixer, fix, asked, previous, repoUrl, runKey, written,
    fixSetup: refusal ? { note: refusal, comment: false } : fixSetup(providerOf(fixer.model)),
  });
  writeFileSync(join(outDir, "report.md"), body);
  writeFileSync(join(outDir, "results.json"), JSON.stringify(results, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, body);

  const broken = results.filter(isBroken);
  const failed = counted.filter((r) => r.outcome === "failed");
  const passed = counted.filter((r) => r.outcome === "passed");
  if (repo && pr) {
    // The end of a fix is news too, either way it went.
    const comment = await putReport(repo, pr, body, requested || !!fix);
    const names = (rs: ScenarioResult[]) => rs.map((r) => r.scenario.name).join(", ");
    // Unsure runs don't block a merge, but they aren't passes either.
    const [state, description] =
      failed.length > 0
        ? (["failure", `${failed.length} of ${counted.length} broke: ${names(failed)}`] as const)
        : broken.length > 0
          ? (["error", `Kane couldn't finish: ${names(broken)}`] as const)
          : passed.length < counted.length
            ? (["success", `${passed.length} passed, ${counted.length - passed.length} not checked`] as const)
            : counted.length === 0
              ? (["success", "No scenarios to report"] as const)
              : (["success", `${counted.length} scenario(s) pass ${checkedWhere(counted.map((r) => r.scenario))}`] as const);
    await setStatus(repo, sha, state, failed.length && refusal ? refusal : description, comment.html_url);
  }
  return broken;
}
