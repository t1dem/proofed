// "Break it yourself" (/try): anyone, signed in or not, opens one of a few prepared pull requests on
// the demo store and watches Proofed work on it: Kane in Chrome, the report, Claude's fix, Kane again.
// Everything here is public, so it is narrow on purpose:
// - the changes are prepared branches of the demo store (`try/<id>`); a visitor picks one, never writes one;
// - one run at a time, a few per visitor and per day: each costs Kane credits and Claude's time;
// - reading is limited to the demo store, which is a public repository anyway.
import { CLIP_PATH, repoFixer, serveClip } from "./api";
import { readJsonObject } from "./body";
import { appRequest, gh, GitHubError, installationToken } from "./github";
import type { Env } from "./index";
import { getLive, liveFrame } from "./live";
import { providerLabel, providerOf } from "./models";
import { memo } from "./memo";
import { fixedSummary, latestScenarios } from "../run-summary";
import { getPull, type PullState } from "./runs";

// What the visitor picks from. `title` and `says` are the pull request's own title and description:
// each reads like an ordinary small change. What it breaks is for Kane to find.
const BUGS = [
  { id: "promo-lookup", title: "Simplify promo code lookup", says: "Looks the promo code up as typed, without trimming and upper-casing it first. One line in src/pricing.ts." },
  { id: "shipping-threshold", title: "Make the free shipping threshold easier to read", says: "Writes the free shipping threshold as 50 with a comment that says €50. One line in src/pricing.ts." },
  { id: "order-total", title: "Checkout: keep shipping out of the saved order total", says: "Saves the order's total without shipping, on the belief that the confirmation page adds it. One line in src/pages/Checkout.tsx." },
  { id: "qty-floor", title: "Bag: never let a quantity drop below 1", says: "Routes the + and − buttons in the bag through one helper that keeps the quantity at 1 or more." },
] as const;

export type TryBug = { id: string; title: string; says: string };
// `unsure`: nothing broke in the last run, but Kane didn't confirm a scenario either.
export type TryRun = { pr: number; bug: string; title: string; startedAt: number; finishedAt?: number; state: PullState; fixed: boolean; unsure: boolean; model?: string; result?: string };
export type TryView = {
  repo: string;
  provider?: string;
  bugs: TryBug[];
  // The run that's going: yours or someone else's. Nothing else starts until it's over.
  current: TryRun | null;
  recent: TryRun[];
  // How many more can start today; 0 means watch the recent ones instead.
  left: number;
};

type TryRow = { id: number; bug: string; pr: number | null; branch: string | null; started_at: number; finished_at: number | null };

const json = (data: unknown, status = 200) => Response.json(data, { status });
const DAY = 86_400_000;
// A run that never reports stops holding the line after this.
const RUN_LASTS = 25 * 60_000;
// A failing report with no fix on its way: "Fix automatically" picks up within seconds, or not at all.
const FIX_STARTS_WITHIN = 3 * 60_000;
const PER_VISITOR = 3;

const titleOf = (bug: string) => BUGS.find((b) => b.id === bug)?.title ?? bug;

const repoToken = (env: Env, repo: string) =>
  memo(`try-installation:${repo}`, 3_600_000, () => appRequest<{ id: number }>(env, "GET", `/repos/${repo}/installation`)).then((i) =>
    installationToken(env, i.id),
  );

async function visitorOf(request: Request, env: Env) {
  const address = request.headers.get("cf-connecting-ip") ?? "unknown";
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${address}:${env.SECRETS_KEY}`));
  return [...new Uint8Array(hash).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// A run as the page shows it. `over` is when nothing more will happen on the pull request by itself.
async function describe(env: Env, row: TryRow & { pr: number }): Promise<TryRun & { over: boolean }> {
  const detail = await getPull(env, env.TRY_REPO, row.pr, "/api/try");
  const state = detail?.pull.state ?? "running";
  const fix = detail?.runs[0]?.fix;
  const over =
    !!fix ||
    state === "passing" ||
    state === "blocked" ||
    (state === "failing" && Date.now() - (detail?.pull.updatedAt ?? 0) > FIX_STARTS_WITHIN) ||
    Date.now() - row.started_at > RUN_LASTS;
  return {
    pr: row.pr,
    bug: row.bug,
    title: titleOf(row.bug),
    startedAt: row.started_at,
    ...(row.finished_at && { finishedAt: row.finished_at }),
    state,
    fixed: fix?.status === "fixed",
    model: detail?.pull.live?.fix?.model || fix?.model,
    unsure: state === "passing" && !!detail && latestScenarios(detail.runs).some((s) => s.outcome !== "passed"),
    ...(fix?.status === "fixed" && detail && { result: fixedSummary(detail.runs, providerLabel(providerOf(fix.model))) }),
    over,
  };
}

async function view(env: Env): Promise<TryView> {
  const { results } = await env.DB.prepare("SELECT * FROM tries ORDER BY started_at DESC LIMIT 8").all<TryRow>();
  const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM tries WHERE started_at > ?1").bind(Date.now() - DAY).first<{ n: number }>();
  let current: TryRun | null = null;
  const recent: TryRun[] = [];
  for (const row of results) {
    if (row.pr === null) {
      // The slot was taken and GitHub never answered: let it go after a minute.
      if (Date.now() - row.started_at > 60_000) await env.DB.prepare("DELETE FROM tries WHERE id = ?1").bind(row.id).run();
      continue;
    }
    const { over, ...run } = await describe(env, { ...row, pr: row.pr });
    if (row.finished_at === null && over) {
      const at = Date.now();
      await env.DB.prepare("UPDATE tries SET finished_at = ?2 WHERE id = ?1").bind(row.id, at).run();
      recent.push({ ...run, finishedAt: at });
    } else if (row.finished_at === null) current = run;
    else recent.push(run);
  }
  const daily = Number(env.TRY_DAILY) || 15;
  const fixer = await repoToken(env, env.TRY_REPO).then((token) => repoFixer(token, env.TRY_REPO)).catch(() => null);
  return { repo: env.TRY_REPO, provider: providerLabel(providerOf(fixer?.model || "")), bugs: [...BUGS], current, recent: recent.slice(0, 5), left: Math.max(0, daily - (today?.n ?? 0)) };
}

// The pull requests of runs that are over are closed and their branches deleted when the next one
// starts, so the last run's stays open on GitHub for whoever is still reading it.
async function tidy(env: Env, token: string) {
  const { results } = await env.DB.prepare(
    `SELECT t.pr, t.branch FROM tries t JOIN reports r ON r.repo = ?1 AND r.pr = t.pr
     WHERE t.finished_at IS NOT NULL AND r.closed = 0 AND t.branch IS NOT NULL`,
  )
    .bind(env.TRY_REPO)
    .all<{ pr: number; branch: string }>();
  for (const { pr, branch } of results) {
    await gh(token, "PATCH", `/repos/${env.TRY_REPO}/pulls/${pr}`, { state: "closed" }).catch(() => {});
    await gh(token, "DELETE", `/repos/${env.TRY_REPO}/git/refs/heads/${branch}`).catch(() => {});
    await env.DB.prepare("UPDATE reports SET closed = 1 WHERE repo = ?1 AND pr = ?2").bind(env.TRY_REPO, pr).run();
  }
}

async function start(request: Request, env: Env) {
  // A form on another site can't post JSON here without the browser saying where it came from.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "Start it from the Proofed site." }, 403);
  const id = (await readJsonObject(request))?.bug;
  const bug = BUGS.find((b) => b.id === id);
  if (!bug) return json({ error: "Pick one of the listed pull requests." }, 400);

  const before = await view(env);
  if (before.current) return json({ error: "A run is already going. Watch it; yours can start when it ends.", current: before.current }, 409);
  if (before.left === 0) return json({ error: "That's all the live runs for today. The recent ones below are real: open any of them." }, 429);
  const visitor = await visitorOf(request, env);
  const mine = await env.DB.prepare("SELECT COUNT(*) AS n FROM tries WHERE visitor = ?1 AND started_at > ?2").bind(visitor, Date.now() - DAY).first<{ n: number }>();
  if ((mine?.n ?? 0) >= PER_VISITOR) return json({ error: `You've started ${PER_VISITOR} runs today. The recent ones below are real: open any of them.` }, 429);

  // Take the slot first, so two visitors pressing at once don't both open a pull request.
  const now = Date.now();
  const taken = await env.DB.prepare(
    `INSERT INTO tries (bug, visitor, started_at) SELECT ?1, ?2, ?3
     WHERE NOT EXISTS (SELECT 1 FROM tries WHERE finished_at IS NULL)`,
  )
    .bind(bug.id, visitor, now)
    .run();
  if (taken.meta.changes !== 1) return json({ error: "Someone started a run a moment before you. Watch it; yours can start when it ends." }, 409);
  const slot = taken.meta.last_row_id;

  try {
    const token = await repoToken(env, env.TRY_REPO);
    await tidy(env, token);
    const source = await gh<{ object: { sha: string } }>(token, "GET", `/repos/${env.TRY_REPO}/git/ref/heads/try/${bug.id}`);
    const branch = `try-${slot}-${bug.id}`;
    await gh(token, "POST", `/repos/${env.TRY_REPO}/git/refs`, { ref: `refs/heads/${branch}`, sha: source.object.sha });
    const pull = await gh<{ number: number; html_url: string }>(token, "POST", `/repos/${env.TRY_REPO}/pulls`, {
      title: bug.title,
      head: branch,
      base: "main",
      body: `${bug.says}\n\n---\nOpened by a visitor of [Proofed's "Break it yourself" page](${new URL("/try", request.url).href}), from the prepared branch \`try/${bug.id}\`. Proofed checks it like any pull request: Kane runs the affected scenarios in Chrome, and the selected fixer repairs what breaks.`,
    });
    await env.DB.batch([
      env.DB.prepare("UPDATE tries SET pr = ?2, branch = ?3 WHERE id = ?1").bind(slot, pull.number, branch),
      // In the inbox and on its page as "Kane is checking" at once; the webhook writes the same row.
      env.DB.prepare(
        `INSERT INTO reports (repo, pr, state, headline, url, updated_at, title, asked, asked_at, head_sha)
         VALUES (?1, ?2, 'blocked', 'Proofed didn''t report on this pull request.', ?3, ?4, ?5, 'rerun', ?4, ?6)
         ON CONFLICT(repo, pr) DO NOTHING`,
      ).bind(env.TRY_REPO, pull.number, pull.html_url, now, bug.title, source.object.sha),
    ]);
    return json({ pr: pull.number });
  } catch (e) {
    await env.DB.prepare("DELETE FROM tries WHERE id = ?1").bind(slot).run();
    console.error("try", bug.id, e);
    const missing = e instanceof GitHubError && e.status === 404;
    return json({ error: missing ? "That pull request isn't prepared on the demo store yet." : "GitHub didn't open the pull request. Try again in a minute." }, 502);
  }
}

export async function handleTry(request: Request, env: Env, path: string) {
  if (!env.TRY_REPO) return json({ error: "not_found" }, 404);
  if (path === "/api/try" && request.method === "GET") return json(await view(env));
  if (path === "/api/try" && request.method === "POST") return start(request, env);
  if (request.method !== "GET") return json({ error: "not_found" }, 404);

  const clip = CLIP_PATH.exec(path.slice("/api/try".length));
  // The demo store is public: if the app's token can't be had, its clips are still there to read.
  if (clip?.[1] === env.TRY_REPO) {
    const token = await repoToken(env, env.TRY_REPO).catch(() => undefined);
    return serveClip(request, token, env.TRY_REPO, clip[2] ?? "", clip[3] ?? "");
  }

  const pull = /^\/api\/try\/pulls\/([^/]+\/[^/]+)\/(\d+)(\/live(?:\/([^/]+)\.jpg)?)?$/.exec(path);
  if (pull?.[1] === env.TRY_REPO) {
    const number = Number(pull[2]);
    if (pull[4]) return liveFrame(env, env.TRY_REPO, number, decodeURIComponent(pull[4]));
    if (pull[3]) return json(await getLive(env, env.TRY_REPO, number, "/api/try"));
    const detail = await getPull(env, env.TRY_REPO, number, "/api/try");
    const fixer = await repoToken(env, env.TRY_REPO).then((token) => repoFixer(token, env.TRY_REPO)).catch(() => null);
    return detail ? json({ ...detail, pull: { ...detail.pull, fixer: fixer ?? undefined } }) : json({ error: "Proofed hasn't reported on that pull request." }, 404);
  }
  return json({ error: "not_found" }, 404);
}
