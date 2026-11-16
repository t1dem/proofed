// Results as runScenario returns them, for the tests of what the CLI makes of them.
import type { RunEnd, Step } from "../kane.ts";
import type { Item } from "../result.ts";
import type { Outcome, ScenarioResult } from "../run.ts";
import type { Scenario } from "../scenarios.ts";

export const scenario = (id: string, name = id): Scenario => ({ id, name, file: `.proofed/scenarios/${id}.md`, paths: [], url: "/", objective: `Check ${name}.` });
const step = (remark: string, status: Step["status"] = "done"): Step => ({ step: 1, status, remark, ts: "" });

export function ran(id: string, outcome: Outcome, end?: Partial<RunEnd>, extra: Partial<ScenarioResult> & { name?: string } = {}): Item & { result: ScenarioResult } {
  const { name, ...rest } = extra;
  const s = scenario(id, name);
  return {
    scenario: s,
    result: {
      scenario: s,
      outcome,
      steps: [step("navigate: Navigate to /"), outcome === "failed" ? step("assert: shipping is €4.90", "failed") : step("assert: ok")],
      end: end && { type: "run_end", status: "failed", ...end },
      clip: { mp4: "/out/x/clip.mp4", gif: "/out/x/clip.gif", jpg: "/out/x/clip.jpg" },
      seconds: 70,
      ...rest,
    },
  };
}
