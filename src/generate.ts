// The setup PR's check, when mode.ts finds only the stock scenario there: Claude Code reads the app and
// writes scenarios for its main flows, Kane runs each of them in Chrome next to the stock one, and the
// ones Kane saw pass are committed to the setup branch. The rest are deleted, so the PR carries no guess.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { askClaude } from "./claude.ts";
import { findReport, setStatus, type PullRequest } from "./github.ts";
import { DEFAULT_FIXER, type Fixer } from "./models.ts";
import { ctx, env, isBroken, publish, readEvent, runAll } from "./pipeline.ts";
import { pushHead } from "./push.ts";
import { readReportData, type Written } from "./report.ts";
import { unchecked, type ScenarioResult } from "./run.ts";
import { loadScenarios, parseScenario, type Scenario } from "./scenarios.ts";

const MAX_SCENARIOS = 5;
// Reading an app and writing a few files takes Claude a few minutes; one that runs this long is stuck,
// and the check still has Kane's runs ahead of it.
const WRITE_TIMEOUT_MS = 10 * 60_000;

const event = readEvent<{ pull_request: PullRequest }>();
const { repo, runUrl, outDir } = ctx();
const pr = event.pull_request;
mkdirSync(outDir, { recursive: true });
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
const lines = (text: string) => text.split("\n").filter(Boolean);
// Claude Code's permission rules take paths relative to where it runs: the repo root.
const dir = relative(process.cwd(), resolve(env("PROOFED_SCENARIOS", ".proofed/scenarios")));
const appDir = env("PROOFED_DIR", ".");
const writer: Fixer = {
  model: env("PROOFED_CLAUDE_MODEL", DEFAULT_FIXER.model),
  effort: env("PROOFED_CLAUDE_EFFORT", DEFAULT_FIXER.effort),
};
const headSha = git("rev-parse", "HEAD");
const stock = loadScenarios(dir);

const example = `---
name: Promo code total
paths: [src/pricing.ts, src/cart.ts, src/pages/Cart.tsx, src/pages/Summary.tsx]
url: /
---
Add Ethiopia Guji to the bag twice and the Hand Grinder once.
Open the bag, type the promo code welcome10 and apply it.
Check that the discount is "−€9.10" and shipping is "Free".
Check that the total is "€81.90".`;

const prompt = () => `Proofed checks every pull request of this repository in a real Chrome. It runs scenarios: Markdown files with plain-English steps that Kane CLI, an AI browser agent, follows on the running app. Kane sees only the page, never the code. This repository has one scenario so far, ${dir}/home.md:

${readFileSync(`${dir}/home.md`, "utf8").trim()}

Write up to ${MAX_SCENARIOS} more, for the flows a user of this app would miss most if a pull request broke them.

Where the app runs: it is in \`${appDir}\`${appDir === "." ? " (the repository root)" : ""}, built with \`${env("PROOFED_BUILD", "")}\` and served with \`${env("PROOFED_SERVE", "")}\` at ${env("PROOFED_URL")}. Nothing else runs: no backend, database or API that this command doesn't start. A scenario's \`url\` is a path on that server.

How to find the flows: read the README, the app's routes and its pages and components. Look for what a visitor can see and do: pages, navigation, buttons, forms, filters, anything that changes what's on the screen. If the app has a demo, preview or sample-data mode that works without signing in, its pages count too.

Spread the scenarios over the app instead of spending them all on one page: start with the page most visitors open first, past the heading home.md already checks, then one scenario for each main area. Within a scenario, prefer a flow (press this, and that appears) over re-reading static text, and check the one or two things a user would notice if it broke. A scenario that checks ten texts fails on every copy change and proves little more. For the same reason, a check quotes a few words that tell the thing apart ("Paused", "€81.90"), not a whole sentence.

Write a scenario only if Kane can run it on that server as is, every time:
- No sign-in, no payment, no email, no third-party service. A page that needs a login or a backend that isn't running is out.
- Nothing it does stays behind for the next run: no data created, changed or deleted on a server.
- Every step names what the user sees: the exact labels of buttons and links, headings, and the texts and numbers a check expects, copied from the code. Copy only text the page shows as is, not variable names, translation keys, or values made at runtime (dates, counts, random ids).
- A text a check expects goes in double quotes, so Kane knows where it ends: Check that the row says "Paused" again. Without them, Kane reads the words after it as part of the text.
- It ends with checks of what is on the page. "Check that it works" checks nothing; "Check that the heading reads Pricing and three plans are listed" does.

A scenario that fails because it was guessed is deleted anyway. If you can't find a flow that meets all of the above, write fewer, or none.

The format, exactly. One file per scenario, in ${dir}/, named after the flow in kebab-case (pricing-plans.md). An example from another app, for the shape only:

${example}

- \`name\`: what a person reads in the report, a few words.
- \`paths\`: the files, relative to the repository root, whose change could break this flow: the page, the components it renders, the data and styles it reads. Globs like \`src/pages/**\` work. A scenario runs on the pull requests that change one of them, so leave out what every change touches (package.json, lockfiles, configs).
- \`url\`: the path the scenario starts at.
- Then 4 to 8 short lines, one action or check per line. Kane does each step once, as written.

Write only new files in ${dir}/. Don't change home.md.

End your answer with one line per scenario you wrote, most valuable first, in English:
SCENARIO: <file name> - <what it checks, in one short sentence a person reads in the report>`;

// Undoes whatever Claude changed besides new files in the scenarios folder: home.md, or anything else
// a tool let through. Files that were already changed or untracked (the build's) stay as they are.
const changedBefore = new Set(lines(git("diff", "--name-only")));
const untrackedBefore = new Set(lines(git("ls-files", "--others", "--exclude-standard")));
function keepOnlyNewScenarios() {
  for (const file of lines(git("diff", "--name-only"))) if (!changedBefore.has(file)) git("checkout", "--", file);
  const added = lines(git("ls-files", "--others", "--exclude-standard")).filter((f) => !untrackedBefore.has(f));
  for (const file of added) if (!file.startsWith(`${dir}/`) || !file.endsWith(".md")) rmSync(file, { force: true });
  return added.filter((f) => f.startsWith(`${dir}/`) && f.endsWith(".md"));
}

const why = (r: ScenarioResult) =>
  r.outcome === "error"
    ? `Kane couldn't finish the run: ${r.error ?? "no reason given"}`
    : unchecked(r)
      ? "Kane finished without checking anything on the page."
      : r.outcome === "unsure"
        ? `Kane thinks the test is wrong: ${r.end?.reason ?? ""}`
        : (r.end?.reason ?? "It failed.");

async function writeAndProve(): Promise<{ results: ScenarioResult[]; written: Written; sha: string }> {
  console.log(`Asking ${writer.model} (${writer.effort}) to write scenarios in ${dir}/`);
  const answer = askClaude(prompt(), {
    ...writer,
    permissionMode: "default",
    tools: ["Read", "Glob", "Grep", "Write", "Edit"],
    allowedTools: ["Read", "Glob", "Grep", `Write(./${dir}/**)`, `Edit(./${dir}/**)`],
    maxTurns: 60,
    timeoutMs: WRITE_TIMEOUT_MS,
  });
  const files = keepOnlyNewScenarios();
  if (!answer.ok) {
    console.log(`Claude Code couldn't write scenarios: ${answer.message}`);
    for (const file of files) rmSync(file, { force: true });
    return { results: await runAll(stock, outDir), written: { status: "failed" }, sha: headSha };
  }
  console.log(answer.text);

  const listed = [...answer.text.matchAll(/^SCENARIO:\s*`?([\w.-]+\.md)`?\s*(?:[-—–:]\s*(.*))?$/gm)];
  const ranked = listed.map((m) => m[1]);
  const rank = (file: string) => (ranked.indexOf(basename(file)) + 1 || Infinity);
  const about = (s: Scenario) => listed.find((m) => m[1] === basename(s.file))?.[2]?.trim() || s.objective.split("\n")[0]!;
  const dropped: { name: string; why: string }[] = [];
  const candidates: Scenario[] = [];
  for (const file of files.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))) {
    try {
      const scenario = parseScenario(file, readFileSync(file, "utf8"));
      if (candidates.length < MAX_SCENARIOS) candidates.push(scenario);
      else dropped.push({ name: scenario.name, why: `Claude wrote more than ${MAX_SCENARIOS}; this one ranked lower.` });
    } catch (e) {
      dropped.push({ name: basename(file), why: `Not a scenario file: ${e instanceof Error ? e.message : e}` });
    }
  }
  console.log(`Claude wrote ${files.length} file(s); running ${candidates.map((s) => s.id).join(", ") || "none of them"} with the stock scenarios.`);

  const results = await runAll([...stock, ...candidates], outDir);
  const fresh = results.slice(stock.length);
  const kept = fresh.filter((r) => r.outcome === "passed");
  for (const r of fresh) if (r.outcome !== "passed") dropped.push({ name: r.scenario.name, why: why(r) });
  for (const file of files) if (!kept.some((r) => r.scenario.file === file)) rmSync(file, { force: true });
  const stockResults = results.slice(0, stock.length);
  const credits = (rs: ScenarioResult[]) => Math.round(rs.reduce((sum, r) => sum + (r.end?.credits_consumed ?? 0), 0));
  const droppedCredits = credits(fresh.filter((r) => r.outcome !== "passed"));
  console.log(`Kane credits: ${credits(results)} in all, ${droppedCredits} of them on the dropped scenarios.`);
  if (kept.length === 0) return { results: stockResults, written: { status: "written", kept: [], dropped, credits: droppedCredits }, sha: headSha };

  git("add", "--", ...kept.map((r) => r.scenario.file));
  git("-c", "user.name=Claude", "-c", "user.email=noreply@anthropic.com", "commit", "-m",
    `Add scenarios: ${kept.map((r) => r.scenario.name).join(", ")}\n\nWritten by Claude Code for the Proofed setup; Kane ran each one in Chrome and saw it pass.\n\nWritten-by: ${writer.model} (${writer.effort} effort)`);
  try {
    // The app's push starts a check of the new commit. It waits for this job (the workflow's
    // concurrency doesn't let that push cancel a run) and then skips Kane, since the report
    // published below is already about that commit (mode.ts).
    const asApp = await pushHead(env("PROOFED_HEAD_REF"));
    console.log(`Pushed the scenarios to ${env("PROOFED_HEAD_REF")}${asApp ? " as the Proofed app" : ""}`);
  } catch (e) {
    console.log(`Couldn't push the scenarios: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
    return { results: stockResults, written: { status: "failed", credits: credits(fresh) }, sha: headSha };
  }
  const sha = git("rev-parse", "HEAD");
  const repoUrl = repo && `https://github.com/${repo.owner}/${repo.name}`;
  return {
    results: [...stockResults, ...kept],
    written: { status: "written", kept: kept.map((r) => ({ id: r.scenario.id, about: about(r.scenario) })), dropped, credits: droppedCredits, commit: sha, commitUrl: repoUrl ? `${repoUrl}/commit/${sha}` : undefined },
    sha,
  };
}

if (repo && pr) await setStatus(repo, headSha, "pending", "Claude is writing scenarios; Kane will run them in Chrome", runUrl);
try {
  const { results, written, sha } = await writeAndProve();
  const previous = repo && pr ? readReportData((await findReport(repo, pr.number))?.body ?? "") : undefined;
  const broken = await publish({ repo, pr: pr?.number, sha, results, skipped: [], runUrl, outDir, previous, written });
  // The report is about the new commit; the one it was written on would otherwise stay pending.
  if (repo && pr && sha !== headSha) {
    await setStatus(repo, headSha, broken.length > 0 ? "failure" : "success", `Checked on ${sha.slice(0, 7)}, which adds the scenarios`, runUrl);
  }
  console.log(`\n${results.some(isBroken) ? "✗" : "✓"} ${results.filter((r) => r.outcome === "passed").length}/${results.length} passed`);
  process.exitCode = broken.length > 0 ? 1 : 0;
} catch (e) {
  if (repo && pr) await setStatus(repo, headSha, "error", "Proofed itself failed; see the logs", runUrl).catch(() => {});
  throw e;
}
