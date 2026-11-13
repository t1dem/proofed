// Shared by the PR check (cli.ts) and the fix loop (fix.ts).
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { publishClips, repoFromEnv, setStatus, upsertComment, type Repo } from "./github.ts";
import { buildReport, type ClipLinks, type FixNote } from "./report.ts";
import { runScenario, type ScenarioResult } from "./run.ts";
import { affectedBy, loadScenarios, type Scenario } from "./scenarios.ts";

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

export function pickScenarios({ changed, only }: { changed?: string[]; only?: string[] }) {
  const all = loadScenarios(env("PROOFED_SCENARIOS", ".proofed/scenarios"));
  const selected = only?.length ? all.filter((s) => only.includes(s.id)) : changed ? affectedBy(all, changed) : all;
  return { selected, skipped: all.filter((s) => !selected.includes(s)).map((s) => s.name) };
}

// Every scenario gets its own Chrome, so they can run side by side; Kane is mostly waiting on its backend.
export async function runAll(scenarios: Scenario[], outDir: string, concurrency = Number(process.env.PROOFED_CONCURRENCY) || 3) {
  const results: ScenarioResult[] = new Array(scenarios.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < scenarios.length; i = next++) {
      const scenario = scenarios[i]!;
      console.log(`▶ ${scenario.name}`);
      results[i] = await runScenario(scenario, {
        baseUrl: env("PROOFED_URL"),
        outDir,
        username: process.env.LT_USERNAME,
        accessKey: process.env.LT_ACCESS_KEY,
      });
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
};

export async function publish({ repo, pr, sha, results, skipped, runUrl, outDir, fix }: PublishInput) {
  const clips = new Map<string, ClipLinks>();
  if (repo && pr) {
    const prefix = `pr-${pr}/${sha.slice(0, 7)}-${process.env.GITHUB_RUN_ID ?? "local"}`;
    const files = results.flatMap((r) =>
      r.clip
        ? [
            { id: r.scenario.id, kind: "gif" as const, path: `${prefix}/${r.scenario.id}.gif`, local: r.clip.gif },
            { id: r.scenario.id, kind: "mp4" as const, path: `${prefix}/${r.scenario.id}.mp4`, local: r.clip.mp4 },
          ]
        : [],
    );
    const urls = await publishClips(repo, files);
    for (const f of files) clips.set(f.id, { ...clips.get(f.id), [f.kind]: urls.get(f.path) });
  }

  const body = buildReport({ sha, results, skipped, clips, runUrl, fixEnabled: process.env.PROOFED_FIX !== "false", fix });
  writeFileSync(join(outDir, "report.md"), body);
  writeFileSync(join(outDir, "results.json"), JSON.stringify(results, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, body);

  const broken = results.filter(isBroken);
  const failed = results.filter((r) => r.outcome === "failed");
  if (repo && pr) {
    const comment = await upsertComment(repo, pr, body);
    const names = (rs: ScenarioResult[]) => rs.map((r) => r.scenario.name).join(", ");
    const [state, description] =
      failed.length > 0
        ? (["failure", `${failed.length} of ${results.length} broke: ${names(failed)}`] as const)
        : broken.length > 0
          ? (["error", `Kane couldn't finish: ${names(broken)}`] as const)
          : (["success", `${results.length} scenario(s) pass in Chrome`] as const);
    await setStatus(repo, sha, state, description, comment.html_url);
  }
  return broken;
}
