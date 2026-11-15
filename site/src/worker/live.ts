// A run as it goes. The action posts its state and a frame of each scenario's Chrome here while it
// works (src/live.ts at the repo root); the dashboard reads them back while the pull request is busy.
import { readLive, type Live } from "../../../src/livefile";
import { jobRepo } from "./actions";
import type { Env } from "./index";
import { LIVE_LASTS, markAsked } from "./runs";

const MAX_FRAME = 400_000;

const refuse = (status: number, error: string) => Response.json({ error }, { status });

// POST /api/actions/live and /api/actions/live/frame: only from an Actions job, and only for its own
// repository, which comes from the job's signed token (see actions.ts), never from the request.
export async function handleLivePost(request: Request, env: Env) {
  const job = await jobRepo(request);
  if (!job) return refuse(401, "unauthorized");
  const { repo } = job;
  const url = new URL(request.url);

  if (url.pathname.endsWith("/frame")) {
    const pr = Number(url.searchParams.get("pr"));
    const run = url.searchParams.get("run") ?? "";
    const scenario = url.searchParams.get("scenario") ?? "";
    if (!Number.isSafeInteger(pr) || pr <= 0 || !run || !scenario || scenario.length > 100) return refuse(400, "bad frame");
    const jpg = await request.arrayBuffer();
    const bytes = new Uint8Array(jpg, 0, Math.min(jpg.byteLength, 2));
    if (jpg.byteLength > MAX_FRAME || bytes[0] !== 0xff || bytes[1] !== 0xd8) return refuse(400, "not a JPEG of a few hundred KB");
    // A frame belongs to the run the state says is going; one from an older run is dropped.
    const current = await env.DB.prepare("SELECT run FROM live WHERE repo = ?1 AND pr = ?2").bind(repo, pr).first<{ run: string }>();
    if (current?.run !== run) return refuse(409, "not the current run");
    await env.DB.prepare(
      `INSERT INTO live_frames (repo, pr, scenario, jpg, at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(repo, pr, scenario) DO UPDATE SET jpg = ?4, at = ?5`,
    )
      .bind(repo, pr, scenario, jpg, Date.now())
      .run();
    return new Response(null, { status: 204 });
  }

  const live = readLive(await request.json().catch(() => undefined));
  if (!live) return refuse(400, "bad live state");
  const current = await env.DB.prepare("SELECT run FROM live WHERE repo = ?1 AND pr = ?2").bind(repo, live.pr).first<{ run: string }>();
  if (current?.run !== live.run) {
    // A new run: the last one's frames go, and the pull request shows it's at work from now on,
    // even when the run was started on GitHub rather than from the dashboard.
    await env.DB.prepare("DELETE FROM live_frames WHERE repo = ?1 AND pr = ?2").bind(repo, live.pr).run();
    await markAsked(env, repo, live.pr, live.kind === "fix" ? "fix" : "rerun");
  }
  await env.DB.prepare(
    `INSERT INTO live (repo, pr, run, data, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(repo, pr) DO UPDATE SET run = ?3, data = ?4, updated_at = ?5`,
  )
    .bind(repo, live.pr, live.run, JSON.stringify(live), Date.now())
    .run();
  return new Response(null, { status: 204 });
}

// What the dashboard gets: the state, when it last changed, and where each scenario's latest frame is.
export type LiveView = { live: (Live & { at: number }) | null; frames: Record<string, { url: string; at: number }> };

export async function getLive(env: Env, repo: string, pr: number, api = "/api"): Promise<LiveView> {
  const since = Date.now() - LIVE_LASTS;
  const [row, frames] = await Promise.all([
    env.DB.prepare("SELECT data, updated_at FROM live WHERE repo = ?1 AND pr = ?2 AND updated_at > ?3")
      .bind(repo, pr, since)
      .first<{ data: string; updated_at: number }>(),
    env.DB.prepare("SELECT scenario, at FROM live_frames WHERE repo = ?1 AND pr = ?2").bind(repo, pr).all<{ scenario: string; at: number }>(),
  ]);
  if (!row) return { live: null, frames: {} };
  const base = `${api}/pulls/${repo}/${pr}/live`;
  return {
    live: { ...(JSON.parse(row.data) as Live), at: row.updated_at },
    frames: Object.fromEntries(frames.results.map((f) => [f.scenario, { url: `${base}/${encodeURIComponent(f.scenario)}.jpg?at=${f.at}`, at: f.at }])),
  };
}

export async function liveFrame(env: Env, repo: string, pr: number, scenario: string) {
  const row = await env.DB.prepare("SELECT jpg FROM live_frames WHERE repo = ?1 AND pr = ?2 AND scenario = ?3")
    .bind(repo, pr, scenario)
    // D1 hands a BLOB back as an array of byte values.
    .first<{ jpg: number[] | ArrayBuffer }>();
  if (!row) return refuse(404, "no frame");
  // The address carries the frame's time, so a given address is always the same picture.
  return new Response(new Uint8Array(row.jpg), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600" } });
}
