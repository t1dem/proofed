// The result of `proofed check` as one JSON document: what `--json` prints, what <out>/result.json
// holds, and what the terminal views draw from. Its names are the CLI's contract with coding agents.
import { resolve } from "node:path";
import type { CachedPass } from "./cache.ts";
import type { ScenarioResult } from "./run.ts";
import { creditsOf, scenarioDoubted, unchecked } from "./run.ts";
import { FAILED_CHECK_ACTION } from "./runfile.ts";
import type { Scenario } from "./scenarios.ts";
import type { SetupError } from "./setuperror.ts";

export type Outcome = "passed" | "failed" | "not_checked" | "error";

export const outcomeOf = (r: ScenarioResult): Outcome => (r.outcome === "unsure" ? "not_checked" : r.outcome);

// A scenario of this check: run now, a pass kept from before, or (--dry-run) one that would run.
export type Item =
  | { scenario: Scenario; result: ScenarioResult }
  | { scenario: Scenario; cached: CachedPass }
  | { scenario: Scenario; estimate: number | null };

export type StepDoc = { remark: string; failed?: true };

export type ScenarioDoc = {
  target?: import("./target.ts").Target;
  recordingNote?: string;
  // Kane's own report of the run on TestMu, when it gave one.
  kaneReport?: string;
  id: string;
  name: string;
  file?: string;
  outcome: Outcome | "would_run";
  cached: boolean;
  cachedAt?: string;
  objective: string;
  reason?: string;
  // Only for not_checked: Kane asserted nothing, or Kane thinks the scenario text itself is wrong.
  notChecked?: "nothing_asserted" | "scenario_doubted" | "runs_disagreed" | "text_contradicted";
  // A failed check that Kane blames on the scenario, rather than the app. Diagnosis is Kane's opinion.
  failedCheck?: "scenario_doubted";
  diagnosis?: string;
  suggestion?: string;
  failedStep?: string;
  steps: StepDoc[];
  pageError?: string;
  clip?: { mp4?: string; jpg?: string };
  credits: number;
  creditsSource?: "kane_estimate";
  accountBalance?: { before: number; after: number; debit: number };
  estimatedCredits?: number | null;
  seconds?: number;
  rerun: string;
};

export type Counts = { passed: number; failed: number; not_checked: number; error: number; skipped: number };
export type Skipped = { id: string; name: string; why: string };

export type Doc = {
  ok: boolean;
  exitCode: number;
  summary: string;
  dryRun?: true;
  counts: Counts;
  base: string | null;
  changedFiles: number | null;
  url: string | null;
  // Whether Proofed started the app for this check or tested one that was already running.
  app: "started" | "reused" | null;
  credits: number;
  estimatedCredits: number | null;
  seconds: number;
  scenarios: ScenarioDoc[];
  skipped: Skipped[];
  next: string;
  // The command that runs again only what didn't pass.
  rerun?: string;
  out: string;
};

export type ErrorDoc = {
  ok: false;
  exitCode: number;
  error: { code: string; message: string; fix: string };
  // An interrupted check still says what had finished.
  scenarios?: ScenarioDoc[];
};

// Commands shown to Windows developers target PowerShell, the default terminal.
export const quote = (s: string, platform = process.platform) => /^[\w@%+=:,./-]+$/.test(s) ? s
  : platform === "win32" ? `'${s.replaceAll("'", "''")}'` : `'${s.replace(/'/g, `'\\''`)}'`;

// `selection`: "--only a,b" or "--all", when the check was asked for one; `flags`: where the app
// and the scenarios are, so a printed command runs the same way.
export type RerunContext = { text?: string; flags: string[]; selection?: string };

// The same check again, as it was asked for.
export const sameCommand = (ctx: RerunContext, selection = ctx.selection) =>
  ["proofed check", ...(ctx.text !== undefined ? [quote(ctx.text)] : selection ? [selection] : []), ...ctx.flags].join(" ");

export function rerunCommand(ids: string[], ctx: RerunContext) {
  const what = ctx.text !== undefined ? quote(ctx.text) : `--only ${ids.join(",")}`;
  return ["proofed check", what, ...ctx.flags].join(" ");
}

const round = (n: number) => Math.round(n * 100) / 100;
const names = (docs: ScenarioDoc[]) => docs.map((d) => d.name).join(", ");

export function scenarioDoc(item: Item, ctx: RerunContext): ScenarioDoc {
  const { scenario: s } = item;
  const head = { ...(s.resolvedTarget && { target: s.resolvedTarget }), id: s.id, name: s.name, ...(s.file && { file: s.file }) };
  const rerun = rerunCommand([s.id], ctx);
  if ("estimate" in item) {
    return { ...head, outcome: "would_run", cached: false, objective: s.objective, steps: [], credits: 0, estimatedCredits: item.estimate, rerun };
  }
  if ("cached" in item) {
    const { passedAt, seconds, clip } = item.cached;
    return {
      ...head,
      outcome: "passed",
      cached: true,
      cachedAt: passedAt,
      objective: s.objective,
      steps: [],
      ...(clip && { clip }),
      credits: 0,
      ...(seconds !== undefined && { seconds }),
      rerun,
    };
  }
  const r = item.result;
  const outcome = outcomeOf(r);
  const verdict = r.end?.verdict;
  const failedStep = r.steps.findLast((step) => step.status === "failed")?.remark;
  const reason = outcome === "passed" ? r.end?.summary || r.end?.reason : r.end?.reason || r.error;
  return {
    ...head,
    ...(r.recordingNote && { recordingNote: r.recordingNote }),
    ...(r.end?.test_url && { kaneReport: r.end.test_url }),
    outcome,
    cached: false,
    objective: s.objective,
    ...(reason && { reason }),
    ...(outcome === "not_checked" && { notChecked: r.notChecked ?? (unchecked(r) ? "nothing_asserted" : "scenario_doubted") }),
    ...(outcome !== "passed" && verdict?.root_cause && { diagnosis: verdict.root_cause }),
    ...(scenarioDoubted(r) && { failedCheck: "scenario_doubted" as const }),
    ...(scenarioDoubted(r) ? { suggestion: FAILED_CHECK_ACTION } : outcome !== "passed" && verdict?.suggestion && { suggestion: verdict.suggestion }),
    ...(outcome !== "passed" && failedStep && { failedStep }),
    steps: r.steps
      .filter((step) => step.status !== "running" && step.remark)
      .slice(-30)
      .map((step) => ({ remark: step.remark.slice(0, 200), ...(step.status === "failed" && { failed: true as const }) })),
    ...(r.pageError && { pageError: r.pageError }),
    ...(r.clip && { clip: { ...(r.clip.mp4 && { mp4: resolve(r.clip.mp4) }), jpg: resolve(r.clip.jpg) } }),
    credits: round(creditsOf(r)),
    creditsSource: "kane_estimate",
    ...(r.accountBalance && { accountBalance: r.accountBalance }),
    ...(r.seconds !== undefined && { seconds: r.seconds }),
    rerun,
  };
}

export const exitCodeOf = (counts: Counts) => (counts.failed > 0 ? 1 : counts.not_checked + counts.error > 0 ? 2 : 0);

type DocInput = {
  items: Item[];
  skipped: Skipped[];
  base: string | null;
  changedFiles: number | null;
  url: string | null;
  app?: "started" | "reused";
  seconds: number;
  out: string;
  rerun: RerunContext;
  dryRun?: boolean;
  estimatedCredits: number | null;
  // Why nothing runs, when nothing does.
  idle?: { summary: string; next: string };
};

export function buildDoc(input: DocInput): Doc {
  const scenarios = input.items.map((item) => scenarioDoc(item, input.rerun));
  const of = (o: ScenarioDoc["outcome"]) => scenarios.filter((d) => d.outcome === o);
  const counts: Counts = {
    passed: of("passed").length,
    failed: of("failed").length,
    not_checked: of("not_checked").length,
    error: of("error").length,
    skipped: input.skipped.length,
  };
  const exitCode = exitCodeOf(counts);
  const broken = scenarios.filter((d) => d.outcome !== "passed" && d.outcome !== "would_run");
  const rerun = rerunCommand(broken.map((d) => d.id), input.rerun);
  const cached = scenarios.filter((d) => d.cached).length;
  const estimatedCredits = input.estimatedCredits === null ? null : round(input.estimatedCredits);

  let summary: string;
  let next: string;
  if (input.idle) {
    ({ summary, next } = input.idle);
  } else if (input.dryRun) {
    const would = of("would_run").length;
    summary = `Would run ${would} scenario(s) ${estimatedCredits === null ? "at a cost Kane reports only after a first run" : `for about ${estimatedCredits} credits`}${cached ? `; ${cached} cached pass(es) cost nothing` : ""}`;
    next = would ? `Run it for real: ${sameCommand(input.rerun)}` : "Nothing would run.";
  } else if (counts.failed > 0) {
    summary = `${counts.failed} of ${scenarios.length} broke: ${names(of("failed"))}`;
    next = scenarios.some((d) => d.failedCheck)
      ? `${FAILED_CHECK_ACTION} Then run: ${rerun}`
      : `Fix the failed scenarios, then run: ${rerun}`;
  } else if (counts.error > 0) {
    summary = `Kane couldn't finish: ${names(of("error"))}${counts.not_checked ? `; not checked: ${names(of("not_checked"))}` : ""}`;
    next = `Run them again: ${rerun}`;
  } else if (counts.not_checked > 0) {
    summary = `${counts.passed} passed, ${counts.not_checked} not checked: ${names(of("not_checked"))}`;
    next = `Not checked is not a pass. Make the scenario end in a concrete check, or tell the user why Kane doubts it, then run: ${rerun}`;
  } else {
    summary = `${counts.passed} of ${scenarios.length} passed${cached ? ` (${cached} cached)` : ""}`;
    next = "Nothing to fix.";
  }
  return {
    ok: exitCode === 0,
    exitCode,
    summary,
    ...(input.dryRun && { dryRun: true as const }),
    counts,
    base: input.base,
    changedFiles: input.changedFiles,
    url: input.url,
    app: input.app ?? null,
    credits: round(scenarios.reduce((sum, d) => sum + d.credits, 0)),
    estimatedCredits,
    seconds: input.seconds,
    scenarios,
    skipped: input.skipped,
    next,
    ...(broken.length > 0 && { rerun }),
    out: input.out,
  };
}

export const errorDoc = (e: SetupError, exitCode = 3, scenarios?: ScenarioDoc[]): ErrorDoc => ({
  ok: false,
  exitCode,
  error: { code: e.code, message: e.message, fix: e.fix },
  ...(scenarios && { scenarios }),
});
