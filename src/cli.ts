// Entry point of the GitHub Action: pick the scenarios this diff touches, run each in Chrome
// with Kane, publish the clips, and report on the PR.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { publishClips, repoFromEnv, setStatus, upsertComment } from "./github.ts";
import { buildReport, type ClipLinks } from "./report.ts";
import { runScenario, type ScenarioResult } from "./run.ts";
import { affectedBy, loadScenarios } from "./scenarios.ts";

const env = (name: string, fallback?: string) => {
  const value = process.env[name]?.trim() || fallback;
  if (value === undefined) throw new Error(`Missing ${name}`);
  return value;
};

type PullRequestEvent = { pull_request?: { number: number; base: { sha: string }; head: { sha: string } } };

const event: PullRequestEvent = process.env.GITHUB_EVENT_PATH
  ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"))
  : {};
const pr = event.pull_request;
const headSha = env("PROOFED_SHA", pr?.head.sha ?? process.env.GITHUB_SHA ?? "local");
const baseSha = process.env.PROOFED_BASE_SHA || pr?.base.sha;

const changedFiles = baseSha
  ? execFileSync("git", ["diff", "--name-only", `${baseSha}...${headSha === "local" ? "HEAD" : headSha}`], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
  : undefined;

const all = loadScenarios(env("PROOFED_SCENARIOS", ".proofed/scenarios"));
const only = process.env.PROOFED_ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
const selected = only?.length
  ? all.filter((s) => only.includes(s.id))
  : changedFiles
    ? affectedBy(all, changedFiles)
    : all;
const skipped = all.filter((s) => !selected.includes(s)).map((s) => s.name);

const token = process.env.GITHUB_TOKEN;
const repo = token && process.env.GITHUB_REPOSITORY ? repoFromEnv(token) : undefined;
const runUrl = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : undefined;

console.log(`Changed files: ${changedFiles?.length ?? "n/a"}. Running ${selected.length} of ${all.length} scenarios.`);
if (repo && headSha !== "local") {
  await setStatus(repo, headSha, "pending", `Kane is checking ${selected.length} scenario(s) in Chrome`, runUrl);
}

const outDir = resolve(env("PROOFED_OUT", ".proofed-out"));
const results: ScenarioResult[] = [];
for (const scenario of selected) {
  console.log(`\n▶ ${scenario.name}`);
  results.push(
    await runScenario(scenario, {
      baseUrl: env("PROOFED_URL"),
      outDir,
      username: process.env.LT_USERNAME,
      accessKey: process.env.LT_ACCESS_KEY,
    }),
  );
}

const clips = new Map<string, ClipLinks>();
if (repo && pr) {
  const prefix = `pr-${pr.number}/${headSha.slice(0, 7)}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}`;
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

const body = buildReport({
  sha: headSha,
  results,
  skipped,
  clips,
  runUrl,
  fixEnabled: process.env.PROOFED_FIX !== "false",
});
writeFileSync(join(outDir, "report.md"), body);
writeFileSync(join(outDir, "results.json"), JSON.stringify(results, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, body);

const broken = results.filter((r) => r.outcome === "failed" || r.outcome === "error");
if (repo && pr) {
  const comment = await upsertComment(repo, pr.number, body);
  const description =
    broken.length > 0
      ? `${broken.length} of ${results.length} scenarios broke: ${broken.map((r) => r.scenario.name).join(", ")}`
      : `${results.length} scenario(s) pass in Chrome`;
  await setStatus(repo, headSha, broken.length > 0 ? "failure" : "success", description, comment.html_url);
}

console.log(`\n${broken.length > 0 ? "✗" : "✓"} ${results.length - broken.length}/${results.length} passed`);
process.exitCode = broken.length > 0 ? 1 : 0;
