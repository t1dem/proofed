// The one Proofed workflow runs on PR events and on comments; this decides what to do for this one:
// check the PR, or have the selected agent fix what the last check found. It also settles the fix model,
// so a "/proofed fix" that can't run gets an answer before anything is installed, and whether the
// setup PR's check starts by writing scenarios.
import { appendFileSync } from "node:fs";
import { acknowledge, ctx, findReport, getPermission, getPullRequest, hasStatus, listFolder, readEvent, readFile, reply, setStatus, type PullRequest } from "../github.ts";
import { DEFAULT_FIXER, resolveFixer } from "../fix/models.ts";
import { alreadyReported, fixRequested, readReportData } from "../report/report.ts";
import { parseCommand, parseFix, type FixCommand } from "./requests.ts";
import { APP_LOGIN, FIRST_ANDROID_SCENARIO, FIRST_SCENARIO, onlyFirstScenario, SETUP_BRANCH } from "./setup.ts";

type Event = {
  action: string;
  pull_request: PullRequestWithRepositories;
  issue: { number: number; pull_request?: object };
  comment: { id: number; body: string; user: { type: string } };
  sender?: { type: string; login?: string };
};

type PullRequestWithRepositories = PullRequest & {
  head: { repo?: { full_name: string } | null };
  base: { repo?: { full_name: string } };
};

const output = (values: Record<string, string | number>) => {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n");
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines}\n`);
  console.log(lines);
};

function skip(why: string): never {
  console.log(why);
  output({ mode: "none" });
  process.exit(0);
}

const event = readEvent<Event>();
const { repo } = ctx();
const number = event.pull_request?.number ?? (event.issue?.pull_request ? event.issue.number : undefined);
if (!repo || !number) skip("Not a pull request, or no GitHub token.");

const requireWriteAccess = async (notify: boolean) => {
  const login = event.sender?.login;
  let permission: string | undefined;
  if (login) {
    try {
      permission = await getPermission(repo, login);
    } catch (e) {
      console.log(`Couldn't check ${login}'s repository permission: ${e instanceof Error ? e.message : e}`);
    }
  } else {
    console.log("Couldn't check repository permission: the event has no sender login.");
  }
  if (permission === "admin" || permission === "write") return;
  const message = "Only people with write access to this repository can run /proofed.";
  if (notify) await reply(repo, number, message).catch((e: unknown) => console.log(`Couldn't reply: ${e instanceof Error ? e.message : e}`));
  skip(`${message} Sender: ${login ?? "unknown"}; permission: ${permission ?? "unknown"}.`);
};

let mode: "check" | "fix" = "check";
let asked: Exclude<FixCommand, { error: string }> = {};

const refuse = async (message: string) => {
  await reply(repo, number, message).catch((e: unknown) => console.log(`Couldn't reply: ${e instanceof Error ? e.message : e}`));
  return skip(message);
};

const checkbox = event.action === "edited" ? event.comment : undefined;
const command = event.comment && !checkbox ? parseCommand(event.comment.body) : undefined;
if (event.comment) {
  if (checkbox) {
    const { body, user } = checkbox;
    if (user.type !== "Bot" || !fixRequested(body) || !readReportData(body)) skip("No fix requested.");
  } else if (command === undefined) skip("The comment doesn't ask for /proofed.");
  await requireWriteAccess(!checkbox);
}

const pr: PullRequestWithRepositories = event.pull_request ?? (await getPullRequest(repo, number));
// Comment jobs have repository secrets, and fix jobs check out and push a branch in the base repo.
if (!pr.head.repo?.full_name || pr.head.repo.full_name !== pr.base.repo?.full_name) {
  if (event.comment) await refuse("Proofed can only run on pull requests from branches in this repository.");
  const message = "Proofed skipped this fork pull request because it needs repository secrets.";
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
  skip(message);
}

const fixingDisabled = process.env.PROOFED_FIX === "false";
const fixingDisabledMessage = "Fixing is turned off for this repository.";
if (checkbox) {
  // A tick that raced a newer report: the box was on a report that's no longer the one.
  if ((await findReport(repo, number))?.id !== checkbox.id) skip("A newer report has replaced the one the box was ticked in.");
  if (fixingDisabled) await refuse(fixingDisabledMessage);
  mode = "fix";
} else if (event.comment && command !== undefined) {
  const fix = parseFix(command);
  if (fix) {
    await acknowledge(repo, event.comment.id).catch(() => {});
    if ("error" in fix) await refuse(fix.error);
    else if (fixingDisabled) await refuse(fixingDisabledMessage);
    else {
      const report = await findReport(repo, number);
      const data = report?.body ? readReportData(report.body) : undefined;
      if (!data) await refuse("There's no Proofed report on this PR yet. Comment `/proofed` to run the check first.");
      else if (data.failures.length === 0) await refuse("Nothing to fix: no scenario failed in the last Proofed run on this PR.");
      mode = "fix";
      asked = fix;
    }
  }
}

// The run that the fix commit starts: the fix run already checked that commit and reported on it.
if (mode === "check" && event.pull_request) {
  const sha = event.pull_request.head.sha;
  const report = await findReport(repo, number);
  const data = report?.body ? readReportData(report.body) : undefined;
  if (report && data && alreadyReported(event.action, sha, data)) {
    try {
      if (!(await hasStatus(repo, sha))) {
        const last = data.history?.at(-1);
        const state = last?.sha === sha ? last.state : data.failures.length > 0 ? "failed" : "passed";
        await setStatus(repo, sha, state === "failed" ? "failure" : state === "error" ? "error" : "success", "Already checked on this commit; see the report", report.html_url);
      }
    } catch (e) {
      console.log(`Couldn't check the commit status: ${e instanceof Error ? e.message : e}`);
    }
    skip(`The report on this PR is already about ${sha.slice(0, 7)}; nothing to run.`);
  }
}

// Settings saved from the Proofed dashboard arrive as the repo's Actions variables.
const vars = JSON.parse(process.env.PROOFED_VARS || "{}") as Record<string, string | undefined>;
const configured = resolveFixer({
  provider: vars.PROOFED_PROVIDER,
  model: vars.PROOFED_MODEL,
  effort: vars.PROOFED_EFFORT,
});
// A bad fixer setting must not cost the PR its check: only the fixer waits until the setting is corrected.
const badSetting = "error" in configured ? `The fixer setting in this repository's variables is invalid: ${configured.error}` : undefined;
if (badSetting && mode === "fix") await refuse(badSetting);
if (badSetting) console.log(`::warning::${badSetting} The check runs; fixing and writing scenarios are off until it is corrected.`);
const fixer = resolveFixer(asked, "error" in configured ? DEFAULT_FIXER : configured);
if ("error" in fixer) {
  if (event.comment) await refuse(fixer.error);
  skip(fixer.error);
}
const credential = fixer.provider === "codex" ? process.env.PROOFED_CODEX === "true" : process.env.PROOFED_CLAUDE === "true";

// The setup PR's check has the selected agent write the first scenarios before Kane runs them (generate.ts):
// only while the branch holds just the stock scenario, so a person's scenarios are never touched,
// and only with a credential for the selected provider. Otherwise its CLI is not installed.
let generate = false;
const target = process.env.PROOFED_TARGET || "web";
const first = target === "web" ? FIRST_SCENARIO
  : target === "android" && process.env.PROOFED_EXECUTION === "cloud" ? FIRST_ANDROID_SCENARIO
  : undefined;
if (mode === "check" && event.pull_request && pr.head.ref === SETUP_BRANCH && credential && !badSetting && first) {
  const dir = (process.env.PROOFED_SCENARIOS || ".proofed/scenarios").replace(/\/+$/, "");
  try {
    const [only, ...more] = (await listFolder(repo, dir, pr.head.sha)) ?? [];
    generate = !!only && more.length === 0 && only.type === "file" &&
      onlyFirstScenario([{ name: only.name, text: await readFile(repo, `${dir}/${only.name}`, pr.head.sha) }], first);
  } catch (e) {
    console.log(`Couldn't read ${dir} on the setup branch, so no scenarios are written: ${e instanceof Error ? e.message : e}`);
  }
}

// "Fix automatically" in the dashboard (vars.PROOFED_AUTOFIX): a check of a person's push goes on to fix
// what it finds broken (action.yml), as a ticked "Fix with Claude" would. Not on a draft, where someone is
// still at work, and not on a push by a bot: the fixer's own fix commit would otherwise start another fix.
// The one exception is a pull request Proofed's own app opens (the site's "Break it yourself"): it is
// fixed like a person's. Renovate's and other bots' are left alone, nobody asked for a push to those.
const opened = event.action === "opened" || event.action === "reopened";
const byBot = event.sender?.type === "Bot" && !(opened && event.sender.login === APP_LOGIN);
const autofix =
  mode === "check" && !generate && !!event.pull_request && vars.PROOFED_AUTOFIX === "true" && !pr.draft &&
  !byBot && credential && !badSetting && !fixingDisabled;

output({
  mode,
  generate: String(generate),
  autofix: String(autofix),
  number,
  head_sha: pr.head.sha,
  head_ref: pr.head.ref,
  base_sha: pr.base.sha,
  base_ref: pr.base.ref,
  provider: fixer.provider!,
  model: fixer.model,
  effort: fixer.effort,
});
