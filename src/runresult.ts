import type { ScenarioResult } from "./types.ts";

// An unsure run where Kane said "passed": nothing was checked, as opposed to Kane doubting the test.
export const unchecked = (r: ScenarioResult) => r.outcome === "unsure" && r.end?.status === "passed" && !r.notChecked;

export const scenarioDoubted = (r: ScenarioResult) => r.outcome === "failed" && r.end?.verdict?.family === "automation_bug";

// All the credits a scenario took, the runs before the last one included.
export const creditsOf = (r: ScenarioResult) => (r.end?.credits_consumed ?? 0) + (r.earlierCredits ?? 0);
