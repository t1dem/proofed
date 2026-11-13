// The PR check: pick the scenarios this diff touches, run each in Chrome with Kane,
// publish the clips and report on the PR.
import { mkdirSync } from "node:fs";
import { setStatus } from "./github.ts";
import { changedFiles, ctx, env, isBroken, pickScenarios, publish, readEvent, runAll } from "./pipeline.ts";

type PullRequestEvent = { pull_request: { number: number; base: { sha: string }; head: { sha: string } } };

const { pull_request: pr } = readEvent<PullRequestEvent>();
const { repo, runUrl, outDir } = ctx();
mkdirSync(outDir, { recursive: true });

const sha = env("PROOFED_SHA", pr?.head.sha ?? process.env.GITHUB_SHA ?? "local");
const base = process.env.PROOFED_BASE_SHA || pr?.base.sha;
const only = process.env.PROOFED_ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
const changed = base ? changedFiles(base, sha === "local" ? "HEAD" : sha) : undefined;
const { selected, skipped } = pickScenarios({ changed, only });

console.log(`Changed files: ${changed?.length ?? "n/a"}. Running ${selected.length} scenario(s).`);
if (repo && pr) await setStatus(repo, sha, "pending", `Kane is checking ${selected.length} scenario(s) in Chrome`, runUrl);

const results = await runAll(selected, outDir);
const broken = await publish({ repo, pr: pr?.number, sha, results, skipped, runUrl, outDir });

console.log(`\n${broken.length > 0 ? "✗" : "✓"} ${results.filter((r) => !isBroken(r)).length}/${results.length} passed`);
process.exitCode = broken.length > 0 ? 1 : 0;
