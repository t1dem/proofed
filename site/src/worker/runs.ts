// What the dashboard knows about a pull request beyond the comment's headline: the run file the
// action commits next to its clips (see src/report/runfile.ts at the repo root). The webhook reads it
// when the comment that names it arrives.
import type { Fixer } from "./models";
import { summarize, type Live, type LiveSummary } from "../../../src/report/livefile";
import { readRunKey, RUN_FILE, type RunFile, type RunFix, type RunScenario } from "../../../src/report/runfile";
import { gh } from "./github";
import type { Env } from "./index";

export type { RunScenario };
export type Outcome = RunScenario["outcome"];
export type Run = RunFile & { key: string; at: number };

// "running": a push or a "Run again" started a run and the workflow hasn't reported yet.
export type PullState = "failing" | "passing" | "fixing" | "blocked" | "running";

export type PullView = {
  repo: string;
  pr: number;
  title: string | null;
  state: PullState;
  headline: string;
  url: string;
  updatedAt: number;
  // From the latest run; empty for reports posted before run files existed.
  scenarios: Pick<RunScenario, "name" | "outcome" | "reason">[];
  fixer?: Fixer;
  fix?: Pick<RunFix, "status" | "model" | "effort" | "commit"> & { attempts: number };
  // The repo's workflow is switched off: nothing would answer "Fix with Claude" or "Run again". Set by the API.
  paused?: boolean;
  // The signed-in user can't push to the repo, so the workflow wouldn't answer their /proofed. Set by the API.
  readOnly?: boolean;
  // Where the run is now, while Kane or Claude is at work and the action reports it (src/report/live.ts).
  live?: LiveSummary;
  // The commit Kane or Claude is at work on, before its run reports.
  checking?: { sha: string; at: number };
};

const CLIPS_BRANCH = "proofed-clips";

// Anyone who can push to the repo can write this file, so only links to GitHub are kept.
const safeUrl = (url: unknown) => (typeof url === "string" && url.startsWith("https://github.com/") ? url : undefined);

function readRunFile(text: string): RunFile | undefined {
  const file = JSON.parse(text) as Partial<RunFile>;
  if (typeof file.sha !== "string" || !Array.isArray(file.scenarios)) return undefined;
  return {
    ...file,
    sha: file.sha,
    runUrl: safeUrl(file.runUrl),
    scenarios: file.scenarios.map((s) => ({
      ...s,
      clip: s.clip && { mp4: safeUrl(s.clip.mp4), gif: safeUrl(s.clip.gif), jpg: safeUrl(s.clip.jpg) },
    })),
  };
}

export async function saveRun(env: Env, token: string, repo: string, pr: number, commentBody: string) {
  const key = readRunKey(commentBody);
  if (!key?.startsWith(`pr-${pr}/`)) return;
  const { content } = await gh<{ content: string }>(token, "GET", `/repos/${repo}/contents/${key}/${RUN_FILE}?ref=${CLIPS_BRANCH}`);
  const bytes = Uint8Array.from(atob(content.replace(/\s/g, "")), (c) => c.charCodeAt(0));
  const file = readRunFile(new TextDecoder().decode(bytes));
  if (!file) return;
  // A comment edit (the fix box, the "working" line) arrives with the same key: keep the first time.
  await env.DB.prepare("INSERT INTO runs (repo, pr, key, sha, data, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT DO NOTHING")
    .bind(repo, pr, key, file.sha, JSON.stringify(file), Date.now())
    .run();
}

type ReportRow = {
  repo: string;
  pr: number;
  title: string | null;
  state: PullState;
  headline: string;
  url: string;
  updated_at: number;
  asked: "fix" | "rerun" | null;
  asked_at: number | null;
  head_sha: string | null;
};

// A run that never reports (the job failed before Kane started) stops showing as on its way after this.
const ASK_LASTS = 30 * 60_000;
// A live state older than this is a run that died without reporting, so it isn't shown (see live.ts).
export const LIVE_LASTS = 15 * 60_000;

export async function markAsked(env: Env, repo: string, pr: number, action: "fix" | "rerun") {
  await env.DB.prepare("UPDATE reports SET asked = ?3, asked_at = ?4 WHERE repo = ?1 AND pr = ?2").bind(repo, pr, action, Date.now()).run();
}

// The workflow's next comment (newer than the ask) takes over from the ask.
// A pull request that has no report yet is created with both times equal.
function stateOf(report: ReportRow): PullState {
  const pending = report.asked_at && report.asked_at >= report.updated_at && Date.now() - report.asked_at < ASK_LASTS;
  if (!pending) return report.state;
  return report.asked === "fix" ? "fixing" : "running";
}
type RunRow = { repo: string; pr: number; key: string; data: string; created_at: number };

// Clip links point at github.com, which a private repo only serves to someone signed in there; the
// dashboard can't send those cookies, so it asks the Worker for the clip instead (see /api/clip).
// `api` is where this reader's API lives: "/api" for someone signed in, "/api/try" for a visitor of /try.
const viaWorker = (url: string | undefined, api: string) => {
  const match = url && /^https:\/\/github\.com\/([^/]+\/[^/]+)\/raw\/proofed-clips\/(.+)$/.exec(url);
  return match ? `${api}/clip/${match[1]}/${match[2]}` : url;
};

function toRun(row: RunRow, api = "/api"): Run {
  const file = JSON.parse(row.data) as RunFile;
  const scenarios = file.scenarios.map((s) => ({
    ...s,
    clip: s.clip && { mp4: viaWorker(s.clip.mp4, api), gif: viaWorker(s.clip.gif, api), jpg: viaWorker(s.clip.jpg, api) },
  }));
  return { ...file, scenarios, key: row.key, at: row.created_at };
}

function toPull(report: ReportRow, latest: Run | undefined, live?: Live): PullView {
  const state = stateOf(report);
  // A rerun or a fix starts on the commit the last run checked; a push, on the one the webhook saw.
  const sha = live?.sha ?? report.head_sha ?? latest?.sha;
  const busy = state === "running" || state === "fixing";
  return {
    repo: report.repo,
    pr: report.pr,
    title: report.title,
    state,
    ...(live && busy && { live: summarize(live) }),
    ...(sha && busy && { checking: { sha, at: report.asked_at ?? report.updated_at } }),
    headline: report.headline,
    url: report.url,
    updatedAt: report.updated_at,
    scenarios: latest?.scenarios.map(({ name, outcome, reason }) => ({ name, outcome, reason: outcome === "passed" ? undefined : reason })) ?? [],
    fix: latest?.fix && {
      status: latest.fix.status,
      model: latest.fix.model,
      effort: latest.fix.effort,
      commit: latest.fix.commit,
      attempts: latest.fix.attempts?.length ?? 1,
    },
  };
}

const INBOX_DAYS = 30;

// Open pull requests with a report in the last month, across the repos this user can see.
export async function listPulls(env: Env, repos: string[]): Promise<PullView[]> {
  if (repos.length === 0) return [];
  const names = repos.slice(0, 90); // D1 takes at most 100 bound values
  const marks = names.map((_, i) => `?${i + 1}`).join(", ");
  const since = Date.now() - INBOX_DAYS * 86_400_000;
  const [reports, runs, live] = await Promise.all([
    env.DB.prepare(`SELECT * FROM reports WHERE repo IN (${marks}) AND closed = 0 AND updated_at > ?${names.length + 1} ORDER BY updated_at DESC LIMIT 200`)
      .bind(...names, since)
      .all<ReportRow>(),
    env.DB.prepare(
      `SELECT * FROM runs r WHERE repo IN (${marks}) AND created_at > ?${names.length + 1}
       AND key = (SELECT key FROM runs WHERE repo = r.repo AND pr = r.pr ORDER BY created_at DESC, key DESC LIMIT 1)`,
    )
      .bind(...names, since)
      .all<RunRow>(),
    env.DB.prepare(`SELECT repo, pr, data FROM live WHERE repo IN (${marks}) AND updated_at > ?${names.length + 1}`)
      .bind(...names, Date.now() - LIVE_LASTS)
      .all<{ repo: string; pr: number; data: string }>(),
  ]);
  const key = (r: { repo: string; pr: number }) => `${r.repo}#${r.pr}`;
  const latest = new Map(runs.results.map((r) => [key(r), toRun(r)]));
  const going = new Map(live.results.map((r) => [key(r), JSON.parse(r.data) as Live]));
  return reports.results.map((r) => toPull(r, latest.get(key(r)), going.get(key(r))));
}

export type PullDetail = { pull: PullView; runs: Run[] };

export async function getPull(env: Env, repo: string, pr: number, api = "/api"): Promise<PullDetail | undefined> {
  const [report, runs] = await Promise.all([
    env.DB.prepare("SELECT * FROM reports WHERE repo = ?1 AND pr = ?2").bind(repo, pr).first<ReportRow>(),
    env.DB.prepare("SELECT * FROM runs WHERE repo = ?1 AND pr = ?2 ORDER BY created_at DESC, key DESC LIMIT 20").bind(repo, pr).all<RunRow>(),
  ]);
  if (!report) return undefined;
  const all = runs.results.map((r) => toRun(r, api));
  return { pull: toPull(report, all[0]), runs: all };
}

// The demo reads several pull requests at once. Keep the same 20-run history per pull.
export async function getPulls(env: Env, repo: string, prs: number[], api: string) {
  const details = new Map<number, PullDetail>();
  if (!prs.length) return details;
  const marks = prs.map(() => "?").join(", ");
  const [reports, rows] = await Promise.all([
    env.DB.prepare(`SELECT * FROM reports WHERE repo = ? AND pr IN (${marks})`)
      .bind(repo, ...prs).all<ReportRow>(),
    env.DB.prepare(
      `SELECT * FROM (
         SELECT runs.*, ROW_NUMBER() OVER (PARTITION BY pr ORDER BY created_at DESC, key DESC) AS position
         FROM runs WHERE repo = ? AND pr IN (${marks})
       ) WHERE position <= 20 ORDER BY pr, position`,
    ).bind(repo, ...prs).all<RunRow>(),
  ]);
  const runs = new Map<number, RunRow[]>();
  for (const row of rows.results) {
    const history = runs.get(row.pr);
    if (history) history.push(row);
    else runs.set(row.pr, [row]);
  }
  for (const report of reports.results) {
    const all = (runs.get(report.pr) ?? []).map((row) => toRun(row, api));
    details.set(report.pr, { pull: toPull(report, all[0]), runs: all });
  }
  return details;
}
