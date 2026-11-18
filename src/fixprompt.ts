import { askAgent } from "./agent.ts";
import { checkedAt, checkedWhere } from "./fixtarget.ts";
import type { Fixer } from "./models.ts";
import type { Scenario } from "./scenarios.ts";
import type { FailureData } from "./report.ts";
import { FAILED_CHECK_ACTION, FAILED_CHECK_REASON } from "./runfile.ts";

// Keep Kane's interpretation separate from the check the fixer must preserve.
export function describeFailure(f: FailureData, scenario?: Scenario) {
  return `### Scenario "${f.name}" (${f.file || "asked for on the PR"})
Objective checked ${scenario ? checkedAt(scenario) : f.checkedAt ?? "in Chrome"}:
${f.objective || scenario?.objective || ""}

What went wrong: ${f.reason}
${f.failedCheck ? `${FAILED_CHECK_REASON}\n${FAILED_CHECK_ACTION}\n` : ""}${f.diagnosis ? `${f.failedCheck ? "Kane's opinion" : "Diagnosis"}: ${f.diagnosis}\n` : ""}${f.steps.length ? `\nKane's steps:\n${f.steps.join("\n")}` : ""}`;
}

export function fixPrompt({ failures, feedback, diff, scenarios, base, appDir, buildCommand, buildInput }: {
  failures: FailureData[];
  feedback: string;
  diff: string;
  scenarios: Scenario[];
  base: string;
  appDir: string;
  buildCommand: string;
  buildInput: string;
}) {
  const described = failures.map((f) => describeFailure(f, scenarios.find((s) => s.id === f.id))).join("\n\n");

  return `${failures.some((f) => f.failedCheck) ? "A scenario's check did not hold on the page. Kane believes the scenario is out of date; that opinion does not establish whether the app change was intended." : "This pull request broke a user flow."} Proofed checked the scenarios below ${checkedWhere(scenarios)} with Kane CLI against this branch, and they failed.

${described}

The pull request changes this (git diff ${base.slice(0, 7)}...HEAD):
\`\`\`diff
${diff}
\`\`\`
${feedback ? `\nA previous fix attempt didn't work:\n${feedback}\n` : ""}
${failures.some((f) => f.failedCheck) ? "Kane's opinion is not proof that the scenario is wrong. If the app change was intended, stop and explain that the scenario needs review. Otherwise fix the app. Do not make a check pass by changing its expectations." : "Find the cause in the application code and fix it with the smallest change that keeps what the PR set out to do."}
Don't edit anything under .proofed/, don't change the scenario expectations, and don't commit.
Your change is committed without the project's git hooks, so match the surrounding code style exactly (indentation, quotes, semicolons, import order), as the project's formatter and linter would.
Do not run commands other than reading application code and the build. Do not access the network or external services.
You may run \`${buildCommand}\` to check that your change builds (it runs \`${buildInput}\` ${appDir === "." ? "at the repo root" : `in \`${appDir}\``}).
End your answer with one line in English that starts with "SUMMARY:". It goes into the pull request as is, so it says only what was wrong in the code and what you changed, nothing about tools, builds, tests or permissions.`;
}

export function askFixer(text: string, fixer: Fixer, buildCommand: string) {
  const answer = askAgent(text, {
    ...fixer,
    timeoutMs: 10 * 60_000,
    allowedTools: ["Read", "Edit", "Write", "Glob", "Grep", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)", `Bash(${buildCommand})`],
  });
  if (!answer.ok) return answer;
  const summary = /^SUMMARY:\s*(.+)$/m.exec(answer.text)?.[1] ?? answer.text.split("\n").at(-1) ?? "";
  return { ok: true as const, summary: summary.trim() };
}
