import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connectCdp } from "./cdp.ts";
import type { Action, Frame, Rect } from "./recorder.ts";

const FPS = 25;
// Kane thinks for several seconds between actions. The clip keeps a moment around each action
// (and around any visible change it caused) and cuts the waiting in between.
const BEFORE = 0.35;
const AFTER = 1.2;
const OPENING = 1;
const HOLD_LAST = 3.5;
// A screencast frame this much bigger or smaller than the previous one is a visible change
// (new page, content loaded); a blinking caret stays far below it.
const CHANGED = 0.015;
const LEAD = 0.75; // the camera starts moving this long before an action
const LINGER = 1.8; // and pulls back out this long after the last one in a row
const MAX_ZOOM = 1.8;
const FOCUS_ZOOM = 2.2;
const OVERVIEW_ZOOM = 1.4;
const OUT_WIDTH = 1280;

type Point = { x: number; y: number };
type Shot = Point & { z: number };
export type Beat = Point & { t: number; kind: Action["kind"]; rect: Rect };
type Size = { width: number; height: number };
type Piece = { from: number; to: number; at: number }; // real [from, to] shown from clip time `at`

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);

// Real time (screencast timestamps) → clip time, keeping only the stretches where something happens.
function timeline(frames: Frame[], actions: Action[]) {
  const first = frames[0]!.time;
  const last = frames.at(-1)!.time;
  const changes = frames.filter((f, i) => i > 0 && Math.abs(f.bytes - frames[i - 1]!.bytes) > f.bytes * CHANGED);
  const moments = [...actions.map((a) => a.time), ...changes.map((f) => f.time)].sort((a, b) => a - b);

  const kept: { from: number; to: number }[] = [{ from: first, to: Math.min(first + OPENING, last) }];
  for (const m of moments) {
    const from = clamp(m - BEFORE, first, last);
    const to = clamp(m + AFTER, first, last);
    const prev = kept.at(-1)!;
    if (from <= prev.to) prev.to = Math.max(prev.to, to);
    else kept.push({ from, to });
  }
  const pieces: Piece[] = [];
  let at = 0;
  for (const k of kept) {
    pieces.push({ ...k, at });
    at += k.to - k.from;
  }
  // The last frame stays up while the camera settles on the result.
  pieces.push({ from: last, to: last + HOLD_LAST, at });

  return {
    duration: at + HOLD_LAST,
    holdStart: at,
    toClip(time: number) {
      const p = pieces.findLast((p) => p.from <= time) ?? pieces[0]!;
      return p.at + clamp(time - p.from, 0, p.to - p.from);
    },
    scaleAt: (time: number) => (frames.findLast((f) => f.time <= time) ?? frames[0]!).scale,
    frameAt(t: number) {
      const p = pieces.findLast((p) => p.at <= t) ?? pieces[0]!;
      const time = p.from + Math.min(t - p.at, p.to - p.from);
      return frames.findLast((f) => f.time <= time) ?? frames[0]!;
    },
  };
}

function fit(shot: Shot, { width, height }: Size): Shot {
  const z = clamp(shot.z, 1, FOCUS_ZOOM);
  const hw = width / (2 * z);
  const hh = height / (2 * z);
  return { x: clamp(shot.x, hw, width - hw), y: clamp(shot.y, hh, height - hh), z };
}

// Frames the element with room around it; small targets get the most zoom.
export function shotOf(rect: Rect, maxZoom: number, size: Size, room = 1): Shot {
  const u = (room * size.width) / OUT_WIDTH;
  const z = Math.min(
    size.width / (rect.width * (1 + 0.6 * room) + 300 * u),
    size.height / (rect.height * (1 + 0.6 * room) + 220 * u),
  );
  return fit({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, z: Math.min(z, maxZoom) }, size);
}

// The camera's moves. Each action gets a move that lands just before the action happens (and
// never leaves the previous action before it's done); a pause pulls back to the part of the page
// Kane worked in (not the empty margins of a wide screen); the hold at the end settles on what the
// final check was about. Every move is an eased transition with a fixed end time, so the camera
// is always on the element by the time the cursor clicks it.
type Move = { start: number; dur: number; shot: Shot };

export function plan(beats: Beat[], focus: Shot | undefined, holdStart: number, size: Size) {
  const rects = beats.map((b) => b.rect);
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  const full: Shot = rects.length
    ? shotOf({ x: left, y: top, width: right - left, height: bottom - top }, OVERVIEW_ZOOM, size, 0.5)
    : { x: size.width / 2, y: size.height / 2, z: 1 };

  const moves: Move[] = [{ start: 0, dur: 0, shot: full }];
  const push = (m: Move) => {
    while (moves.length > 1 && moves.at(-1)!.start >= m.start) moves.pop();
    moves.push(m);
  };
  // Two zoomed shots that don't overlap would whip-pan: pull back between them.
  const apart = (a: Shot, b: Shot) =>
    a.z > 1 && b.z > 1 && (Math.abs(a.x - b.x) > size.width / (2 * a.z) || Math.abs(a.y - b.y) > size.height / (2 * a.z));

  beats.forEach((b, i) => {
    const shot = shotOf(b.rect, MAX_ZOOM, size);
    const prev = moves.at(-1)!.shot;
    const after = i > 0 ? beats[i - 1]!.t + 0.15 : 0;
    const arrive = b.t - 0.1;
    if (apart(prev, shot) && arrive - after >= 0.8) {
      const dx = Math.abs(shot.x - prev.x);
      const dy = Math.abs(shot.y - prev.y);
      const z = Math.min(size.width / (dx + size.width * 0.45), size.height / (dy + size.height * 0.45), prev.z, shot.z);
      const start = Math.max(arrive - LEAD - 0.35, after);
      const mid = start + (arrive - start) * 0.45;
      push({ start, dur: mid - start, shot: fit({ x: (prev.x + shot.x) / 2, y: (prev.y + shot.y) / 2, z }, size) });
      push({ start: mid, dur: arrive - mid, shot });
    } else {
      const start = Math.max(arrive - LEAD, after);
      push({ start, dur: Math.max(arrive - start, 0.2), shot });
    }
    const next = beats[i + 1];
    if (!next || next.t - b.t > LINGER + LEAD + 0.5) push({ start: b.t + LINGER, dur: 0.8, shot: full });
  });
  // Head for the result as soon as the last action has had its effect, not once the hold begins.
  const last = beats.at(-1);
  push({ start: last ? Math.max(last.t + 0.3, holdStart - 0.6) : holdStart, dur: 1, shot: focus ?? full });
  return moves;
}

// Plays the moves: each one eases from wherever the camera is when it starts (centre linearly,
// zoom in log space so it feels even) to its shot.
export function film(moves: Move[], frames: number, size: Size) {
  const from: Shot[] = [];
  const at = (i: number, t: number): Shot => {
    const m = moves[i]!;
    const a = from[i]!;
    const u = m.dur > 0 ? easeInOut(clamp((t - m.start) / m.dur, 0, 1)) : 1;
    return {
      x: a.x + (m.shot.x - a.x) * u,
      y: a.y + (m.shot.y - a.y) * u,
      z: Math.exp(Math.log(a.z) + (Math.log(m.shot.z) - Math.log(a.z)) * u),
    };
  };
  moves.forEach((m, i) => from.push(i === 0 ? m.shot : at(i - 1, m.start)));
  return Array.from({ length: frames }, (_, n) => {
    const t = n / FPS;
    return fit(at(Math.max(moves.findLastIndex((m) => m.start <= t), 0), t), size);
  });
}

// The cursor glides along a slight arc into each action and dips when it clicks.
function cursor(beats: Beat[], hideFrom: number | undefined, size: Size) {
  const first = beats[0];
  if (!first) return () => undefined;
  const start = { x: clamp(first.x + 160, 0, size.width), y: clamp(first.y + 120, 0, size.height) };
  return (t: number) => {
    const appear = clamp((t - (first.t - 1)) / 0.3, 0, 1);
    const fade = hideFrom === undefined ? 1 : 1 - clamp((t - hideFrom) / 0.4, 0, 1);
    const opacity = appear * fade;
    if (opacity === 0) return undefined;

    const i = beats.findIndex((b) => b.t > t);
    let at: Point;
    if (i === -1) {
      at = beats.at(-1)!;
    } else {
      const to = beats[i]!;
      const from = i === 0 ? start : beats[i - 1]!;
      const move = i === 0 ? 0.7 : Math.min(0.6, (to.t - beats[i - 1]!.t) * 0.7);
      const u = clamp((t - (to.t - move)) / move, 0, 1);
      const e = easeInOut(u);
      const bend = Math.sin(Math.PI * u) * 0.12;
      at = {
        x: from.x + (to.x - from.x) * e - (to.y - from.y) * bend,
        y: from.y + (to.y - from.y) * e + (to.x - from.x) * bend,
      };
    }
    const click = beats.findLast((b) => b.kind === "click" && t >= b.t - 0.05 && t < b.t + 0.6);
    const since = click ? t - click.t : Infinity;
    return {
      ...at,
      opacity,
      press: since < 0.25 ? 1 - 0.18 * Math.sin((Math.PI * (since + 0.05)) / 0.3) : 1,
      ripple: click && since >= 0 ? { x: click.x, y: click.y, p: since / 0.6 } : undefined,
    };
  };
}

const CURSOR_SVG = `<svg id="cursor" viewBox="0 0 24 34" width="24" height="34"><path d="M2 2v25.5l6.4-6.2 4.1 9.9 4.4-1.8-4-9.7h8.9z" fill="#0b0d12" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>`;

const STAGE = ({ width, height }: Size) => `<!doctype html><html><head><style>
html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:#fff}
#shot{position:absolute;left:0;top:0;width:${width}px;height:${height}px;transform-origin:0 0}
#ring{position:absolute;left:0;top:0;width:60px;height:60px;border-radius:50%;border:3px solid #2f6feb;background:rgba(47,111,235,.16);opacity:0}
#cursor{position:absolute;left:0;top:0;transform-origin:0 0;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35));opacity:0}
</style></head><body><img id="shot" alt=""><div id="ring"></div>${CURSOR_SVG}
<script>
window.paint = async (s) => {
  const shot = document.getElementById("shot");
  if (s.src) { shot.src = s.src; await shot.decode(); }
  shot.style.transform = "translate(" + s.tx + "px," + s.ty + "px) scale(" + s.z + ")";
  const cursor = document.getElementById("cursor");
  const ring = document.getElementById("ring");
  cursor.style.opacity = s.cursor ? s.cursor.opacity : 0;
  if (s.cursor) cursor.style.transform = "translate(" + (s.cursor.x - 2 * s.cursor.k) + "px," + (s.cursor.y - 2 * s.cursor.k) + "px) scale(" + s.cursor.k + ")";
  ring.style.opacity = s.ripple ? 0.9 * (1 - s.ripple.p) : 0;
  if (s.ripple) ring.style.transform = "translate(" + (s.ripple.x - 30) + "px," + (s.ripple.y - 30) + "px) scale(" + (0.25 + 0.75 * s.ripple.p) * s.ripple.k + ")";
  await new Promise((r) => requestAnimationFrame(() => r()));
};
</script></body></html>`;

type ClipInput = {
  frames: Frame[];
  actions: Action[];
  // The element the final check was about, in page pixels of the last frame.
  focus?: Rect;
  // A Chrome to render in; the clip is drawn as HTML and screenshotted frame by frame.
  endpoint: string;
};

export async function makeClip({ frames, actions, focus, endpoint }: ClipInput, base: string) {
  const last = frames.at(-1);
  if (!last) return undefined;
  const size = { width: last.width, height: last.height };
  const time = timeline(frames, actions);

  const scaleRect = (r: Rect, s: number): Rect => ({ x: r.x * s, y: r.y * s, width: r.width * s, height: r.height * s });
  const beats: Beat[] = actions
    .filter((a) => a.time >= frames[0]!.time)
    .sort((a, b) => a.time - b.time)
    .map((a) => {
      const s = time.scaleAt(a.time);
      return { t: time.toClip(a.time), kind: a.kind, x: a.x * s, y: a.y * s, rect: scaleRect(a.rect, s) };
    });
  const focusShot = focus && shotOf(scaleRect(focus, last.scale), FOCUS_ZOOM, size, 0.5);
  const count = Math.ceil(time.duration * FPS);
  const shots = film(plan(beats, focusShot, time.holdStart, size), count, size);
  const pointer = cursor(beats, focusShot && time.holdStart + 0.4, size);

  const dir = `${base}.render`;
  mkdirSync(dir, { recursive: true });
  const cdp = await connectCdp(endpoint);
  try {
    const { targetId } = await cdp.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
    const page = <T = unknown>(method: string, params: object = {}) => cdp.send<T>(method, params, sessionId);
    await page("Page.enable");
    await page("Page.bringToFront");
    // Frames come in at the page's own resolution; the clip is drawn from them at OUT_WIDTH,
    // so zoomed-in shots stay sharp.
    const ui = size.width / OUT_WIDTH;
    await page("Emulation.setDeviceMetricsOverride", { ...size, deviceScaleFactor: 1 / ui, mobile: false });
    const { frameTree } = await page<{ frameTree: { frame: { id: string } } }>("Page.getFrameTree");
    await page("Page.setDocumentContent", { frameId: frameTree.frame.id, html: STAGE(size) });

    let shown: string | undefined;
    for (let n = 0; n < count; n++) {
      const t = n / FPS;
      const cam = shots[n]!;
      const toScreen = (p: Point) => ({ x: (p.x - cam.x) * cam.z + size.width / 2, y: (p.y - cam.y) * cam.z + size.height / 2 });
      const source = time.frameAt(t).file;
      const c = pointer(t);
      const k = ui * Math.sqrt(cam.z);
      await page("Runtime.evaluate", {
        awaitPromise: true,
        expression: `paint(${JSON.stringify({
          src: source === shown ? undefined : `data:image/jpeg;base64,${readFileSync(source).toString("base64")}`,
          tx: size.width / 2 - cam.x * cam.z,
          ty: size.height / 2 - cam.y * cam.z,
          z: cam.z,
          cursor: c && { ...toScreen(c), opacity: c.opacity, k: k * c.press },
          ripple: c?.ripple && { ...toScreen(c.ripple), p: c.ripple.p, k },
        })})`,
      });
      shown = source;
      const { data } = await page<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 90 });
      writeFileSync(join(dir, `${String(n).padStart(5, "0")}.jpg`), Buffer.from(data, "base64"));
    }
    await cdp.send("Target.closeTarget", { targetId });
  } finally {
    cdp.close();
  }

  const mp4 = `${base}.mp4`;
  const gif = `${base}.gif`;
  const ffmpeg = (...args: string[]) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args]);
  ffmpeg("-framerate", String(FPS), "-i", join(dir, "%05d.jpg"), "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4);
  ffmpeg(
    "-i", mp4,
    "-vf", "fps=10,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
    gif,
  );
  return { mp4, gif };
}
