import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stopping } from "./children.ts";
import { launchChrome } from "./chrome.ts";
import { makeClip } from "./clip.ts";
import { live } from "./live.ts";
import { log as logLine } from "./log.ts";
import { runKane, type RunEnd, type Step } from "./kane.ts";
import { NOTHING_CHECKED } from "./runfile.ts";
import { startRecorder, type Rect } from "./recorder.ts";
import type { Scenario } from "./scenarios.ts";

// "unsure": the run says nothing about the code. Either Kane decided the test itself looks wrong
// (verdict family automation_bug), or it reported a pass without checking anything (see outcomeOf).
// Worth showing, not worth blocking a merge over, and never counted as a pass.
export type Outcome = "passed" | "failed" | "unsure" | "error";

// Files of a run's recording: the video, its GIF and the still it ends on. A page that crashed on
// load (precheck.ts) has only a screenshot: Kane never ran, so there is nothing to play.
export type Clip = { mp4: string; gif: string; jpg: string } | { jpg: string; mp4?: undefined; gif?: undefined };

// `at`: where the step starts in the clip, in seconds; the dashboard jumps there from the step.
export type RunStep = Step & { at?: number };

export type ScenarioResult = {
  scenario: Scenario;
  outcome: Outcome;
  steps: RunStep[];
  end: RunEnd | undefined;
  clip: Clip | undefined;
  error?: string;
  // The uncaught exception that left the page blank, when Proofed failed the scenario before Kane ran (precheck.ts).
  pageError?: string;
  // Wall time of the run, retries included.
  seconds?: number;
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

export { NOTHING_CHECKED };

// Each step's remark starts with its kind ("navigate: …", "wait: …", "analyze: …", "assert: …").
// Only an assert compares the page with what the scenario expects.
const checked = (steps: Step[]) => steps.some((s) => s.status === "done" && /^assert:/i.test(s.remark));

export function outcomeOf(end: RunEnd | undefined, steps: Step[]): Outcome {
  if (!end || INFRA.test(end.reason ?? "")) return "error";
  // A vague objective lets Kane open the page, wait, and call that a pass.
  if (end.status === "passed") return checked(steps) ? "passed" : "unsure";
  return end.verdict?.family === "automation_bug" ? "unsure" : "failed";
}

// An unsure run where Kane said "passed": nothing was checked, as opposed to Kane doubting the test.
export const unchecked = (r: ScenarioResult) => r.outcome === "unsure" && r.end?.status === "passed";

// Kane is good at reaching a goal, so on its own it routes around a broken button (a key press, another
// link) and passes. A user who clicks the button and gets the wrong screen has found a bug.
const NO_WORKAROUNDS =
  "Do each step once, the way it is described. If a click or a key press does something other than what " +
  "the step expects, the check fails: don't retry it, and don't reach the goal another way (other " +
  "buttons, links, keyboard shortcuts, typing the URL). Waiting for a slow page to load is fine.";

export function kaneObjective(objective: string) {
  return `${objective}\n\n${NO_WORKAROUNDS}`;
}

// What a run reports as it goes, for a terminal to draw (src/proofed.ts). The PR check doesn't listen.
export type RunEvent =
  | { type: "waiting"; id: string }
  | { type: "started"; id: string }
  | { type: "step"; id: string; step: Step }
  | { type: "retry"; id: string; error: string }
  | { type: "finished"; id: string; result: ScenarioResult };

type RunOptions = {
  baseUrl: string;
  outDir: string;
  username?: string;
  accessKey?: string;
  headless?: boolean;
  attempts?: number;
  onEvent?: (event: RunEvent) => void;
};

export async function runScenario(scenario: Scenario, o: RunOptions): Promise<ScenarioResult> {
  let result = await runOnce(scenario, o);
  for (let i = 2; i <= (o.attempts ?? 2) && result.outcome === "error" && !stopping(); i++) {
    logLine(`[${scenario.id}] ${result.error ?? "infra error"}; retrying`);
    o.onEvent?.({ type: "retry", id: scenario.id, error: result.error ?? "infra error" });
    result = await runOnce(scenario, o);
  }
  return result;
}

async function runOnce(scenario: Scenario, o: RunOptions): Promise<ScenarioResult> {
  const log = (line: string) => logLine(`[${scenario.id}] ${line}`);
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
  let stills: NodeJS.Timeout | undefined;
  try {
    const recorder = await startRecorder(chrome.endpoint, join(dir, "frames"));
    live.scenario(scenario.id, { status: "running", steps: [], startedAt: Date.now() });
    // A still for each click or typing with the cursor on it: the frame from just before it, or a
    // new screenshot when there is none to use. Between actions, one every couple of seconds.
    const still = (action: boolean) => {
      if (live.on()) void recorder.snapshot().then((s) => s && live.frame(scenario.id, s, action));
    };
    recorder.onAction = (before) => {
      if (before) live.frame(scenario.id, before, true);
      else still(true);
    };
    stills = setInterval(() => still(false), 2000);
    let focus: Promise<Rect | undefined> = Promise.resolve(undefined);
    const kane = await runKane({
      objective: kaneObjective(scenario.objective),
      url: new URL(scenario.url, o.baseUrl).href,
      cdpEndpoint: chrome.endpoint,
      username: o.username,
      accessKey: o.accessKey,
      onStep: (s) => {
        live.step(scenario.id, s);
        o.onEvent?.({ type: "step", id: scenario.id, step: s });
        if (s.status !== "running" && s.remark) log(`${s.status === "failed" ? "✗" : "·"} ${s.remark}`);
      },
      onEnd: (end) => (focus = recorder.locate(focusWords(end))),
    });
    clearInterval(stills);
    const focusRect = await focus;
    // Drop the blank about:blank frames from before Kane's first navigation.
    const start = Date.parse(kane.steps[0]?.ts ?? "") / 1000 || 0;
    const recorded = recorder.stop();
    const frames = recorded.frames.filter((f) => f.time >= start);
    const outcome = outcomeOf(kane.end, kane.steps);
    // Kane left without a verdict: all it said goes to the log, where the cause can be read later.
    if (!kane.end) log(`Kane exited with code ${kane.exitCode} and no verdict${kane.timedOut ? " (cut off by Proofed's time limit)" : ""}. Its stderr:\n${kane.stderr.trim() || "(empty)"}`);
    // Kane's reason for such a pass is "Objective completed"; the report, the run file and the fixer show ours.
    const end = kane.end && outcome === "unsure" && kane.end.status === "passed" ? { ...kane.end, reason: NOTHING_CHECKED } : kane.end;
    log(`→ ${outcome}${end?.reason ? `: ${end.reason}` : ""} (${frames.length} frames)`);
    const error = kane.timedOut
      ? "Kane stopped responding and the run was cut off"
      : (kane.end?.reason ?? kane.stderr.trim().split("\n").slice(-5).join("\n"));
    const film = { frames, actions: recorded.actions, focus: focusRect };
    writeFileSync(join(dir, "film.json"), JSON.stringify(film));
    // A step starts when Kane announces it (the "running" event), not when it reports it done.
    const announced = new Map(kane.steps.filter((s) => s.status === "running").map((s) => [s.step, s.ts]));
    const marks = kane.steps.map((s) => Date.parse(announced.get(s.step) ?? s.ts) / 1000);
    const made = await makeClip(
      { ...film, marks, endpoint: chrome.endpoint },
      join(dir, "clip"),
    ).catch((e: unknown) => {
      log(`clip failed: ${String(e)}`);
      return undefined;
    });
    const clip = made && { mp4: made.mp4, gif: made.gif, jpg: made.jpg };
    return {
      scenario,
      outcome,
      steps: kane.steps.map((s, i) => ({ ...s, at: made?.marks[i] })),
      end,
      clip,
      ...(outcome === "error" && { error }),
    };
  } finally {
    clearInterval(stills);
    chrome.close();
  }
}
