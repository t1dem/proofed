// The one Proofed workflow runs on PR events and on comments; this decides what to do for this one:
// check the PR in Chrome, or have Claude fix what the last check found. It also settles the fix model,
// so a "/proofed fix" that can't run gets an answer before anything is installed.
import { appendFileSync } from "node:fs";
import { acknowledge, findReport, getPullRequest, reply, type PullRequest } from "./github.ts";
import { DEFAULT_FIXER } from "./models.ts";
import { ctx, readEvent } from "./pipeline.ts";
import { fixRequested, readReportData } from "./report.ts";
import { parseCommand, parseFix, type FixCommand } from "./requests.ts";

type Event = {
  action: string;
  pull_request: PullRequest;
  issue: { number: number; pull_request?: object };
  comment: { id: number; body: string; user: { type: string } };
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

let mode: "check" | "fix" = "check";
let asked: Exclude<FixCommand, { error: string }> = {};

if (event.action === "edited" && event.comment) {
  // Someone ticked "Fix with Claude" in Proofed's report.
  const { body, user } = event.comment;
  if (user.type !== "Bot" || !fixRequested(body) || !readReportData(body)) skip("No fix requested.");
  mode = "fix";
} else if (event.comment) {
  const command = parseCommand(event.comment.body);
  if (command === undefined) skip("The comment doesn't ask for /proofed.");
  const fix = parseFix(command);
  if (fix) {
    await acknowledge(repo, event.comment.id).catch(() => {});
    const refuse = async (message: string) => {
      await reply(repo, number, message);
      skip(message);
    };
    if ("error" in fix) await refuse(fix.error);
    else if (process.env.PROOFED_FIX === "false") await refuse("Fixing with Claude is turned off for this repository.");
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

// Settings saved from the Proofed dashboard arrive as the repo's Actions variables.
const vars = JSON.parse(process.env.PROOFED_VARS || "{}") as Record<string, string | undefined>;
const pr = event.pull_request ?? (await getPullRequest(repo, number));
output({
  mode,
  number,
  head_sha: pr.head.sha,
  head_ref: pr.head.ref,
  base_sha: pr.base.sha,
  base_ref: pr.base.ref,
  model: asked.model ?? (vars.PROOFED_MODEL || DEFAULT_FIXER.model),
  effort: asked.effort ?? (vars.PROOFED_EFFORT || DEFAULT_FIXER.effort),
});
