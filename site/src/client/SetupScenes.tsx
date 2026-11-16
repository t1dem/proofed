import { useEffect, useRef } from "react";

// The set-up steps (and the footer's wordmark) as pictures printed in type, the way the hero's video is: each scene is
// drawn as plain shapes into a canvas one pixel per character cell, then every cell becomes a glyph
// picked by how dark it is there and coloured from it, over a soft wash of the shapes. The hero's cursor
// does the work. Hovering a picture scrambles the type under the pointer.

const RAMP = " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";

// Every scene is drawn in a 120 × 100 box, fitted into its tile.
const BOX_W = 120;
const BOX_H = 100;

const INK = "#2b2720";
const STEEL = "#7d776b";
const PAPER_SHEET = "#fffdf8";
const PENDING = "#bdb4a4";
const BRASS = "#d99130";
const SOCKET = "#4f7fa8";
const GREEN = "#1f9a4a";
const KEY = "#5a5348";

type Cursor = { x: number; y: number; pressed?: boolean; shown: number };
type Draw = (ctx: CanvasRenderingContext2D, t: number) => Cursor | null;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
const out = (p: number) => 1 - (1 - p) ** 3;
// A spring with a little overshoot, for things that land.
const spring = (p: number) => (p >= 1 ? 1 : 1 - Math.exp(-6 * p) * Math.cos(10 * p));
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

function rgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
}
function mix(a: string, b: string, p: number) {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const c = (x: number, y: number) => Math.round(lerp(x, y, p)).toString(16).padStart(2, "0");
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`;
}

// A fill lit from above: lighter at the top, darker at the bottom, so the type gets denser down the shape
// instead of one glyph repeated like wallpaper.
function shade(ctx: CanvasRenderingContext2D, color: string, top: number, bottom: number) {
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, mix(color, "#ffffff", 0.35));
  g.addColorStop(0.45, color);
  g.addColorStop(1, mix(color, "#000000", 0.35));
  return g;
}

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, from: number, to: number) {
  if (t < from || t > to) return;
  const p = seg(t, from, to);
  ctx.globalAlpha = 1 - p;
  ctx.strokeStyle = GREEN;
  ctx.lineWidth = 4 * (1 - p) + 1.2;
  ctx.beginPath();
  ctx.arc(x, y, 8 + 48 * out(p), 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// Step 1: the cursor grabs a plug and pushes it into the repo. A green light, and the pull request's two
// files pop out of the top.
export const INSTALL_LOOP = 6.8;
export const drawInstall: Draw = (ctx, t) => {
  const grab = ease(seg(t, 1.65, 2.45));
  const unplug = ease(seg(t, 5.7, 6.5));
  const bx = 10 + 25 * grab - 25 * unplug;
  const on = seg(t, 2.4, 2.7) * (1 - unplug);

  for (let f = 0; f < 2; f++) {
    const p = spring(seg(t, 2.9 + f * 0.25, 3.7 + f * 0.25)) * (1 - unplug);
    if (p <= 0) continue;
    const x = 76 + f * 13;
    const y = 30 - 25 * p;
    ctx.fillStyle = PAPER_SHEET;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.rect(x, y, 12, 16);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    for (let l = 0; l < 3; l++) ctx.fillRect(x + 2.5, y + 4 + l * 3.6, l === 2 ? 4.5 : 7, 1.4);
  }

  ctx.strokeStyle = INK;
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-14, 90);
  ctx.bezierCurveTo(bx - 30, 90, bx - 26, 50, bx, 50);
  ctx.stroke();

  ctx.fillStyle = shade(ctx, "#a9a294", 40, 60);
  ctx.fillRect(bx + 28, 40.5, 13, 5);
  ctx.fillRect(bx + 28, 54.5, 13, 5);
  ctx.fillStyle = shade(ctx, "#6b6355", 33, 67);
  ctx.beginPath();
  ctx.roundRect(bx, 33, 30, 34, 7);
  ctx.fill();
  // Grip ridges on the plug.
  ctx.fillStyle = "#2b2720";
  for (let r = 0; r < 3; r++) ctx.fillRect(bx + 6 + r * 5, 40, 2, 20);

  ctx.fillStyle = shade(ctx, mix(SOCKET, GREEN, on * 0.9), 22, 78);
  ctx.beginPath();
  ctx.roundRect(72, 22, 34, 56, 8);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.fillRect(72, 40.5, 3.5, 5);
  ctx.fillRect(72, 54.5, 3.5, 5);
  ctx.fillStyle = mix("#3c362d", "#2fd16a", on);
  ctx.beginPath();
  ctx.arc(96, 31, 3.6, 0, Math.PI * 2);
  ctx.fill();
  ring(ctx, 72, 50, t, 2.45, 3.4);

  const fly = ease(seg(t, 0.4, 1.4));
  const leave = ease(seg(t, 3.0, 3.8));
  const hx = bx + 15;
  const x = lerp(126, hx, fly) + leave * 26;
  const y = lerp(106, 50, fly) - Math.sin(Math.PI * fly) * 8 + leave * 38;
  const shown = t < 0.4 ? 0 : Math.min(seg(t, 0.4, 0.7), 1 - leave);
  return { x, y, pressed: t >= 1.5 && t < 2.5, shown };
};

// Step 2: three keys drop into a padlock, one per secret, and the shackle snaps shut.
export const SECRETS_LOOP = 7;
export const drawSecrets: Draw = (ctx, t) => {
  const reset = ease(seg(t, 6.2, 6.9));
  const shut = spring(seg(t, 3.0, 3.6)) * (1 - reset);
  const green = seg(t, 3.15, 3.6) * (1 - reset);
  const lift = 10 * (1 - shut);

  ctx.strokeStyle = shade(ctx, STEEL, 14 - lift, 60);
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(34, 64 - lift);
  ctx.lineTo(34, 42 - lift);
  ctx.arc(60, 42 - lift, 26, Math.PI, 0);
  ctx.lineTo(86, 64 - lift);
  ctx.stroke();

  for (let i = 0; i < 3; i++) {
    const drop = spring(seg(t, 0.5 + i * 0.75, 1.25 + i * 0.75));
    const x = 45 + i * 15;
    const y = lerp(-50, 46, drop) - reset * 100;
    ctx.fillStyle = shade(ctx, KEY, y - 6, y + 12);
    ctx.fillRect(x - 2, y + 4, 4, 22);
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = shade(ctx, mix(BRASS, GREEN, green * 0.9), 58, 97);
  ctx.beginPath();
  ctx.roundRect(18, 58, 84, 39, 9);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(60, 72, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(58.2, 73, 3.6, 11);
  ring(ctx, 60, 76, t, 3.3, 4.3);
  return null;
};

// Step 3: the scenario, a page of plain sentences. Kane's cursor reads it line by line, ticks each one,
// and the page gets a green stamp.
const LINES = [
  [11, 7, 15],
  [8, 13, 9],
  [6, 10, 14],
  [12, 8, 9],
];
const LINE_Y = [31, 46, 61, 76];
const WORDS_X = 44;
const lineEnd = (i: number) => WORDS_X + LINES[i]!.reduce((s, w) => s + w + 2.6, 0) - 2.6;
const readAt = (i: number) => 0.8 + i * 0.95;

// Where Kane's cursor is: flying in, along each line as it reads, down to the next, then away.
function scenarioCursor(t: number): [number, number] {
  if (t < readAt(0)) {
    const p = ease(seg(t, 0.25, readAt(0)));
    return [lerp(126, WORDS_X, p), lerp(106, LINE_Y[0]! + 3, p)];
  }
  const last = LINES.length - 1;
  for (let i = 0; i < last; i++) {
    const a = readAt(i);
    if (t < a + 0.6) return [lerp(WORDS_X, lineEnd(i), ease(seg(t, a, a + 0.6))), LINE_Y[i]! + 3];
    if (t < a + 0.95) {
      const p = ease(seg(t, a + 0.6, a + 0.95));
      return [lerp(lineEnd(i), WORDS_X, p), lerp(LINE_Y[i]!, LINE_Y[i + 1]!, p) + 3];
    }
  }
  const a = readAt(last);
  if (t < a + 0.6) return [lerp(WORDS_X, lineEnd(last), ease(seg(t, a, a + 0.6))), LINE_Y[last]! + 3];
  const p = ease(seg(t, a + 0.6, a + 1.6));
  return [lerp(lineEnd(last), 116, p), lerp(LINE_Y[last]! + 3, 104, p)];
}

export const SCENARIO_LOOP = 7.2;
export const drawScenario: Draw = (ctx, t) => {
  const reset = seg(t, 6.5, 7.1);
  ctx.save();
  ctx.translate(60, 50);
  ctx.rotate(-0.035);
  ctx.translate(-60, -50);

  ctx.fillStyle = PAPER_SHEET;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.roundRect(24, 5, 72, 90, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.fillRect(34, 14, 28, 4.5);

  LINES.forEach((words, i) => {
    const y = LINE_Y[i]!;
    const done = out(seg(t, readAt(i) + 0.6, readAt(i) + 0.85)) * (1 - reset);
    ctx.fillStyle = mix(PENDING, INK, done);
    let x = WORDS_X;
    for (const w of words) {
      ctx.fillRect(x, y - 1.7, w, 3.4);
      x += w + 2.6;
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1;
    ctx.strokeRect(32.5, y - 3.4, 6.8, 6.8);
    if (done > 0) {
      ctx.strokeStyle = GREEN;
      ctx.lineWidth = 2.4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash([16 * done, 16]);
      ctx.beginPath();
      ctx.moveTo(33.3, y + 0.2);
      ctx.lineTo(35.7, y + 2.6);
      ctx.lineTo(41, y - 4.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });
  ctx.restore();

  const stamp = seg(t, 4.75, 5.35);
  if (stamp > 0 && reset < 1) {
    const r = 12 * (1.6 - 0.6 * spring(stamp));
    ctx.globalAlpha = Math.min(1, stamp * 3) * (1 - reset);
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(88, 82, r, 0, Math.PI * 2);
    ctx.stroke();
    const k = r / 12;
    ctx.beginPath();
    ctx.moveTo(88 - 5.5 * k, 82);
    ctx.lineTo(88 - 1.5 * k, 82 + 4 * k);
    ctx.lineTo(88 + 6 * k, 82 - 5 * k);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  const [x, y] = scenarioCursor(t);
  const leave = seg(t, readAt(3) + 0.6, readAt(3) + 1.6);
  const shown = t < 0.25 ? 0 : Math.min(seg(t, 0.25, 0.55), 1 - leave);
  return { x, y, shown };
};

// All three steps as one wide picture, played in order by one cursor: it pushes the plug in, drops each
// key into the padlock and presses it shut, then reads the scenario. Then everything rests green, and resets.
const O2 = 3.6; // when the padlock's scene starts
const O3 = 7.1; // when the scenario's scene starts
const RESET = 14.6;
const RESTS = [4.6, 5, 6]; // a moment in each scene where it is done and still
const RESETS = [5.7, 6.2, 6.5]; // where each scene's own reset begins
export const ALL_LOOP = RESET + 0.9;
export const ALL_REST = 14;
// When each step is done, in the wide picture's time.
export const ALL_DONE_AT = [2.7, O2 + 3.6, O3 + 5.35];
export const ALL_RESET = RESET;

const sceneTime = (t: number, off: number, i: number) =>
  t >= RESET ? RESETS[i]! + (t - RESET) : Math.min(RESTS[i]!, Math.max(0, t - off));

// The cursor's path: [time, x, y], eased between stops.
const PATH: [number, number, number][] = [
  [0.3, -6, 96],
  [1.4, 25, 50],
  [1.65, 25, 50],
  [2.45, 50, 50],
  [2.8, 50, 50],
  [4.0, 165, 12],
  [4.25, 165, 12],
  [4.75, 180, 12],
  [5.0, 180, 12],
  [5.5, 195, 12],
  [5.75, 195, 12],
  [6.4, 180, 8],
  [6.6, 180, 8],
  [6.9, 180, 18],
  [7.05, 180, 18],
  [O3 + readAt(0), 240 + WORDS_X, LINE_Y[0]! + 3],
];
const PRESSES = [
  [1.5, 2.5],
  [4.05, 4.2],
  [4.8, 4.95],
  [5.55, 5.7],
  [6.45, 6.9],
];

function allCursor(t: number): Cursor {
  let x: number;
  let y: number;
  const last = PATH[PATH.length - 1]!;
  if (t >= last[0]) {
    const [sx, sy] = scenarioCursor(t - O3);
    x = 240 + sx;
    y = sy;
  } else {
    const k = Math.max(0, PATH.findIndex((f) => f[0] > t) - 1);
    const a = PATH[k]!;
    const b = PATH[k + 1] ?? a;
    const p = ease(seg(t, a[0], b[0]));
    x = lerp(a[1], b[1], p);
    y = lerp(a[2], b[2], p);
  }
  const leaving = O3 + readAt(3) + 0.6;
  const shown = t < 0.3 || t >= RESET ? 0 : Math.min(seg(t, 0.3, 0.6), 1 - seg(t, leaving, leaving + 1));
  return { x, y, pressed: PRESSES.some(([a, b]) => t >= a! && t < b!), shown };
}

export const drawAll: Draw = (ctx, t) => {
  [drawInstall, drawSecrets, drawScenario].forEach((draw, i) => {
    ctx.save();
    ctx.translate(BOX_W * i, 0);
    draw(ctx, sceneTime(t, [0, O2, O3][i]!, i));
    ctx.restore();
  });
  return allCursor(t);
};

// The footer's wordmark, printed in type like everything else, with the hero's dawn light passing slowly
// across it.
export const WORDMARK_LOOP = 14;
export const drawWordmark: Draw = (ctx, t) => {
  const c = ((t / WORDMARK_LOOP) % 1) * 560 - 100;
  const g = ctx.createLinearGradient(c - 90, 0, c + 90, 0);
  g.addColorStop(0, "#3a332a");
  g.addColorStop(0.42, "#d9822b");
  g.addColorStop(0.5, "#f3bb5c");
  g.addColorStop(0.58, "#d9822b");
  g.addColorStop(1, "#3a332a");
  ctx.fillStyle = g;
  // As big as the box allows: as wide as it is, or as tall.
  ctx.font = `500 100px "Newsreader", Georgia, serif`;
  const size = Math.min(130, (100 * 344) / ctx.measureText("Proofed").width);
  ctx.font = `500 ${size}px "Newsreader", Georgia, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Proofed", 180, 94);
  return null;
};

const hash = (i: number, j: number, k: number) => {
  const s = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

type SceneProps = {
  draw: Draw;
  loop: number;
  rest: number;
  label: string;
  // The design box, in scene units: 120 × 100 for one step, three times as wide for all of them.
  width?: number;
  onFrame?: (t: number) => void;
};

export function GlyphScene({ draw, loop, rest, label, width = BOX_W, onFrame }: SceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef(onFrame);
  frameRef.current = onFrame;

  useEffect(() => {
    const canvas = canvasRef.current;
    const cursor = cursorRef.current;
    if (!canvas || !cursor) return;
    const ctx = canvas.getContext("2d");
    const off = document.createElement("canvas");
    const octx = off.getContext("2d", { willReadFrequently: true });
    if (!ctx || !octx) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

    let W = 0;
    let H = 0;
    let dpr = 1;
    let cols = 0;
    let rows = 0;
    let cw = 0;
    let ch = 0;
    let s = 1;
    let ox = 0;
    let oy = 0;
    let ready = false;
    let visible = false;
    let raf = 0;
    let start = 0;
    let last = 0;
    let t = still ? rest : 0;
    let pointer: [number, number] | null = null;

    const layout = () => {
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      if (!W || !H) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ch = W >= 300 ? 9 : 8;
      cw = ch * 0.6;
      cols = Math.floor(W / cw);
      rows = Math.floor(H / ch);
      off.width = cols;
      off.height = rows;
      s = Math.min(W / width, H / BOX_H) * 0.94;
      ox = (W - width * s) / 2;
      oy = (H - BOX_H * s) / 2;
    };

    const render = () => {
      if (!ready || !cols || !rows) return;
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, cols, rows);
      octx.setTransform(s / cw, 0, 0, s / ch, ox / cw, oy / ch);
      const cur = draw(octx, t);
      frameRef.current?.(t);
      const px = octx.getImageData(0, 0, cols, rows).data;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      // From a step back it is a soft picture; up close it is type.
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = 0.42;
      ctx.drawImage(off, 0, 0, cols * cw, rows * ch);
      ctx.globalAlpha = 1;
      ctx.font = `500 ${ch * 0.86}px "IBM Plex Mono", ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const shimmer = Math.floor(t * 4);
      const scramble = Math.floor(t * 12);
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const k = (j * cols + i) * 4;
          const a = px[k + 3]! / 255;
          if (a < 0.03) continue;
          let r = px[k]! / 255;
          let g = px[k + 1]! / 255;
          let b = px[k + 2]! / 255;
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          const ink = a * Math.min(1, (1 - lum) * 1.2 + 0.04);
          const poked = pointer && Math.hypot(i - pointer[0], (j - pointer[1]) * 1.67) < 5;
          if (ink < 0.05 && !poked) continue;
          let idx = Math.round(ink * (RAMP.length - 1)) + (hash(i, j, shimmer) > 0.86 ? 1 : 0);
          let dx = 0;
          if (poked) {
            idx = 1 + Math.floor(hash(i, j, scramble) * (RAMP.length - 1));
            dx = (hash(j, i, scramble) - 0.5) * cw * 1.6;
          }
          idx = Math.min(RAMP.length - 1, Math.max(1, idx));
          const m = (r + g + b) / 3;
          const dim = 0.55 + 0.3 * (1 - ink);
          r = clamp01(m + (r - m) * 1.5) * dim;
          g = clamp01(m + (g - m) * 1.5) * dim;
          b = clamp01(m + (b - m) * 1.5) * dim;
          ctx.fillStyle = `rgb(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0})`;
          ctx.fillText(RAMP[idx]!, (i + 0.5) * cw + dx, (j + 0.5) * ch);
        }
      }

      if (cur && !still) {
        cursor.style.opacity = String(cur.shown);
        cursor.style.transform = `translate(${ox + cur.x * s - 4.7}px, ${oy + cur.y * s - 2.3}px) scale(${cur.pressed ? 0.82 : 1})`;
      } else cursor.style.opacity = "0";
    };

    const tick = (now: number) => {
      raf = 0;
      if (!visible) return;
      raf = requestAnimationFrame(tick);
      if (now - last < 33) return;
      last = now;
      t = ((now - start) / 1000) % loop;
      render();
    };

    const observer = new IntersectionObserver(
      ([e]) => {
        visible = !!e?.isIntersecting;
        if (visible && !still && !raf) {
          // Each time it comes into view the scene starts from the top.
          start = performance.now();
          raf = requestAnimationFrame(tick);
        }
      },
      { threshold: 0.3 },
    );
    const resize = new ResizeObserver(() => {
      layout();
      render();
    });

    const move = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      pointer = [(e.clientX - r.left) / cw, (e.clientY - r.top) / ch];
      if (still) render();
    };
    const leave = () => {
      pointer = null;
      if (still) render();
    };
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerdown", move);
    canvas.addEventListener("pointerleave", leave);
    // A finger has no hover: the scramble follows it while it touches, then lets go.
    const up = (e: PointerEvent) => e.pointerType !== "mouse" && leave();
    canvas.addEventListener("pointerup", up);

    let gone = false;
    // The type is the mono font, so wait for it before the first frame.
    Promise.allSettled([document.fonts.load(`500 9px "IBM Plex Mono"`), document.fonts.load(`500 100px "Newsreader"`)]).then(() => {
      if (gone) return;
      ready = true;
      layout();
      render();
      observer.observe(canvas);
      resize.observe(canvas);
    });

    return () => {
      gone = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      resize.disconnect();
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerdown", move);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("pointerup", up);
    };
  }, [draw, loop, rest, width]);

  return (
    <div role="img" aria-label={label} className="relative h-full w-full overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {/* The hero's cursor. */}
      <div ref={cursorRef} aria-hidden className="pointer-events-none absolute left-0 top-0 opacity-0">
        <svg width="28" height="28" viewBox="0 0 24 24" className="drop-shadow-[0_2px_3px_rgba(0,0,0,0.25)]">
          <path d="M4 2v17l4.6-4.3 3 6.8 2.9-1.3-3-6.6H18L4 2z" fill="#16140f" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}
