import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchChrome } from "./chrome.ts";
import { makeClip } from "./clip.ts";
import { runKane, type RunEnd, type Step } from "./kane.ts";
import { startRecorder, type Rect } from "./recorder.ts";
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

// Words of what the run checked last: the quoted expectation of a failed check, or the values
// Kane read off the page when it passed. The clip ends zoomed on the element that holds them.
const STOP = new Set(["that", "this", "with", "from", "have", "after", "then", "should", "shows", "page", "into", "when", "each", "there", "them", "than", "what", "which", "only", "also", "visible", "displayed"]);

export function focusWords(end: RunEnd) {
  const text =
    end.status === "passed"
      ? Object.values(end.final_state ?? {})
          .filter((v) => typeof v === "string" && !v.startsWith("http"))
          .join(" ")
      : (/["“«]([^"”»]+)["”»]/.exec(end.reason ?? "")?.[1] ?? "");
  const words = (text.toLowerCase().replace(/[‘’]/g, "'").match(/[\p{L}\p{Sc}\d][\p{L}\p{N}\p{Sc}.,%'-]*/gu) ?? [])
    .map((w) => w.replace(/[.,]+$/, ""))
    .filter((w) => (/\d/.test(w) ? w.length >= 2 : w.length >= 4) && !STOP.has(w));
  return [...new Set(words)];
}

export function outcomeOf(end: RunEnd | undefined): Outcome {
  if (!end || INFRA.test(end.reason ?? "")) return "error";
  if (end.status === "passed") return "passed";
  return end.verdict?.family === "automation_bug" ? "unsure" : "failed";
}

// Kane is good at reaching a goal, so on its own it routes around a broken button (a key press, another
// link) and passes. A user who clicks the button and gets the wrong screen has found a bug.
const NO_WORKAROUNDS =
  "Do each step once, the way it is described. If a click or a key press does something other than what " +
  "the step expects, the check fails: don't retry it, and don't reach the goal another way (other " +
  "buttons, links, keyboard shortcuts, typing the URL). Waiting for a slow page to load is fine.";

export function kaneObjective(objective: string) {
  return `${objective}\n\n${NO_WORKAROUNDS}`;
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

  let chrome: Awaited<ReturnType<typeof launchChrome>>;
  try {
    chrome = await launchChrome({ headless: o.headless ?? true });
  } catch (e) {
    // Counts as a browser hiccup: retried, and reported as "couldn't finish", never as a bug.
    return { scenario, outcome: "error", steps: [], end: undefined, clip: undefined, error: String(e) };
  }
  try {
    const recorder = await startRecorder(chrome.endpoint, join(dir, "frames"));
    let focus: Promise<Rect | undefined> = Promise.resolve(undefined);
    const kane = await runKane({
      objective: kaneObjective(scenario.objective),
      url: new URL(scenario.url, o.baseUrl).href,
      cdpEndpoint: chrome.endpoint,
      username: o.username,
      accessKey: o.accessKey,
      onStep: (s) => s.status !== "running" && s.remark && log(`${s.status === "failed" ? "✗" : "·"} ${s.remark}`),
      onEnd: (end) => (focus = recorder.locate(focusWords(end))),
    });
    const focusRect = await focus;
    // Drop the blank about:blank frames from before Kane's first navigation.
    const start = Date.parse(kane.steps[0]?.ts ?? "") / 1000 || 0;
    const recorded = recorder.stop();
    const frames = recorded.frames.filter((f) => f.time >= start);
    const outcome = outcomeOf(kane.end);
    log(`→ ${outcome}${kane.end?.reason ? `: ${kane.end.reason}` : ""} (${frames.length} frames)`);
    const error = kane.timedOut
      ? "Kane stopped responding and the run was cut off"
      : (kane.end?.reason ?? kane.stderr.trim().split("\n").slice(-5).join("\n"));
    const film = { frames, actions: recorded.actions, focus: focusRect };
    writeFileSync(join(dir, "film.json"), JSON.stringify(film));
    const clip = await makeClip(
      { ...film, endpoint: chrome.endpoint },
      join(dir, "clip"),
    ).catch((e: unknown) => {
      log(`clip failed: ${String(e)}`);
      return undefined;
    });
    return {
      scenario,
      outcome,
      steps: kane.steps,
      end: kane.end,
      clip,
      ...(outcome === "error" && { error }),
    };
  } finally {
    chrome.close();
  }
}
