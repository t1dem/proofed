// What the dashboard knows about a pull request beyond the comment's headline: the run file the
// action commits next to its clips (see src/runfile.ts at the repo root). The webhook reads it
// when the comment that names it arrives.
import { readRunKey, RUN_FILE, type RunFile, type RunFix, type RunScenario } from "../../../src/runfile";
import { gh } from "./github";
import type { Env } from "./index";

export type { RunScenario };
export type Outcome = RunScenario["outcome"];
export type Run = RunFile & { key: string; at: number };

export type PullState = "failing" | "passing" | "fixing" | "blocked";

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
  fix?: Pick<RunFix, "status" | "model" | "effort" | "commit"> & { attempts: number };
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

type ReportRow = { repo: string; pr: number; title: string | null; state: PullState; headline: string; url: string; updated_at: number };
type RunRow = { repo: string; pr: number; key: string; data: string; created_at: number };

const toRun = (row: RunRow): Run => ({ ...(JSON.parse(row.data) as RunFile), key: row.key, at: row.created_at });

function toPull(report: ReportRow, latest: Run | undefined): PullView {
  return {
    repo: report.repo,
    pr: report.pr,
    title: report.title,
    state: report.state,
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
  const [reports, runs] = await Promise.all([
    env.DB.prepare(`SELECT * FROM reports WHERE repo IN (${marks}) AND closed = 0 AND updated_at > ?${names.length + 1} ORDER BY updated_at DESC LIMIT 200`)
      .bind(...names, since)
      .all<ReportRow>(),
    env.DB.prepare(
      `SELECT * FROM runs r WHERE repo IN (${marks}) AND created_at > ?${names.length + 1}
       AND created_at = (SELECT MAX(created_at) FROM runs WHERE repo = r.repo AND pr = r.pr)`,
    )
      .bind(...names, since)
      .all<RunRow>(),
  ]);
  const latest = new Map(runs.results.map((r) => [`${r.repo}#${r.pr}`, toRun(r)]));
  return reports.results.map((r) => toPull(r, latest.get(`${r.repo}#${r.pr}`)));
}

export type PullDetail = { pull: PullView; runs: Run[] };

export async function getPull(env: Env, repo: string, pr: number): Promise<PullDetail | undefined> {
  const [report, runs] = await Promise.all([
    env.DB.prepare("SELECT * FROM reports WHERE repo = ?1 AND pr = ?2").bind(repo, pr).first<ReportRow>(),
    env.DB.prepare("SELECT * FROM runs WHERE repo = ?1 AND pr = ?2 ORDER BY created_at DESC LIMIT 20").bind(repo, pr).all<RunRow>(),
  ]);
  if (!report) return undefined;
  const all = runs.results.map(toRun);
  return { pull: toPull(report, all[0]), runs: all };
}
