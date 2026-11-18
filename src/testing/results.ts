// Results as runScenario returns them, for the tests of what the CLI makes of them.
import type { RunEnd, Step } from "../kane.ts";
import type { Item } from "../result.ts";
import type { Outcome, ScenarioResult } from "../types.ts";
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

export const refuted = () => ran("free-shipping", "failed", {
  reason: 'Final verification failed: "shipping is now Free and the total is €51.00."',
  credits_consumed: 27.42,
  verdict: {
    family: "automation_bug",
    root_cause: "The test used the wrong free-shipping threshold. The cart subtotal was €51.00, below the €60.00 threshold shown by the store.",
    suggestion: "Update the test expectation: shipping should remain €4.90 at a €51.00 subtotal.",
  },
}, { name: "Free shipping from €50" });
