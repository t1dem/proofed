import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertSnapshots, expectedText, textContradiction } from "./textcheck.ts";
import { stopping } from "../children.ts";
import { prepareTarget } from "../targets/preparetarget.ts";
import { resolveScenarioTarget, type Target } from "../targets/target.ts";
import { makeClip } from "../targets/clip.ts";
import { live } from "../report/live.ts";
import { NOT_SIGNED_IN } from "../kane/kaneauth.ts";
import { log as logLine } from "../log.ts";
import { runKane, type RunEnd, type Step } from "../kane/kane.ts";

import { NOTHING_CHECKED } from "../report/runfile.ts";
import { scenarioDoubted } from "../report/runresult.ts";
import { startRecorder, type Rect } from "../targets/recorder.ts";
import { checkScenarioId, type Scenario } from "../scenarios.ts";
import { maskSecrets } from "../secrets.ts";
import { timedAsync } from "../timing.ts";
import type { Clip, Outcome, RunEvent, ScenarioResult } from "../types.ts";

// Kane's --timeout counts active time; the wall-clock limit leaves a minute on top, as the defaults do.
const kaneTimeouts = (s: Scenario) => s.timeoutMinutes ? { timeoutSeconds: s.timeoutMinutes * 60, wallTimeoutSeconds: s.timeoutMinutes * 60 + 60 } : {};

// Failures of the browser plumbing rather than of the app: the run is retried, never reported as a bug.
const INFRA = /Screenshot failed|TimeoutError|TargetClosedError|has been closed|ECONNREFUSED|ECONNRESET|socket hang up|Project and folder must be configured/i;

// What Kane said when it left without a verdict. Kane puts the cause on an "error:" line and its
// hints after it, so the last lines alone can start in the middle of a hint.
const NOTICE = /^\s*(?:Skill update available|Update available)\b/i;

export function kaneError(stderr: string) {
  const lines = stderr.trim().split("\n").filter((l) => l.trim() && !NOTICE.test(l));
  const cause = lines.findLast((l) => /^\s*(?:error|fatal)\b/i.test(l));
  return cause ? cause.trim().replace(/^(?:error|fatal):\s*/i, "") : lines.slice(-5).join("\n");
}

// A run cut off by the wall-clock limit. A cloud mobile run that never started a step was still
// waiting for TestMu to hand over a device, which it does with no error while that model is busy.
export function cutOffReason(stderr: string, target: Target, stepsStarted: boolean, seconds = 360) {
  const minutes = Math.round(seconds / 60);
  if ((target.kind === "ios" || target.kind === "android") && target.execution === "cloud" && !stepsStarted) {
    const device = [target.device, target.os_version && `${target.kind === "ios" ? "iOS" : "Android"} ${target.os_version}`].filter(Boolean).join(", ") || target.kind;
    return `TestMu gave Kane no real device (${device}) within ${minutes} minutes; that model may be busy. Pick another from kane-cli devices list --target ${target.kind} --remote.`;
  }
  const last = stderr.trim().split("\n").filter((l) => l.trim() && !NOTICE.test(l)).at(-1)?.trim();
  return `Kane stopped responding and the run was cut off after ${minutes} minutes${last ? `; Kane's last line: ${last}` : ""}`;
}

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

// Each step's remark starts with its kind ("navigate: …", "wait: …", "analyze: …", "assert: …").
// Only an assert compares the page with what the scenario expects.
const checked = (steps: Step[]) => steps.some((s) => s.status === "done" && /^assert:/i.test(s.remark));

// A later successful result for the same step supersedes a failed attempt at that step.
const failedAssert = (steps: Step[]) => steps.findLast((s, i) =>
  s.status === "failed" && /^assert:/i.test(s.remark) && !steps.slice(i + 1).some((later) => later.step === s.step && later.status === "done"));

// Kane ends such a run as "failed" too, but it never looked at the app: a second run can't help and
// there is nothing for a fixer to fix.
const outOfCredits = (end: RunEnd | undefined) => end?.reason_code === "infra_error.credits_exhausted";
const OUT_OF_CREDITS = "The TestMu account Kane runs on is out of credits, so nothing was checked. Top it up, or use the keys of an account that has credits.";

function reconciledEnd(end: RunEnd | undefined, steps: Step[]): RunEnd | undefined {
  if (end && outOfCredits(end)) return { ...end, reason: OUT_OF_CREDITS };
  const failed = end?.status === "passed" && failedAssert(steps);
  return failed && end ? { ...end, status: "failed", reason: failed.remark } : end;
}

export function outcomeOf(end: RunEnd | undefined, steps: Step[]): Outcome {
  // A vague objective lets Kane open the page, wait, and call that a pass.
  if (end?.status === "passed") return failedAssert(steps) ? "failed" : checked(steps) ? "passed" : "unsure";
  if (end?.status !== "failed" || INFRA.test(end.reason ?? "") || end.reason_code?.startsWith("infra_error.")) return "error";
  // An unresolved false assertion is a failure even when Kane blames the scenario.
  return end.verdict?.family === "automation_bug" && !failedAssert(steps) ? "unsure" : "failed";
}

const RECHECK = "the check failed, but Kane blames the scenario; running it once more to be sure";

// Kane is good at reaching a goal, so on its own it routes around a broken button (a key press, another
// link) and passes. A user who clicks the button and gets the wrong screen has found a bug.
// Worded as rules, not a condition: Kane once made "if a click does something other than what the
// step expects" a checkpoint to verify before the first step, and the run ended unchecked.
const NO_WORKAROUNDS =
  "Rules for doing the steps above, not steps or checks of their own: do each step once, the way it is " +
  "described. When a click or a key press does something other than what the step expects, that step " +
  "fails: don't retry it, and don't reach the goal another way (other buttons, links, keyboard " +
  "shortcuts, typing the URL). Waiting for a slow page to load is fine.";

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
  noRetry?: boolean;
  onEvent?: (event: RunEvent) => void;
};

export async function runScenario(scenario: Scenario, o: RunOptions): Promise<ScenarioResult> {
  checkScenarioId(scenario.id);
  let earlier = 0;
  const again = (last: ScenarioResult, why: string) => {
    earlier += last.end?.credits_consumed ?? 0;
    logLine(`[${scenario.id}] ${why}`);
    o.onEvent?.({ type: "retry", id: scenario.id, error: why });
    return runOnce(scenario, o);
  };
  const settle = async (result: ScenarioResult) => {
    for (let i = 2; i <= (o.noRetry ? 1 : o.attempts ?? 2) && result.outcome === "error" && !result.notSignedIn && !outOfCredits(result.end) && !stopping(); i++) {
      result = await again(result, result.error ?? "infra error");
    }
    return result;
  };
  let result = await settle(await runOnce(scenario, o));
  // Kane gives the same verdict for a wrong value all over the app and for a page it misread (a
  // heading that is there, reported as not visible). A wrong value is wrong again on a second
  // run; a misreading rarely is. Disagreement leaves the check unconfirmed.
  if (!o.noRetry && scenarioDoubted(result) && !stopping()) {
    const first = result;
    result = await settle(await again(result, RECHECK));
    if (result.outcome === "passed") {
      result = { ...result, outcome: "unsure", notChecked: "runs_disagreed", end: { ...result.end!, reason: `The two runs disagreed. First run failed: ${first.end?.reason ?? "check failed"} Second run passed: ${result.end?.reason ?? "check passed"}` } };
    }
  }
  return earlier ? { ...result, earlierCredits: earlier } : result;
}

async function runOnce(scenario: Scenario, o: RunOptions): Promise<ScenarioResult> {
  const log = (line: string) => {
    try { logLine(`[${scenario.id}] ${line}`); }
    catch { /* An unwritable output directory can break both the recording and the log. */ }
  };
  const logRecordingFailure = (what: string, error: unknown) => log(`${what} failed: ${String(error)}`);
  const name = JSON.stringify(maskSecrets(scenario.id));
  const kaneRun = (options: Parameters<typeof runKane>[0]) => timedAsync(`Kane scenario ${name}`, () => runKane(options));
  const dir = join(o.outDir, scenario.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  let prepared: Awaited<ReturnType<typeof prepareTarget>>;
  const target = scenario.resolvedTarget ?? resolveScenarioTarget(scenario, {}, process.env, process.cwd());
  try {
    prepared = await prepareTarget(target, { dir, url: target.kind === "web" ? new URL(scenario.url, o.baseUrl).href : undefined, headless: o.headless });
  } catch (e) {
    return { scenario, outcome: "error", steps: [], end: undefined, clip: undefined, error: String(e) };
  }
  let stills: NodeJS.Timeout | undefined;
  const timeouts = kaneTimeouts(scenario);
  try {
    const recorder = prepared.recorder;
    if (!recorder) {
      let nativeClip: Promise<Clip | undefined> | undefined;
      const stopNative = () => {
        const native = prepared.native;
        if (native) return nativeClip ??= timedAsync(`clip encode ${name}`, () => native.stop());
      };
      const kane = await kaneRun({ onEnd: () => { void stopNative()?.catch(() => {}); }, objective: kaneObjective(scenario.objective), ...timeouts, kaneArgs: prepared.kaneArgs, rawFile: join(dir, "kane.ndjson"), username: o.username, accessKey: o.accessKey, onStep: (step) => o.onEvent?.({ type: "step", id: scenario.id, step }) });
      let recordingNote = prepared.metadata.recordingNote;
      const clip = await stopNative()?.catch((e: unknown) => { recordingNote = `Native recording failed: ${String(e)}`; return undefined; });
      const end = reconciledEnd(kane.end, kane.steps);
      const outcome = outcomeOf(kane.end, kane.steps);
      try { writeFileSync(join(dir, "metadata.json"), JSON.stringify({ ...prepared.metadata, recordingNote })); }
      catch (e) { logRecordingFailure("recording metadata", e); }
      const error = kane.timedOut
        ? cutOffReason(kane.stderr, target, kane.steps.length > 0, timeouts.wallTimeoutSeconds)
        : end?.reason || (end ? `Kane ended with status ${end.status}` : kaneError(kane.stderr) || "Kane exited without run_end");
      return {
        scenario, outcome, accountBalance: kane.accountBalance,
        steps: kane.steps.map((s) => ({ ...s, ...(prepared.native && { at: Math.max(0, Date.parse(s.ts) / 1000 - prepared.native.started) }) })),
        end, clip, recordingNote,
        ...(outcome === "error" && { error }),
        ...(!end && { notSignedIn: NOT_SIGNED_IN.test(kane.stderr) }),
      };
    }
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
    const controller = new AbortController();
    recorder.onUnexpectedPage = () => controller.abort();
    if (recorder.unexpectedPage) controller.abort();
    const expected = target.kind === "web" ? expectedText(scenario.objective) : { check: "", literals: [], quoted: false };
    const asserted = assertSnapshots(expected, () => recorder.visibleText());
    const kane = await kaneRun({
      signal: controller.signal,
      objective: kaneObjective(scenario.objective), ...timeouts,
      kaneArgs: prepared.kaneArgs,
      rawFile: join(dir, "kane.ndjson"),
      username: o.username,
      accessKey: o.accessKey,
      onStep: (s) => {
        asserted.step(s);
        live.step(scenario.id, s);
        o.onEvent?.({ type: "step", id: scenario.id, step: s });
        if (s.status !== "running" && s.remark) log(`${s.status === "failed" ? "✗" : "·"} ${s.remark}`);
      },
      onEnd: (end) => (focus = recorder.locate(focusWords(end)).catch(() => undefined)),
    });
    clearInterval(stills);
    // Drop the blank about:blank frames from before Kane's first navigation.
    const start = Date.parse(kane.steps[0]?.ts ?? "") / 1000 || 0;
    // The page reads and focus locator use the connection that stop() closes.
    const assertedText = await asserted.text();
    let focusRect = await focus;
    const frames = target.kind === "web" ? recorder.frames.filter((f) => f.time >= start) : recorder.frames;
    if (!frames.length && target.kind === "web" && !stopping()) {
      log(`No frames selected after Kane's first step (${start}); received ${recorder.frames.length} screencast frames, last at ${recorder.frames.at(-1)?.time ?? "n/a"}`);
      // The live stills are dashboard-only. Take a screenshot before closing the recorder.
      const capture = Promise.withResolvers<never>();
      const timeout = setTimeout(() => capture.reject(new Error("Timed out capturing the page")), 10_000).unref();
      const frame = await Promise.race([recorder.captureFrame(), capture.promise]).catch((e: unknown) => logRecordingFailure("clip screenshot", e));
      clearTimeout(timeout);
      if (frame) {
        frames.push(frame);
        // The screencast's focus rectangle may be from a different tab.
        focusRect = undefined;
      } else {
        // A screencast frame can arrive while we're waiting for the screenshot.
        frames.push(...recorder.frames.filter((f) => f.time >= start));
      }
      if (!frames.length) log("clip skipped: no usable frame or visible page screenshot");
    }
    const verdict = reconciledEnd(kane.end, kane.steps);
    const contradiction = verdict?.status === "passed" ? textContradiction(expected, assertedText) : undefined;
    const outcome = recorder.unexpectedPage ? "error" : contradiction ? "unsure" : outcomeOf(kane.end, kane.steps);
    // Kane left without a verdict: all it said goes to the log, where the cause can be read later.
    if (!kane.end) log(`Kane exited with code ${kane.exitCode} and no verdict${kane.timedOut ? " (cut off by Proofed's time limit)" : ""}. Its stderr:\n${kane.stderr.trim() || "(empty)"}`);
    // Kane's reason for such a pass is "Objective completed"; the report, the run file and the fixer show ours.
    const end = verdict && outcome === "unsure" && verdict.status === "passed" ? { ...verdict, reason: contradiction ?? NOTHING_CHECKED } : verdict;
    log(`→ ${outcome}${end?.reason ? `: ${end.reason}` : ""} (${frames.length} frames)`);
    const error = recorder.unexpectedPage ? "Experimental desktop attach failed: Kane opened another page instead of using the chosen renderer" : kane.timedOut
      ? cutOffReason(kane.stderr, target, kane.steps.length > 0, timeouts.wallTimeoutSeconds)
      : (end?.reason || (end ? `Kane ended with status ${end.status}` : kaneError(kane.stderr) || "Kane exited without run_end"));

    // A step starts when Kane announces it (the "running" event), not when it reports it done.
    const announced = new Map(kane.steps.filter((s) => s.status === "running").map((s) => [s.step, s.ts]));
    const marks = kane.steps.map((s) => Date.parse(announced.get(s.step) ?? s.ts) / 1000);
    const recordingNote = !frames.length && recorder.frameWriteError
      ? `Could not write screencast frames (${String(recorder.frameWriteError)})`
      : undefined;
    const made = await timedAsync(`clip encode ${name}`, async () => {
      const { actions } = recorder.stop();
      if (recordingNote) {
        log(recordingNote);
        return undefined;
      }
      const film = { frames, actions, focus: focusRect };
      writeFileSync(join(dir, "film.json"), JSON.stringify(film));
      const endpoint = prepared.montage ? await prepared.montage() : prepared.clipEndpoint!;
      return makeClip({ ...film, marks, endpoint }, join(dir, "clip"));
    }).catch((e: unknown) => {
      logRecordingFailure("clip", e);
      return undefined;
    });
    const clip = made && { mp4: made.mp4, gif: made.gif, jpg: made.jpg };
    return {
      scenario,
      accountBalance: kane.accountBalance,
      ...(contradiction && { notChecked: "text_contradicted" as const }),
      outcome,
      steps: kane.steps.map((s, i) => ({ ...s, at: made?.marks[i] })),
      end,
      clip,
      ...(recordingNote && { recordingNote }),
      ...(outcome === "error" && { error }),
      ...(!kane.end && NOT_SIGNED_IN.test(kane.stderr) && { notSignedIn: true }),
    };
  } finally {
    clearInterval(stills);
    await prepared.cleanup().catch((e: unknown) => logRecordingFailure("target cleanup", e));
  }
}
