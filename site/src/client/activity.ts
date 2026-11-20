import type { ActivityRun } from "../worker/runs";

export type Verdict = "passed" | "broke" | "unsure";

export type Day = { start: number; passed: number; broke: number; unsure: number; credits: number };

export type Tally = {
  daily: Day[];
  runs: number;
  runsBefore: number;
  // Kane's time in Chrome, all scenarios together.
  seconds: number;
  checked: number;
  passRate: number | null;
  passRateBefore: number | null;
  credits: number;
  creditsBefore: number;
  balance?: number;
  fixes: { tried: number; fixed: number; gaveUp: number; attempts: number; fixedBefore: number };
  models: { model: string; tries: number; attempts: number; fixed: number }[];
  repos: { repo: string; runs: number; broke: number; fixed: number; credits: number; last: number }[];
  breaking: { repo: string; name: string; failed: number; runs: number }[];
};

// A run broke if any scenario failed; otherwise it's unsure if Kane couldn't confirm or finish one.
export function verdictOf(run: ActivityRun): Verdict {
  if (run.scenarios.some((s) => s.outcome === "failed")) return "broke";
  if (run.scenarios.some((s) => s.outcome === "unsure" || s.outcome === "error")) return "unsure";
  return "passed";
}

const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);
const creditsOf = (run: ActivityRun) => sum(run.scenarios.map((s) => s.credits ?? 0));
const passRate = (runs: ActivityRun[]) => {
  const all = runs.flatMap((r) => r.scenarios);
  return all.length ? all.filter((s) => s.outcome === "passed").length / all.length : null;
};

// Midnight, `back` days before today's, in the reader's own time zone.
function dayStart(now: number, back: number) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - back);
  return d.getTime();
}

// The last `days` (today included) against the `days` before them.
export function tally(all: ActivityRun[], days: number, now = Date.now()): Tally {
  const from = dayStart(now, days - 1);
  const before = dayStart(now, 2 * days - 1);
  const runs = all.filter((r) => r.at >= from);
  const earlier = all.filter((r) => r.at >= before && r.at < from);

  const daily: Day[] = Array.from({ length: days }, (_, i) => ({ start: dayStart(now, days - 1 - i), passed: 0, broke: 0, unsure: 0, credits: 0 }));
  for (const run of runs) {
    const day = daily.findLast((d) => d.start <= run.at);
    if (!day) continue;
    day[verdictOf(run)]++;
    day.credits += creditsOf(run);
  }

  const fixRuns = runs.filter((r) => r.fix);
  const models = new Map<string, Tally["models"][number]>();
  for (const { fix } of fixRuns) {
    const m = models.get(fix!.model) ?? { model: fix!.model, tries: 0, attempts: 0, fixed: 0 };
    m.tries++;
    m.attempts += fix!.attempts;
    if (fix!.status === "fixed") m.fixed++;
    models.set(fix!.model, m);
  }

  const repos = new Map<string, Tally["repos"][number]>();
  const scenarios = new Map<string, Tally["breaking"][number]>();
  for (const run of runs) {
    const r = repos.get(run.repo) ?? { repo: run.repo, runs: 0, broke: 0, fixed: 0, credits: 0, last: 0 };
    r.runs++;
    if (verdictOf(run) === "broke") r.broke++;
    if (run.fix?.status === "fixed") r.fixed++;
    r.credits += creditsOf(run);
    r.last = Math.max(r.last, run.at);
    repos.set(run.repo, r);
    for (const s of run.scenarios) {
      const key = `${run.repo}\n${s.name}`;
      const t = scenarios.get(key) ?? { repo: run.repo, name: s.name, failed: 0, runs: 0 };
      t.runs++;
      if (s.outcome === "failed") t.failed++;
      scenarios.set(key, t);
    }
  }

  const latest = runs.filter((r) => r.balance !== undefined).sort((a, b) => b.at - a.at)[0];
  return {
    daily,
    runs: runs.length,
    runsBefore: earlier.length,
    seconds: sum(runs.flatMap((r) => r.scenarios.map((s) => s.seconds ?? 0))),
    checked: sum(runs.map((r) => r.scenarios.length)),
    passRate: passRate(runs),
    passRateBefore: passRate(earlier),
    credits: sum(runs.map(creditsOf)),
    creditsBefore: sum(earlier.map(creditsOf)),
    ...(latest && { balance: latest.balance }),
    fixes: {
      tried: fixRuns.length,
      fixed: fixRuns.filter((r) => r.fix!.status === "fixed").length,
      gaveUp: fixRuns.filter((r) => r.fix!.status === "gave-up").length,
      attempts: sum(fixRuns.map((r) => r.fix!.attempts)),
      fixedBefore: earlier.filter((r) => r.fix?.status === "fixed").length,
    },
    models: [...models.values()].sort((a, b) => b.attempts - a.attempts),
    repos: [...repos.values()].sort((a, b) => b.runs - a.runs),
    breaking: [...scenarios.values()].filter((s) => s.failed > 0).sort((a, b) => b.failed - a.failed || b.failed / b.runs - a.failed / a.runs).slice(0, 5),
  };
}
