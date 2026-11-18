import { checkedAt } from "./fixtarget.ts";
import type { Step } from "./kane.ts";
import { isDescriptionScenario, type descriptionCheckNote } from "./requests.ts";
import { scenarioDoubted } from "./runresult.ts";
import type { ScenarioResult } from "./types.ts";
import type { Scenario } from "./scenarios.ts";

export { readRunKey, runMarker } from "./runfile.ts";

export type ClipLinks = { gif?: string; mp4?: string; jpg?: string };

// What the fix workflow needs to know about a failure, kept in the comment itself
// so the fix run doesn't depend on artifacts from another workflow.
// `clip` is the "before" side of the report after a fix; reports written before it existed have none.
export type FailureData = {
  id: string;
  name: string;
  file: string;
  objective: string;
  reason: string;
  diagnosis: string;
  checkedAt?: string;
  failedCheck?: "scenario_doubted";
  steps: string[];
  clip?: ClipLinks;
};
// "unsure": nothing broke, but a scenario wasn't confirmed either (run.ts), so the run isn't a pass.
export type RunState = "failed" | "passed" | "fixed" | "error" | "unsure";
export type RunEntry = { sha: string; state: RunState };
// `asked`: one-off checks from the PR description or a /proofed comment, kept so the fixer can re-run them.
// `history`: one entry per published report, newest last.
// `open`: the scenarios that didn't pass (failed, couldn't finish, not confirmed); left out when there are none.
export type ReportData = { sha: string; failures: FailureData[]; asked?: Scenario[]; history?: RunEntry[]; open?: string[]; descriptionNote?: ReturnType<typeof descriptionCheckNote> };

const DATA_RE = /<!-- proofed:data (.*?) -->/s;
export const COMMENT_LIMIT = 65_536;
const HISTORY_SIZE = 8;
export const MAX_STEPS = 30;
const MAX_STEP = 200;

export function readReportData(body: string): ReportData | undefined {
  const raw = DATA_RE.exec(body)?.[1];
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as ReportData;
  } catch {
    return undefined;
  }
}

// A push of the very commit the report is about: the Proofed app pushing the fixer's fix, which the fix
// run checked and reported before it ended. Any other push brings a new commit, and a /proofed
// comment always runs, whatever the commit.
export const alreadyReported = (action: string | undefined, headSha: string, report: ReportData | undefined) =>
  action === "synchronize" && report?.sha === headSha;

// JSON inside an HTML comment: "--" would end the comment early, so escape it.
export const dataComment = (data: ReportData) => `<!-- proofed:data ${JSON.stringify(data).replaceAll("--", "\\u002d\\u002d")} -->`;

// What a report says: the overall state, as the dashboard reads it, and which scenarios aren't passing.
export type Outcome = { state: "passing" | "failing" | "blocked"; open: string[] };
const STATES: Record<RunState, Outcome["state"]> = { failed: "failing", error: "blocked", passed: "passing", fixed: "passing", unsure: "passing" };

// Reports from before `open` was kept name only the failures.
export function outcomeOf(data: ReportData): Outcome {
  const last = data.history?.at(-1);
  const state = last?.sha === data.sha ? STATES[last.state] : data.failures.length > 0 ? "failing" : "passing";
  return { state, open: [...(data.open ?? data.failures.map((f) => f.id))].sort() };
}

// GitHub notifies on a new comment, not on an edit. So a report is posted anew when someone should hear
// of it: the first report, a run a person asked for or a fix that ended (`notify`), or an outcome that
// changed. A push that finds the same as the current report only updates it.
export function postsNew(current: string | undefined, next: string, notify: boolean) {
  if (notify || current === undefined) return true;
  const was = readReportData(current);
  const now = readReportData(next);
  if (!was || !now) return true;
  // A fix's report keeps its before and after: the next commit gets its own.
  if (was.sha !== now.sha && was.history?.at(-1)?.state === "fixed") return true;
  const [a, b] = [outcomeOf(was), outcomeOf(now)];
  return a.state !== b.state || a.open.join("\n") !== b.open.join("\n");
}

// A re-run on the same commit replaces its entry. Re-checking a commit Claude pushed keeps it a fix.
export function addRun(history: RunEntry[] = [], run: RunEntry): RunEntry[] {
  const last = history.at(-1);
  if (last?.sha !== run.sha) return [...history, run].slice(-HISTORY_SIZE);
  const state = last.state === "fixed" && run.state === "passed" ? "fixed" : run.state;
  return [...history.slice(0, -1), { sha: run.sha, state }].slice(-HISTORY_SIZE);
}

// Kane's and the fixer's words on one line, cut to `max` characters.
export const oneLine = (text = "", max = 300) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

// The before/after table needs the video and a picture; the GIF only stands in for a missing still.
function storedClip(links: ClipLinks | undefined): ClipLinks | undefined {
  if (!links?.mp4 && !links?.jpg && !links?.gif) return undefined;
  return links.jpg ? { mp4: links.mp4, jpg: links.jpg } : { mp4: links.mp4, gif: links.gif };
}

// The last `keep` steps Kane finished, each cut to MAX_STEP characters.
export function kaneSteps(steps: Step[], keep = MAX_STEPS) {
  const done = steps.filter((s) => s.status !== "running" && s.remark);
  const from = Math.max(done.length - keep, 0);
  return {
    from: from + 1,
    steps: done.slice(from).map((s) => ({ failed: s.status === "failed", text: oneLine(s.remark, MAX_STEP) })),
  };
}

export function collectReportData({
  sha, failed, open, asked, descriptionNote, clips, storedSteps, history,
}: {
  sha: string;
  failed: ScenarioResult[];
  open: string[];
  asked?: Scenario[];
  descriptionNote: ReportData["descriptionNote"];
  clips: Map<string, ClipLinks>;
  storedSteps: number;
  history: RunEntry[];
}): ReportData {
  const rerun = asked?.filter((s) => !descriptionNote || !isDescriptionScenario(s));
  return {
    sha,
    ...(rerun?.length && { asked: rerun }),
    ...(descriptionNote && { descriptionNote }),
    failures: failed.map((r) => ({
      id: r.scenario.id,
      name: r.scenario.name,
      file: r.scenario.file,
      objective: r.scenario.objective,
      checkedAt: checkedAt(r.scenario),
      reason: r.end?.reason ?? "",
      diagnosis: r.end?.verdict?.root_cause ?? r.end?.summary ?? "",
      ...(scenarioDoubted(r) && { failedCheck: "scenario_doubted" as const }),
      steps: kaneSteps(r.steps, storedSteps).steps.map((s) => `${s.failed ? "✗" : "·"} ${s.text}`),
      clip: storedClip(clips.get(r.scenario.id)),
    })),
    history,
    ...(open.length && { open }),
  };
}

// Try these in order to keep as much metadata as the comment limit allows.
export function compactReportData(data: ReportData): ReportData[] {
  const { asked: _asked, failures, ...outcome } = data;
  // The fixer can re-read file-backed objectives. Ad hoc objectives aren't stored anywhere else.
  const compact = failures.map((f) => ({ ...f, objective: "", steps: [] }));
  const { open: _open, ...historyOnly } = outcome;
  // Keep valid metadata for the whole report even when the failure records won't fit.
  return [
    { ...outcome, failures: compact },
    { ...outcome, failures: compact.filter((f) => f.file).map(({ id, name, file, failedCheck }) => ({
      id, name, file, failedCheck, objective: "", steps: [], reason: "", diagnosis: "",
    })) },
    { ...outcome, failures: [] },
    { ...historyOnly, failures: [] },
  ];
}
