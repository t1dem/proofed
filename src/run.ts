import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { launchChrome } from "./chrome.ts";
import { makeClip } from "./clip.ts";
import { runKane, type RunEnd, type Step } from "./kane.ts";
import { startRecorder } from "./recorder.ts";
import type { Scenario } from "./scenarios.ts";

// "unsure" is Kane telling us the test itself looks wrong (verdict family automation_bug):
// worth showing, not worth blocking a merge over.
export type Outcome = "passed" | "failed" | "unsure" | "error";

export type ScenarioResult = {
  scenario: Scenario;
  outcome: Outcome;
  steps: Step[];
  end: RunEnd | undefined;
  clip: { mp4: string; gif: string } | undefined;
  error?: string;
};

// Failures of the browser plumbing rather than of the app: the run is retried, never reported as a bug.
const INFRA = /Screenshot failed|TimeoutError|TargetClosedError|has been closed|ECONNREFUSED|ECONNRESET|socket hang up|Project and folder must be configured/i;

export function outcomeOf(end: RunEnd | undefined): Outcome {
  if (!end || INFRA.test(end.reason ?? "")) return "error";
  if (end.status === "passed") return "passed";
  return end.verdict?.family === "automation_bug" ? "unsure" : "failed";
}

type RunOptions = {
  baseUrl: string;
  outDir: string;
  username?: string;
  accessKey?: string;
  headless?: boolean;
  attempts?: number;
};

export async function runScenario(scenario: Scenario, o: RunOptions): Promise<ScenarioResult> {
  let result = await runOnce(scenario, o);
  for (let i = 2; i <= (o.attempts ?? 2) && result.outcome === "error"; i++) {
    console.log(`[${scenario.id}] ${result.error ?? "infra error"}; retrying`);
    result = await runOnce(scenario, o);
  }
  return result;
}

async function runOnce(scenario: Scenario, o: RunOptions): Promise<ScenarioResult> {
  const log = (line: string) => console.log(`[${scenario.id}] ${line}`);
  const dir = join(o.outDir, scenario.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const chrome = await launchChrome({ headless: o.headless ?? true });
  try {
    const recorder = await startRecorder(chrome.endpoint, join(dir, "frames"));
    const kane = await runKane({
      objective: scenario.objective,
      url: new URL(scenario.url, o.baseUrl).href,
      cdpEndpoint: chrome.endpoint,
      username: o.username,
      accessKey: o.accessKey,
      onStep: (s) => s.status !== "running" && s.remark && log(`${s.status === "failed" ? "✗" : "·"} ${s.remark}`),
    });
    // Drop the blank about:blank frames from before Kane's first navigation.
    const start = Date.parse(kane.steps[0]?.ts ?? "") / 1000 || 0;
    const frames = recorder.stop().filter((f) => f.time >= start);
    const outcome = outcomeOf(kane.end);
    log(`→ ${outcome}${kane.end?.reason ? `: ${kane.end.reason}` : ""} (${frames.length} frames)`);
    const error = kane.timedOut
      ? "Kane stopped responding and the run was cut off"
      : (kane.end?.reason ?? kane.stderr.trim().split("\n").slice(-5).join("\n"));
    return {
      scenario,
      outcome,
      steps: kane.steps,
      end: kane.end,
      clip: makeClip(frames, join(dir, "clip")),
      ...(outcome === "error" && { error }),
    };
  } finally {
    chrome.close();
  }
}
