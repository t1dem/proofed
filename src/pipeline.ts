// Shared by the PR check (cli.ts) and the fix loop (fix.ts).
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { publishClips, repoFromEnv, setStatus, upsertComment, type Repo } from "./github.ts";
import { crashResult, findCrashes } from "./precheck.ts";
import { buildReport, type ClipLinks, type FixNote, type ReportData } from "./report.ts";
import { runScenario, type ScenarioResult } from "./run.ts";
import { RUN_FILE, type RunFile } from "./runfile.ts";
import { affectedBy, loadScenariosOr, type Scenario } from "./scenarios.ts";

export const env = (name: string, fallback?: string) => {
  const value = process.env[name]?.trim() || fallback;
  if (value === undefined) throw new Error(`Missing ${name}`);
  return value;
};

export function readEvent<T>(): Partial<T> {
  return process.env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")) : {};
}

export const ctx = () => {
  const token = process.env.GITHUB_TOKEN;
  return {
    repo: token && process.env.GITHUB_REPOSITORY ? repoFromEnv(token) : undefined,
    runUrl: process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : undefined,
    outDir: env("PROOFED_OUT", ".proofed-out"),
  };
};

export const changedFiles = (base: string, head = "HEAD") =>
  execFileSync("git", ["diff", "--name-only", `${base}...${head}`], { encoding: "utf8" }).split("\n").filter(Boolean);

// The base branch as the runner sees it (origin/main), so the diff and any scenarios read from it
// are current even for a PR whose recorded base commit is weeks old. Falls back to that commit.
export function baseRev(base: { ref: string; sha: string }) {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", `origin/${base.ref}`], { stdio: "ignore" });
    return `origin/${base.ref}`;
  } catch {
    return base.sha;
  }
}

export function pickScenarios({ changed, only, rev }: { changed?: string[]; only?: string[]; rev?: string }) {
  const all = loadScenariosOr(env("PROOFED_SCENARIOS", ".proofed/scenarios"), rev);
  const selected = only?.length ? all.filter((s) => only.includes(s.id)) : changed ? affectedBy(all, changed) : all;
  return { selected, skipped: all.filter((s) => !selected.includes(s)).map((s) => s.name) };
}

// Every scenario gets its own Chrome, so they can run side by side; Kane is mostly waiting on its backend.
// A start page that crashes while loading fails its scenarios without Kane (see precheck.ts).
export async function runAll(scenarios: Scenario[], outDir: string, concurrency = Number(process.env.PROOFED_CONCURRENCY) || 3) {
  const baseUrl = env("PROOFED_URL");
  const urlOf = (s: Scenario) => new URL(s.url, baseUrl).href;
  const checking = Date.now();
  const crashes = await findCrashes([...new Set(scenarios.map(urlOf))]);
  const checkSeconds = Math.round((Date.now() - checking) / 1000);
  const results: ScenarioResult[] = new Array(scenarios.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < scenarios.length; i = next++) {
      const scenario = scenarios[i]!;
      const crash = crashes.get(urlOf(scenario));
      if (crash) {
        console.log(`✗ ${scenario.name}: ${urlOf(scenario)} crashed while loading (${crash}); Kane not run`);
        results[i] = { ...crashResult(scenario, crash), seconds: checkSeconds };
        continue;
      }
      console.log(`▶ ${scenario.name}`);
      const started = Date.now();
      const result = await runScenario(scenario, {
        baseUrl,
        outDir,
        username: process.env.LT_USERNAME,
        accessKey: process.env.LT_ACCESS_KEY,
      });
      results[i] = { ...result, seconds: Math.round((Date.now() - started) / 1000) };
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, scenarios.length) }, worker));
  return results;
}

export const isBroken = (r: ScenarioResult) => r.outcome === "failed" || r.outcome === "error";

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
};

// The dashboard's copy of the run. Steps are capped like the comment's, so the file stays small.
function runFile({ sha, results, skipped, runUrl, fix }: PublishInput, clips: Map<string, ClipLinks>): RunFile {
  return {
    sha,
    runUrl,
    skipped,
    scenarios: results.map((r) => ({
      id: r.scenario.id,
      name: r.scenario.name,
      outcome: r.outcome,
      reason: (r.outcome === "passed" ? r.end?.summary || r.end?.reason : r.end?.reason || r.error) || undefined,
      diagnosis: r.outcome === "passed" ? undefined : r.end?.verdict?.root_cause,
      suggestion: r.end?.verdict?.suggestion,
      steps: r.steps
        .filter((s) => s.status !== "running" && s.remark)
        .slice(-30)
        .map((s) => ({ remark: s.remark.slice(0, 200), ...(s.status === "failed" && { failed: true }) })),
      clip: clips.get(r.scenario.id),
      credits: r.end?.credits_consumed,
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

export async function publish(input: PublishInput) {
  const { repo, pr, sha, results, skipped, runUrl, outDir, fix, asked, previous } = input;
  const clips = new Map<string, ClipLinks>();
  let runKey: string | undefined;
  if (repo && pr) {
    const prefix = `pr-${pr}/${sha.slice(0, 7)}-${process.env.GITHUB_RUN_ID ?? "local"}`;
    const files = results.flatMap((r) =>
      r.clip
        ? [
            { id: r.scenario.id, kind: "gif" as const, path: `${prefix}/${r.scenario.id}.gif`, local: r.clip.gif },
            { id: r.scenario.id, kind: "mp4" as const, path: `${prefix}/${r.scenario.id}.mp4`, local: r.clip.mp4 },
            { id: r.scenario.id, kind: "jpg" as const, path: `${prefix}/${r.scenario.id}.jpg`, local: r.clip.jpg },
          ]
        : [],
    );
    const urls = await publishClips(repo, files);
    for (const f of files) clips.set(f.id, { ...clips.get(f.id), [f.kind]: urls.get(f.path) });
    // In a commit of its own, after the clips: the file holds their links.
    const local = join(outDir, RUN_FILE);
    writeFileSync(local, JSON.stringify(runFile(input, clips)));
    await publishClips(repo, [{ path: `${prefix}/${RUN_FILE}`, local }]);
    runKey = prefix;
  }

  const repoUrl = repo && `https://github.com/${repo.owner}/${repo.name}`;
  const body = buildReport({
    sha, results, skipped, clips, runUrl, fixEnabled: process.env.PROOFED_FIX !== "false", fix, asked, previous, repoUrl, runKey,
  });
  writeFileSync(join(outDir, "report.md"), body);
  writeFileSync(join(outDir, "results.json"), JSON.stringify(results, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, body);

  const broken = results.filter(isBroken);
  const failed = results.filter((r) => r.outcome === "failed");
  const passed = results.filter((r) => r.outcome === "passed");
  if (repo && pr) {
    const comment = await upsertComment(repo, pr, body);
    const names = (rs: ScenarioResult[]) => rs.map((r) => r.scenario.name).join(", ");
    // Unsure runs don't block a merge, but they aren't passes either.
    const [state, description] =
      failed.length > 0
        ? (["failure", `${failed.length} of ${results.length} broke: ${names(failed)}`] as const)
        : broken.length > 0
          ? (["error", `Kane couldn't finish: ${names(broken)}`] as const)
          : passed.length < results.length
            ? (["success", `${passed.length} passed, ${results.length - passed.length} not checked`] as const)
            : (["success", `${results.length} scenario(s) pass in Chrome`] as const);
    await setStatus(repo, sha, state, description, comment.html_url);
  }
  return broken;
}
