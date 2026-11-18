// A run as it goes. The action posts its state and a frame of each scenario's Chrome here while it
// works (src/report/live.ts at the repo root); the dashboard reads them back while the pull request is busy.
import { readCursor, readLive, type Live, type LiveCursor } from "../../../src/report/livefile";
import { jobRepo } from "./actions";
import { readUpTo } from "./body";
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
    const jpg = await readUpTo(request, MAX_FRAME);
    if (!jpg || jpg[0] !== 0xff || jpg[1] !== 0xd8) return refuse(400, "not a JPEG of a few hundred KB");
    // A frame belongs to the run the state says is going; one from an older run is dropped.
    const current = await env.DB.prepare("SELECT run FROM live WHERE repo = ?1 AND pr = ?2").bind(repo, pr).first<{ run: string }>();
    if (current?.run !== run) return refuse(409, "not the current run");
    // An action from before the cursor sends no point: its frames show none.
    const cursor = readCursor(url.searchParams.get("x"), url.searchParams.get("y"));
    await env.DB.prepare(
      `INSERT INTO live_frames (repo, pr, scenario, jpg, at, x, y) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(repo, pr, scenario) DO UPDATE SET jpg = ?4, at = ?5, x = ?6, y = ?7`,
    )
      .bind(repo, pr, scenario, jpg.buffer, Date.now(), cursor?.x ?? null, cursor?.y ?? null)
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

// What the dashboard gets: the state, when it last changed, and where each scenario's latest frame is,
// with the cursor drawn over that frame.
export type LiveView = { live: (Live & { at: number }) | null; frames: Record<string, { url: string; at: number; cursor?: LiveCursor }> };

export async function getLive(env: Env, repo: string, pr: number, api = "/api"): Promise<LiveView> {
  const since = Date.now() - LIVE_LASTS;
  const [row, frames] = await Promise.all([
    env.DB.prepare("SELECT data, updated_at FROM live WHERE repo = ?1 AND pr = ?2 AND updated_at > ?3")
      .bind(repo, pr, since)
      .first<{ data: string; updated_at: number }>(),
    env.DB.prepare("SELECT scenario, at, x, y FROM live_frames WHERE repo = ?1 AND pr = ?2")
      .bind(repo, pr)
      .all<{ scenario: string; at: number; x: number | null; y: number | null }>(),
  ]);
  if (!row) return { live: null, frames: {} };
  const base = `${api}/pulls/${repo}/${pr}/live`;
  return {
    live: { ...(JSON.parse(row.data) as Live), at: row.updated_at },
    frames: Object.fromEntries(
      frames.results.map((f) => [
        f.scenario,
        { url: `${base}/${encodeURIComponent(f.scenario)}.jpg?at=${f.at}`, at: f.at, ...(f.x !== null && f.y !== null && { cursor: { x: f.x, y: f.y } }) },
      ]),
    ),
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
