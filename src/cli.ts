// The PR check. Runs when a PR is opened or updated, and when someone comments /proofed on one.
// Picks the scenarios the diff touches, adds what the PR description asks to have checked, runs
// each in Chrome with Kane, publishes the clips and reports on the PR.
import { mkdirSync } from "node:fs";
import { acknowledge, findReport, getPullRequest, reply, setStatus, type PullRequest } from "./github.ts";
import { baseRev, changedFiles, ctx, env, pickScenarios, publish, readEvent, runAll } from "./pipeline.ts";
import { readReportData } from "./report.ts";
import { askedScenario, descriptionRequest, parseCommand, parseFix } from "./requests.ts";
import type { Scenario } from "./scenarios.ts";

type Event = {
  pull_request: PullRequest;
  issue: { number: number; pull_request?: object };
  comment: { id: number; body: string };
};

const event = readEvent<Event>();
const { repo, runUrl, outDir } = ctx();
mkdirSync(outDir, { recursive: true });

// The workflow already filters comments; this is the same rule, for runs started any other way.
const command = event.comment ? parseCommand(event.comment.body) : undefined;
if (event.comment && command === undefined) {
  console.log("The comment doesn't ask for /proofed; nothing to do.");
  process.exit(0);
}
if (repo && event.comment) await acknowledge(repo, event.comment.id).catch(() => {});

// With the current workflow, "/proofed fix" never gets here (src/mode.ts sends it to the fixer).
// A repo still on the older check-only workflow would otherwise have Kane "check" the words "fix opus".
if (command !== undefined && parseFix(command)) {
  if (repo && event.issue) {
    await reply(repo, event.issue.number,
      "`/proofed fix` needs the newer Proofed workflow (one `proofed.yml`, see https://github.com/t1dem/proofed). Until then, tick **Fix with Claude** in the report.");
  }
  process.exit(0);
}

const pr = event.pull_request ?? (repo && event.issue?.pull_request ? await getPullRequest(repo, event.issue.number) : undefined);
const sha = env("PROOFED_SHA", pr?.head.sha ?? process.env.GITHUB_SHA ?? "local");
const base = process.env.PROOFED_BASE_SHA || (pr && baseRev(pr.base));

let selected: Scenario[];
let skipped: string[] = [];
let asked: Scenario[];
if (command) {
  // "/proofed <what to check>": just that.
  asked = [askedScenario("comment", command)];
  selected = asked;
} else {
  // Proofed's own setup PR describes Proofed, not something to check in the app.
  const request = pr?.head.ref === "proofed-setup" ? undefined : descriptionRequest(pr?.body);
  asked = request ? [askedScenario("description", request)] : [];
  const only = process.env.PROOFED_ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
  const changed = base ? changedFiles(base, sha === "local" ? "HEAD" : sha) : undefined;
  const picked = pickScenarios({ changed, only, rev: base });
  selected = [...picked.selected, ...asked];
  skipped = picked.skipped;
  console.log(`Changed files: ${changed?.length ?? "n/a"}.`);
}

console.log(`Running ${selected.length} scenario(s)${asked.length ? `, including what the ${command ? "comment" : "PR description"} asks` : ""}.`);
if (repo && pr) await setStatus(repo, sha, "pending", `Kane is checking ${selected.length} scenario(s) in Chrome`, runUrl);

let results, broken;
try {
  results = await runAll(selected, outDir);
  // Read just before it's overwritten, so the run history carries over.
  const previous = repo && pr ? readReportData((await findReport(repo, pr.number))?.body ?? "") : undefined;
  broken = await publish({ repo, pr: pr?.number, sha, results, skipped, runUrl, outDir, asked, previous });
} catch (e) {
  // Don't leave the PR on "pending" forever.
  if (repo && pr) await setStatus(repo, sha, "error", "Proofed itself failed; see the logs", runUrl).catch(() => {});
  throw e;
}

console.log(`\n${broken.length > 0 ? "✗" : "✓"} ${results.filter((r) => r.outcome === "passed").length}/${results.length} passed`);
process.exitCode = broken.length > 0 ? 1 : 0;
