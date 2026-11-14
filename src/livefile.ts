// A run that is still going, as the action sends it to Proofed's server while it works (live.ts)
// and the dashboard shows it. No imports, so the Worker can load it as well as the action.

// "waiting": in line for a Chrome; "running": Kane is on it; the rest is how it ended.
export type LiveStatus = "waiting" | "running" | "passed" | "failed" | "unsure" | "error";

// One of Kane's steps as it happens: the step it's on comes in "running" and turns done or failed.
export type LiveStep = { n: number; remark: string; status: "running" | "done" | "failed" };

export type LiveScenario = { id: string; name: string; status: LiveStatus; steps: LiveStep[]; startedAt?: number };

// What the fixer is doing in an attempt. "writing": Claude Code is at work; "building": the app is
// built with the change; "checking": Kane runs the broken scenarios on it; "pushing": it passed.
export type LiveDoing = "writing" | "building" | "checking" | "pushing";

export type LiveFix = {
  attempt: number;
  of: number;
  doing: LiveDoing;
  model: string;
  effort: string;
  // Attempts that didn't work: what Claude changed, and why it wasn't enough.
  tries: { summary: string; result: string }[];
};

export type Live = {
  // The Actions run this is: a new one starts the pull request's live state over.
  run: string;
  pr: number;
  sha: string;
  kind: "check" | "fix";
  startedAt: number;
  runUrl?: string;
  scenarios: LiveScenario[];
  fix?: LiveFix;
};

const STATUSES: LiveStatus[] = ["waiting", "running", "passed", "failed", "unsure", "error"];
const DOINGS: LiveDoing[] = ["writing", "building", "checking", "pushing"];
const MAX_SCENARIOS = 20;
const MAX_STEPS = 40;

const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");
const count = (value: unknown) => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined);
const time = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined);

// Anyone whose workflow can get a token for the repository can post this, so it's read field by
// field: only what the dashboard shows, of the expected types, capped in size.
export function readLive(input: unknown): Live | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const o = input as Record<string, unknown>;
  const pr = count(o.pr);
  const run = text(o.run, 64);
  const startedAt = time(o.startedAt);
  if (!pr || !run || !startedAt || !Array.isArray(o.scenarios)) return undefined;
  const scenarios = o.scenarios.slice(0, MAX_SCENARIOS).flatMap((s): LiveScenario[] => {
    if (typeof s !== "object" || s === null) return [];
    const r = s as Record<string, unknown>;
    const status = STATUSES.find((x) => x === r.status);
    const id = text(r.id, 100);
    if (!status || !id) return [];
    const steps = (Array.isArray(r.steps) ? r.steps : []).slice(-MAX_STEPS).flatMap((step): LiveStep[] => {
      if (typeof step !== "object" || step === null) return [];
      const t = step as Record<string, unknown>;
      const n = count(t.n);
      const stepStatus = (["running", "done", "failed"] as const).find((x) => x === t.status);
      return n !== undefined && stepStatus ? [{ n, remark: text(t.remark, 200), status: stepStatus }] : [];
    });
    return [{ id, name: text(r.name, 200) || id, status, steps, startedAt: time(r.startedAt) }];
  });
  const f = typeof o.fix === "object" && o.fix !== null ? (o.fix as Record<string, unknown>) : undefined;
  const doing = DOINGS.find((x) => x === f?.doing);
  const fix: LiveFix | undefined =
    f && doing
      ? {
          attempt: count(f.attempt) ?? 1,
          of: count(f.of) ?? 1,
          doing,
          model: text(f.model, 80),
          effort: text(f.effort, 20),
          tries: (Array.isArray(f.tries) ? f.tries : []).slice(0, 5).map((t) => {
            const r = (typeof t === "object" && t !== null ? t : {}) as Record<string, unknown>;
            return { summary: text(r.summary, 500), result: text(r.result, 500) };
          }),
        }
      : undefined;
  const runUrl = text(o.runUrl, 300);
  return {
    run,
    pr,
    sha: text(o.sha, 40),
    kind: o.kind === "fix" ? "fix" : "check",
    startedAt,
    ...(runUrl.startsWith("https://github.com/") && { runUrl }),
    scenarios,
    ...(fix && { fix }),
  };
}

// What the inbox says about a busy pull request: where the run is, in a line.
export type LiveSummary = {
  kind: Live["kind"];
  total: number;
  done: number;
  // The scenario Kane is on, and its latest step.
  scenario?: string;
  step?: string;
  fix?: Pick<LiveFix, "attempt" | "of" | "doing">;
};

export function summarize(live: Live): LiveSummary {
  const on = live.scenarios.find((s) => s.status === "running");
  const step = on?.steps.findLast((s) => s.remark)?.remark;
  return {
    kind: live.kind,
    total: live.scenarios.length,
    done: live.scenarios.filter((s) => s.status !== "waiting" && s.status !== "running").length,
    ...(on && { scenario: on.name }),
    ...(step && { step }),
    ...(live.fix && { fix: { attempt: live.fix.attempt, of: live.fix.of, doing: live.fix.doing } }),
  };
}
