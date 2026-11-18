import type { RunEnd, Step } from "./kane/kane.ts";
import type { Scenario } from "./scenarios.ts";

// "unsure": the run says nothing about the code. Either Kane decided the test itself looks wrong
// before it could check the page (verdict family automation_bug, no failed assert), or it reported
// a pass without checking anything (see outcomeOf).
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
  recordingNote?: string;
  accountBalance?: { before: number; after: number; debit: number };
  notChecked?: "runs_disagreed" | "text_contradicted";
  // The fixer had a previous failure but could not reconstruct or run the request.
  requestUnavailable?: true;
  // The uncaught exception that left the page blank, when Proofed failed the scenario before Kane ran (precheck.ts).
  pageError?: string;
  // Wall time of the run, retries included.
  seconds?: number;
  // What the runs before this one took (an automatic retry, a second run of a doubted failure); `end` holds only the last.
  earlierCredits?: number;
  // Kane refused to start for want of a login: an error a retry can't fix.
  notSignedIn?: boolean;
};

// What a run reports as it goes, for a terminal to draw (src/proofed.ts). The PR check doesn't listen.
export type RunEvent =
  | { type: "waiting"; id: string }
  | { type: "started"; id: string }
  | { type: "step"; id: string; step: Step }
  | { type: "retry"; id: string; error: string }
  | { type: "finished"; id: string; result: ScenarioResult };
