// The rounds of "the fixer fixes, Kane re-checks" inside one fix (fix.ts), before anything is pushed.
// After each attempt Kane re-runs the scenarios being fixed and every other scenario whose paths the
// attempt's changes touch. One of those others that fails, and wasn't already failing in the report
// the fix started from, was broken by the fix: the attempt doesn't count, and the next one is told
// which scenario it broke. A neighbour Kane only couldn't confirm holds nothing back.
import { checkedWhere } from "./fixtarget.ts";
import { live } from "../report/live.ts";
import { providerLabel, providerOf, type Fixer } from "./models.ts";
import type { FailureData, FixAttempt } from "../report/report.ts";
import { descriptionCheckNote } from "../action/requests.ts";
import { maskSecrets } from "../secrets.ts";
import type { ScenarioResult } from "../types.ts";
import { timed } from "../timing.ts";
import { affectedBy, touches, type Scenario } from "../scenarios.ts";

export const MAX_ATTEMPTS = 3;

// An unconfirmed description check can be set aside while Kane verifies the other fixes.
export const settled = (r: ScenarioResult) => r.outcome === "passed" || !!descriptionCheckNote(r);
const notPassing = (results: ScenarioResult[]) =>
  results
    .filter((r) => !settled(r))
    .map((r) =>
      r.outcome === "unsure"
        ? `"${r.scenario.name}" wasn't confirmed: ${r.end?.reason}`
        : `"${r.scenario.name}" still fails: ${r.end?.reason ?? r.error}${r.pageError ? ` Browser console: ${r.pageError}` : ""}`,
    );
const list = (lines: string[]) => lines.map((line) => `- ${line}`).join("\n");

export type Answer = { ok: true; summary: string } | { ok: false; message: string };

export type FixLoopInput = {
  fixer: Fixer;
  // Only confirmed failures are exempt from regression checks. Open and checked describe the prior run.
  failures: FailureData[];
  previouslyFailed?: string[];
  open: string[];
  checked: string[];
  ask: (failures: FailureData[], feedback: string) => Answer;
  // Undoes what the fixer did to files it may not change, and says which.
  putBack: () => string[];
  hasChanges: () => boolean;
  // The build's output when it failed, else undefined.
  build: () => string | undefined;
  // Files the fix has changed so far, new ones included, and every scenario there is.
  changedFiles: () => string[];
  allScenarios: () => Scenario[];
  scenariosFor: (ids: string[]) => Scenario[];
  check: (scenarios: Scenario[], attempt: number) => Promise<ScenarioResult[]>;
  maxAttempts?: number;
};

export type FixLoopEnd = {
  status: "fixed" | "gave-up" | "no-claude";
  attempt: number;
  summary: string;
  tries: FixAttempt[];
  // The last check: `fixing` for the scenarios the report had broken, `results` for all it ran.
  fixing: ScenarioResult[];
  results: ScenarioResult[];
  // Scenarios the last attempt broke, and the last note for Claude (or why the fixer couldn't run).
  broke: ScenarioResult[];
  feedback: string;
  // The furthest any attempt got, even if a later attempt could not build.
  failureStage: "change" | "build" | "check";
};

export async function fixLoop(o: FixLoopInput): Promise<FixLoopEnd> {
  const max = o.maxAttempts ?? MAX_ATTEMPTS;
  const ids = o.failures.map((f) => f.id);
  const previouslyFailed = new Set(o.previouslyFailed ?? ids);
  const previouslyPassed = (id: string) => o.checked.includes(id) && !o.open.includes(id);
  let failures = o.failures;
  let feedback = "";
  let summary = "";
  let fixing: ScenarioResult[] = [];
  let results: ScenarioResult[] = [];
  let broke: ScenarioResult[] = [];
  let failureStage: FixLoopEnd["failureStage"] = "change";
  const tries: FixAttempt[] = [];
  const end = (status: FixLoopEnd["status"], attempt: number): FixLoopEnd => ({ status, attempt, summary, tries, fixing, results, broke, feedback, failureStage });

  for (let attempt = 1; attempt <= max; attempt++) {
    console.log(`\n=== Attempt ${attempt}: asking ${o.fixer.model} (${o.fixer.effort}) about ${failures.map((f) => f.name).join(", ")}`);
    live.fix({ attempt, of: max, doing: "writing", ...o.fixer, tries: [...tries] });
    const answer = timed("fixer", () => o.ask(failures, feedback));
    if (!answer.ok) {
      feedback = answer.message;
      return end("no-claude", attempt);
    }
    summary = answer.summary;
    console.log(`${providerLabel(providerOf(o.fixer.model))}: ${summary}`);

    // The scenarios and the workflows are not the fixer's to change (guard.ts): what it did there is undone.
    const undone = o.putBack();
    if (undone.length > 0) console.log(`Put back, the fixer may not change these: ${undone.join(", ")}`);
    if (!o.hasChanges()) {
      feedback = undone.length > 0
        ? `You changed only ${undone.join(", ")}. Scenarios and workflows are off limits and were put back. Fix the application code.`
        : "You made no changes to the code.";
      tries.push({ summary, result: undone.length > 0 ? "It edited the scenario instead of the code. Proofed put the scenario back." : "No change to the code." });
      continue;
    }
    live.fix({ doing: "building" });
    const buildError = o.build();
    if (buildError !== undefined) {
      if (failureStage === "change") failureStage = "build";
      feedback = `Your change didn't build:\n${maskSecrets(buildError).slice(-3000)}`;
      tries.push({ summary, result: "It didn't build." });
      continue;
    }

    failureStage = "check";
    live.fix({ doing: "checking" });
    // Every attempt re-runs all the scenarios the report had broken: a later attempt can break one an earlier one fixed.
    const files = o.changedFiles();
    const neighbours = affectedBy(o.allScenarios(), files).filter((s) => !ids.includes(s.id));
    const requested = [...o.scenariosFor(ids), ...neighbours];
    try {
      results = (await o.check(requested, attempt)).filter(Boolean);
    } catch (e) {
      results = [];
      fixing = [];
      broke = [];
      feedback = `The rebuild couldn't be checked: ${maskSecrets(String(e))}`;
      tries.push({ summary, result: feedback });
      continue;
    }
    const returned = new Set(results.map((r) => r.scenario.id));
    const missing = [...o.failures, ...neighbours].filter((s) => !returned.has(s.id));
    const missingLines = missing.map((s) => `Kane returned no result for "${s.name}" (${s.id}).`);
    fixing = results.filter((r) => ids.includes(r.scenario.id));
    broke = results.filter((r) => !ids.includes(r.scenario.id) && r.outcome === "failed" && !previouslyFailed.has(r.scenario.id));
    const fixed = missing.length === 0 && fixing.length === ids.length && fixing.some((r) => r.outcome === "passed") && fixing.every(settled) && broke.length === 0;
    tries.push({
      summary,
      result: fixed ? "Kane saw it pass." : [...notPassing(fixing), ...missingLines, ...broke.map((r) =>
        `It broke "${r.scenario.name}", which ${previouslyPassed(r.scenario.id) ? "passed" : "hadn't failed"} before.`
      )].join("; "),
    });
    if (fixed) return end("fixed", attempt);

    const brokeLines = broke.map((r) => {
      const edited = files.filter((f) => touches(r.scenario, f)).join(", ");
      const why = `${r.end?.reason ?? r.error}`;
      return previouslyPassed(r.scenario.id)
        ? `"${r.scenario.name}" passed before your change and fails now: ${why} It covers ${edited}, which you changed.`
        : `"${r.scenario.name}" fails now: ${why} It covers ${edited}, which you changed.`;
    });
    const still = o.failures.filter((f) => fixing.some((r) => r.scenario.id === f.id && !settled(r)));
    const unresolved = o.failures.filter((f) => !returned.has(f.id) || still.includes(f));
    failures = unresolved.length > 0 ? unresolved : o.failures;
    feedback = [
      `Your change was: ${summary}`,
      ...(still.length > 0
        ? [`The scenarios were checked again ${checkedWhere(fixing.map((r) => r.scenario))}:\n${list(notPassing(fixing))}`]
        : unresolved.length === 0 ? [`The scenarios you were fixing pass now ${checkedWhere(fixing.map((r) => r.scenario))}. Keep that.`] : []),
      ...(missing.length > 0 ? [list(missingLines)] : []),
      ...(broke.length > 0 ? [`But your change broke ${broke.length === 1 ? "a scenario" : "scenarios"} that didn't fail before it:\n${list(brokeLines)}\nFind what in your change did that, and fix it without breaking the others again.`] : []),
    ].join("\n");
  }
  return end("gave-up", max);
}
