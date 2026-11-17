// The rounds of "the fixer fixes, Kane re-checks" inside one fix (fix.ts), before anything is pushed.
// After each attempt Kane re-runs the scenarios being fixed and every other scenario whose paths the
// attempt's changes touch. One of those others that fails, and wasn't already failing in the report
// the fix started from, was broken by the fix: the attempt doesn't count, and the next one is told
// which scenario it broke. A neighbour Kane only couldn't confirm holds nothing back.
import { checkedWhere } from "./fixtarget.ts";
import { live } from "./live.ts";
import { providerLabel, providerOf, type Fixer } from "./models.ts";
import type { FailureData, FixAttempt } from "./report.ts";
import { nothingAsked } from "./requests.ts";
import type { ScenarioResult } from "./run.ts";
import { affectedBy, touches, type Scenario } from "./scenarios.ts";

export const MAX_ATTEMPTS = 3;

// A fix counts only when Kane saw the scenario pass; an unsure run hasn't shown anything. A PR
// description that names nothing to check isn't a failure and can't be fixed, so it never holds a fix back.
export const settled = (r: ScenarioResult) => r.outcome === "passed" || nothingAsked(r);
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
  // What the report says broke, and the ids of every scenario that didn't pass in it (failed, not
  // confirmed, couldn't finish) and of every scenario its check ran.
  failures: FailureData[];
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
};

export async function fixLoop(o: FixLoopInput): Promise<FixLoopEnd> {
  const max = o.maxAttempts ?? MAX_ATTEMPTS;
  const ids = o.failures.map((f) => f.id);
  let failures = o.failures;
  let feedback = "";
  let summary = "";
  let fixing: ScenarioResult[] = [];
  let results: ScenarioResult[] = [];
  let broke: ScenarioResult[] = [];
  const tries: FixAttempt[] = [];
  const end = (status: FixLoopEnd["status"], attempt: number): FixLoopEnd => ({ status, attempt, summary, tries, fixing, results, broke, feedback });

  for (let attempt = 1; attempt <= max; attempt++) {
    console.log(`\n=== Attempt ${attempt}: asking ${o.fixer.model} (${o.fixer.effort}) about ${failures.map((f) => f.name).join(", ")}`);
    live.fix({ attempt, of: max, doing: "writing", ...o.fixer, tries: [...tries] });
    const answer = o.ask(failures, feedback);
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
      feedback = `Your change didn't build:\n${buildError.slice(-3000)}`;
      tries.push({ summary, result: "It didn't build." });
      continue;
    }

    live.fix({ doing: "checking" });
    // Every attempt re-runs all the scenarios the report had broken: a later attempt can break one an earlier one fixed.
    const files = o.changedFiles();
    const neighbours = affectedBy(o.allScenarios(), files).filter((s) => !ids.includes(s.id));
    try {
      results = await o.check([...o.scenariosFor(ids), ...neighbours], attempt);
    } catch (e) {
      results = [];
      fixing = [];
      broke = [];
      feedback = `The rebuild couldn't be checked: ${String(e)}`;
      tries.push({ summary, result: feedback });
      continue;
    }
    fixing = results.filter((r) => ids.includes(r.scenario.id));
    broke = results.filter((r) => !ids.includes(r.scenario.id) && r.outcome === "failed" && !o.open.includes(r.scenario.id));
    const fixed = fixing.length === ids.length && fixing.some((r) => r.outcome === "passed") && fixing.every(settled) && broke.length === 0;
    tries.push({
      summary,
      result: fixed ? "Kane saw it pass." : [...notPassing(fixing), ...broke.map((r) => `It broke "${r.scenario.name}", which passed before.`)].join("; "),
    });
    if (fixed) return end("fixed", attempt);

    const brokeLines = broke.map((r) => {
      const edited = files.filter((f) => touches(r.scenario, f)).join(", ");
      const why = `${r.end?.reason ?? r.error}`;
      return o.checked.includes(r.scenario.id)
        ? `"${r.scenario.name}" passed before your change and fails now: ${why} It covers ${edited}, which you changed.`
        : `"${r.scenario.name}" fails now: ${why} The pull request alone doesn't touch it; it covers ${edited}, which you changed.`;
    });
    const still = o.failures.filter((f) => fixing.some((r) => r.scenario.id === f.id && !settled(r)));
    failures = still.length > 0 ? still : o.failures;
    feedback = [
      `Your change was: ${summary}`,
      still.length > 0
        ? `The scenarios were checked again ${checkedWhere(fixing.map((r) => r.scenario))}:\n${list(notPassing(fixing))}`
        : `The scenarios you were fixing pass now ${checkedWhere(fixing.map((r) => r.scenario))}. Keep that.`,
      ...(broke.length > 0 ? [`But your change broke ${broke.length === 1 ? "a scenario" : "scenarios"} that didn't fail before it:\n${list(brokeLines)}\nFind what in your change did that, and fix it without breaking the others again.`] : []),
    ].join("\n");
  }
  return end("gave-up", max);
}
