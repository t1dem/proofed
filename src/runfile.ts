// The run file: what one published report was made of, saved as `<key>/run.json` next to its
// clips on the proofed-clips branch. The comment names the folder, and the dashboard reads the
// file from there. Imported by the dashboard (site/) too, so no imports and nothing Node-specific.
export type RunScenario = {
  id: string;
  name: string;
  outcome: "passed" | "failed" | "unsure" | "error";
  reason?: string;
  failedCheck?: "scenario_doubted";
  diagnosis?: string;
  suggestion?: string;
  // `at`: seconds into the clip where the step starts (runs from before it was kept have none).
  steps?: { remark: string; failed?: boolean; at?: number }[];
  clip?: { mp4?: string; gif?: string; jpg?: string };
  credits?: number;
  creditsSource?: "kane_estimate";
  accountBalance?: { before: number; after: number; debit: number };
  seconds?: number;
};

export type RunFix = {
  status: "fixed" | "gave-up";
  model: string;
  effort: string;
  summary: string;
  commit?: string;
  attempts?: { summary: string; result: string }[];
  files?: { path: string; added: number; removed: number }[];
};

export type RunFile = { sha: string; scenarios: RunScenario[]; skipped?: string[]; fix?: RunFix; runUrl?: string };

// The reason of a scenario Kane called passed without asserting anything; the dashboard words such a
// scenario as "not checked" by it.
export const NOTHING_CHECKED = "Kane finished without checking anything on the page.";

// The reason of a scenario whose start page crashed on load, so Kane never ran (src/precheck.ts).
export const BLANK_PAGE = "The page is blank: it crashed while loading, before anything could be checked.";

export const RUN_FILE = "run.json";
export const runMarker = (key: string) => `<!-- proofed:run ${key} -->`;
export const readRunKey = (body: string) => /<!-- proofed:run (pr-\d+\/[\w.-]+) -->/.exec(body)?.[1];

// A refuted check stays a failure even when Kane blames the scenario. Consumers share the next step.
export const FAILED_CHECK_REASON = "The scenario's check did not hold on the page. Kane believes the scenario is out of date.";
export const FAILED_CHECK_ACTION = "If the change in the app was intended, update the scenario; otherwise fix the app.";
