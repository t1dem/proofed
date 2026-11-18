import { checkedAt } from "./fixtarget.ts";
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
