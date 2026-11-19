import type { Run, RunScenario } from "./worker/runs";

type Seen = { run: Run; scenario: RunScenario };

// Reports come newest first. Keep each scenario's latest verdict, even if later
// reports only rechecked a subset of the scenarios.
export function latestScenarios(runs: Run[]) {
  const latest = new Map<string, RunScenario>();
  for (const run of runs) for (const scenario of run.scenarios) {
    if (!latest.has(scenario.id)) latest.set(scenario.id, scenario);
  }
  return [...latest.values()];
}

export function scenarioStory(runs: Run[], id: string) {
  const seen = runs.flatMap((run): Seen[] => {
    const scenario = run.scenarios.find((s) => s.id === id);
    return scenario ? [{ run, scenario }] : [];
  });
  const [now, ...earlier] = seen;
  if (!now) return undefined;
  const before = now.scenario.outcome === "passed" ? earlier.find((s) => s.scenario.outcome === "failed") : undefined;
  // Use report order so runs with the same timestamp still have a clear before and after.
  const fix = before && runs.slice(runs.indexOf(now.run), runs.indexOf(before.run)).find((run) => run.fix?.status === "fixed")?.fix;
  return { now, before, fix };
}

export function defaultScenario(runs: Run[], name?: string) {
  const scenarios = latestScenarios(runs);
  return scenarios.find((s) => s.name === name)
    ?? (runs[0]?.fix?.status === "fixed" ? scenarios.find((s) => scenarioStory(runs, s.id)?.before) : undefined)
    ?? scenarios.find((s) => s.outcome !== "passed")
    ?? scenarios[0];
}

export function fixedSummary(runs: Run[], provider: string) {
  const scenarios = latestScenarios(runs);
  const unresolved = scenarios.filter((s) => s.outcome !== "passed");
  if (unresolved.length === 0) return `${provider} fixed it, Kane confirmed`;
  const repaired = scenarios.filter((s) => scenarioStory(runs, s.id)?.before);
  return [
    repaired.length ? `${repaired.map((s) => s.name).join(", ")} fixed` : `${provider} committed a fix`,
    ...unresolved.map((s) => `${s.name} ${s.outcome === "failed" ? "still broken" : s.outcome === "error" ? "unfinished" : "unconfirmed"}`),
  ].join("; ");
}

// This is the total Kane reported in the loaded history, not an account debit.
// Do not count a report twice if the same key is present more than once.
export function creditSummary(runs: Run[], latest = true) {
  const reports = [...new Map(runs.map((r) => [r.key, r])).values()];
  const costs = reports.map((r) => r.scenarios.reduce((sum, s) => sum + (s.credits ?? 0), 0));
  const reported = costs.filter((credits) => credits > 0);
  if (reported.length > 1) return `${Math.round(reported.reduce((sum, credits) => sum + credits, 0))} credits across ${reported.length} reports (Kane estimate)`;
  if ((costs[0] ?? 0) > 0) return `${Math.round(costs[0]!)} credits, ${latest ? "latest" : "this"} check (Kane estimate)`;
  if (reported.length) return `${Math.round(reported[0]!)} credits in earlier reports (Kane estimate)`;
  return undefined;
}
