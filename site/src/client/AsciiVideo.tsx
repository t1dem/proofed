import { useEffect, useRef, useState, type CSSProperties } from "react";

// A video shown as monospace characters on the page's dark ground. A WebGL shader cuts the frame
// into small cells; each cell becomes one glyph, picked by how dark the picture is there and coloured from
// it, over a faint wash of the real footage. Up close it is type, from a step back it is the video.
//
// Every CYCLE seconds the picture gets a bug and its fix, which is what Proofed does to a pull request:
// a red patch of scrambled type spreads over the ridges from one point, a cursor flies in and clicks
// it, and a green ring from the click wipes it away. The visitor can help: a click or tap on the
// picture sends out a ring of its own, which wipes the red it reaches.
//
// Hovering the picture scrambles the type under the pointer, in its own colours, as the page's last
// picture does (Night). A finger has no hover: the scramble follows it while it touches.

// Light to dense. The steps are few and plain: a lit sky set in brackets and letters reads as text, not as light.
const RAMP = " .,:-=+*#%@";
// The landing's ground (.night in index.css), so the canvas has no visible edge of its own.
const PAPER = [8 / 255, 8 / 255, 10 / 255];

// One bug and its fix, in seconds of the cycle.
const CYCLE = 10;
const SPREAD = [0.8, 3.8]; // the patch grows
const FLY = [2.5, 3.9]; // the cursor flies to where it started
const CLICK = 3.95;
const HEAL = [4.0, 4.9]; // the ring from the click wipes it out
const LEAVE = [5.3, 6.1]; // the cursor drifts off and fades
const DONE = LEAVE[1]! + 0.1;
// The visitor's clicks: how many count at once, how fast their ring opens and how long it glows.
const FIXES = 8;
const FIX_OPEN = 0.45;
const FIX_GLOW = 0.8;
const REACH = 5; // how far around the pointer the type scrambles, in cell widths

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);
const progress = (t: number, [a, b]: number[]) => clamp01((t - a!) / (b! - a!));
const easeOut = (x: number) => 1 - (1 - x) ** 3;
const easeInOut = (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);
// A repeatable 0..1 for each cycle, so the bug lands somewhere new every time.
const rand = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAGMENT = `
precision mediump float;
uniform sampler2D uVideo;
uniform sampler2D uAtlas;
uniform vec2 uRes;      // canvas, device px
uniform vec2 uCell;     // glyph cell, device px
uniform float uGlyphs;  // glyphs in the atlas
uniform vec4 uCrop;     // video uv of the canvas: offset xy, size zw
uniform vec3 uPaper;
uniform float uTime;    // seconds, for the scramble and the writhing edge
uniform vec2 uSeed;     // where the bug starts, fraction of the canvas
uniform float uSpread;  // how far it has spread, in cell heights; 0 is no bug
uniform float uHeal;    // how far the ring from the click has wiped it, in cell heights
uniform float uRing;    // how bright that ring still is, 0..1
uniform vec4 uFix[${FIXES}]; // the visitor's clicks: centre (fraction), radius (cell heights), glow
uniform vec2 uPointer;  // the pointer, device px from the top left; off the canvas when there is none

vec3 saturate3(vec3 c, float k) {
  float m = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return clamp(m + (c - m) * k, 0.0, 1.0);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 q = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 cell = floor(q / uCell);
  vec2 f = fract(q / uCell);

  // The bug: a patch around the seed whose edge reaches out in slowly turning lobes and frays cell by
  // cell. Distances are in cell heights, so it is round on screen, not stretched by the narrow cells.
  vec2 off = ((cell + 0.5) * uCell - uSeed * uRes) / uCell.y;
  float a = atan(off.y, off.x);
  float lobes = 1.0 + 0.45 * sin(3.0 * a + uTime * 0.8) + 0.25 * sin(5.0 * a - uTime * 1.3);
  float reach = length(off) + (hash(cell) - 0.5) * 2.4;
  float broken = step(0.01, uSpread) * step(reach, uSpread * lobes) * step(uHeal, reach);

  // Each of the visitor's clicks keeps its own patch clean and glows green at its edge while it opens.
  float helped = 0.0;
  for (int i = 0; i < ${FIXES}; i++) {
    vec4 k = uFix[i];
    if (k.z <= 0.0) continue;
    vec2 o = ((cell + 0.5) * uCell - k.xy * uRes) / uCell.y;
    float r = length(o) + (hash(cell + 7.0) - 0.5) * 1.6;
    broken *= step(k.z, r);
    helped = max(helped, k.w * exp(-abs(r - k.z) / 1.2));
  }

  // Broken rows slip sideways by a few cells and re-roll their glyphs about twelve times a second.
  float tick = floor(uTime * 12.0);
  float slip = broken * floor((hash(vec2(cell.y, tick)) - 0.5) * 22.0) * uCell.x;
  vec3 c = texture2D(uVideo, uCrop.xy + ((cell + 0.5) * uCell + vec2(slip, 0.0)) / uRes * uCrop.zw).rgb;
  vec3 v = texture2D(uVideo, uCrop.xy + (q + vec2(slip, 0.0)) / uRes * uCrop.zw).rgb;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));

  // Light on dark, and airy: the lit sky is fine type, the hills drop out against it, and only the sun is dense.
  float lit = pow(smoothstep(0.08, 0.95, lum), 1.3);
  float glow = smoothstep(0.9, 1.0, lum);
  float tone = max(lit * 0.5, glow);
  float index = floor(tone * (uGlyphs - 1.0) + 0.5);
  // A step of jitter per cell, so an even sky reads as grain rather than a field of one glyph.
  index = clamp(index + step(1.5, index) * floor((hash(cell * 1.7) - 0.5) * 3.0 + 0.5), 0.0, uGlyphs - 1.0);
  index = mix(index, floor(mix(0.35, 1.0, hash(cell + tick)) * (uGlyphs - 1.0)), broken);
  // Under the pointer a cell that has type gets any other glyph, re-rolled as often.
  float poked = step(length(((cell + 0.5) * uCell - uPointer) / uCell.x), ${REACH}.0) * step(0.5, index);
  index = mix(index, 1.0 + floor(hash(cell * 1.3 + tick) * (uGlyphs - 1.0)), poked);
  float mask = texture2D(uAtlas, vec2((index + f.x) / uGlyphs, f.y)).a;

  // A wash of the footage under the type, and the glyph in the cell's own colour, warmer than the footage.
  vec3 wash = mix(uPaper, saturate3(v, 1.7), 0.24);
  vec3 glyph = saturate3(c, 1.9) * (0.4 + 0.6 * lit) + vec3(0.5, 0.26, 0.06) * glow;
  // Broken type is the red of a failed check; the ring from the click is the green of a passing one.
  glyph = mix(glyph, vec3(0.95, 0.38, 0.35), broken);
  wash = mix(wash, vec3(0.16, 0.05, 0.05), broken * 0.6);
  float ring = max(uRing * exp(-abs(reach - uHeal) / 1.4), helped);
  glyph = mix(glyph, vec3(0.3, 0.76, 0.45), ring);
  wash = mix(wash, vec3(0.04, 0.12, 0.07), ring * 0.5);
  gl_FragColor = vec4(mix(wash, glyph, mask), 1.0);
}`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
  return s;
}

// Every glyph of the ramp side by side, white on transparent, at a size the shader can sample down smoothly.
function atlas(cellW: number, cellH: number) {
  const scale = 4;
  const c = document.createElement("canvas");
  c.width = Math.ceil(cellW * scale) * RAMP.length;
  c.height = Math.ceil(cellH * scale);
  const ctx = c.getContext("2d")!;
  const w = c.width / RAMP.length;
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `500 ${cellH * scale * 0.86}px "IBM Plex Mono", ui-monospace, monospace`;
  for (let i = 0; i < RAMP.length; i++) ctx.fillText(RAMP[i]!, w * i + w / 2, c.height / 2);
  return c;
}

// `focus` is the point of the clip (fractions of its frame) the crop keeps in view.
// `quiet` keeps the picture but drops the bug, the cursor and the visitor's clicks, for when something sits on top.
type Props = { src: string; focus: [number, number]; quiet?: boolean; className?: string; style?: CSSProperties };

export function AsciiVideo({ src, focus, quiet = false, className, style }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  // Without WebGL the footage simply plays as itself.
  const [plain, setPlain] = useState(false);
  const [fx, fy] = focus;

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    const cursor = cursorRef.current;
    if (!canvas || !video || !cursor) return;
    const gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false });
    if (!gl) {
      setPlain(true);
      return;
    }
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const calm = still || quiet;

    let program: WebGLProgram;
    try {
      program = gl.createProgram()!;
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("link");
    } catch {
      setPlain(true);
      return;
    }
    gl.useProgram(program);
    const u = (name: string) => gl.getUniformLocation(program, name);

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const texture = (unit: number) => {
      const t = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return t;
    };
    const videoTex = texture(0);
    const atlasTex = texture(1);
    gl.uniform1i(u("uVideo"), 0);
    gl.uniform1i(u("uAtlas"), 1);
    gl.uniform1f(u("uGlyphs"), RAMP.length);
    gl.uniform3fv(u("uPaper"), PAPER);

    let hasFrame = false;
    let cellPx = 0; // cell height, device px
    let last = -1;
    let frame = 0;
    let visible = true;
    let cancelled = false;
    let pointer: { x: number; y: number } | null = null; // where it is in the window

    // Cover the canvas, centred on the focus as far as the frame allows.
    const crop = () => {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !canvas.width) return;
      const area = canvas.width / canvas.height;
      let sw = 1;
      let sh = vw / area / vh;
      if (sh > 1) {
        sh = 1;
        sw = (vh * area) / vw;
      }
      const sx = Math.min(Math.max(fx - sw / 2, 0), 1 - sw);
      const sy = Math.min(Math.max(fy - sh / 2, 0), 1 - sh);
      gl.uniform4f(u("uCrop"), sx, sy, sw, sh);
    };

    const born = performance.now();
    const time = () => (performance.now() - born) / 1000;
    // The visitor's clicks this cycle, in canvas fractions and seconds.
    let fixes: { x: number; y: number; at: number }[] = [];
    const fixData = new Float32Array(FIXES * 4);
    // Between the wipe and the next bug the picture only changes with the footage, unless a ring is still opening.
    const busy = () =>
      !calm &&
      ((time() % CYCLE > SPREAD[0]! && time() % CYCLE < DONE) || fixes.some((k) => time() - k.at < FIX_GLOW));

    // The bug, the cursor and the click at time `now`. The seed is somewhere on the ridges.
    const scene = (now: number) => {
      const n = Math.floor(now / CYCLE);
      const t = now % CYCLE;
      const seed = [0.52 + 0.32 * rand(n), 0.46 + 0.18 * rand(n + 0.5)] as const;
      // How big the patch gets, in cell heights: about a sixth of the picture, never a speck.
      const reach = Math.max(9, (0.16 * Math.min(canvas.width, canvas.height)) / (cellPx || 1));
      const heal = easeOut(progress(t, HEAL));
      return {
        seed,
        spread: t < HEAL[1]! ? reach * easeOut(progress(t, SPREAD)) : 0,
        heal: heal * reach * 2.2,
        ring: t >= HEAL[0]! && t < HEAL[1]! + 0.3 ? 1 - progress(t, [HEAL[0]!, HEAL[1]! + 0.3]) : 0,
        reach,
        t,
      };
    };

    // The cursor comes in from the lower right on a curve, presses, waits a beat and drifts off.
    const moveCursor = (s: ReturnType<typeof scene>) => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const end = [s.seed[0] * w, s.seed[1] * h];
      const start = [w * 1.02, end[1]! + h * 0.3];
      const bend = [end[0]! + w * 0.12, start[1]! - h * 0.05];
      const k = easeInOut(progress(s.t, FLY));
      const along = (i: number) => (1 - k) ** 2 * start[i]! + 2 * (1 - k) * k * bend[i]! + k ** 2 * end[i]!;
      const away = easeInOut(progress(s.t, LEAVE));
      const x = along(0) + away * w * 0.05;
      const y = along(1) + away * h * 0.08;
      const pressed = s.t >= CLICK && s.t < CLICK + 0.14;
      const shown = s.t >= FLY[0]! && s.t < LEAVE[1]!;
      cursor.style.opacity = shown ? String(Math.min(progress(s.t, [FLY[0]!, FLY[0]! + 0.3]), 1 - away)) : "0";
      cursor.style.transform = `translate(${x}px, ${y}px) scale(${pressed ? 0.82 : 1})`;
    };

    const draw = () => {
      if (!hasFrame) return;
      const s = scene(time());
      gl.uniform1f(u("uTime"), time());
      gl.uniform2f(u("uSeed"), s.seed[0], s.seed[1]);
      // Reduced motion or quiet: no bug, no cursor, just the picture.
      gl.uniform1f(u("uSpread"), calm ? 0 : s.spread);
      gl.uniform1f(u("uHeal"), s.heal);
      gl.uniform1f(u("uRing"), calm ? 0 : s.ring);
      // A click from an earlier cycle has nothing left to clean.
      const now = time();
      fixes = fixes.filter((k) => Math.floor(k.at / CYCLE) === Math.floor(now / CYCLE));
      fixData.fill(0);
      fixes.forEach((k, i) => {
        const age = now - k.at;
        fixData.set([k.x, k.y, s.reach * 0.6 * easeOut(clamp01(age / FIX_OPEN)), 1 - clamp01(age / FIX_GLOW)], i * 4);
      });
      gl.uniform4fv(u("uFix"), fixData);
      const box = pointer && canvas.getBoundingClientRect();
      const k = box ? canvas.width / box.width : 0;
      if (pointer && box) gl.uniform2f(u("uPointer"), (pointer.x - box.left) * k, (pointer.y - box.top) * k);
      else gl.uniform2f(u("uPointer"), -1e4, -1e4);
      if (!calm) moveCursor(s);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      canvas.style.opacity = "1";
    };

    const setup = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      // Monospace proportions: a cell is about 0.6 as wide as it is tall.
      const cellH = (w >= 700 ? 9 : 8) * dpr;
      cellPx = cellH;
      const cellW = cellH * 0.6;
      gl.uniform2f(u("uRes"), canvas.width, canvas.height);
      gl.uniform2f(u("uCell"), cellW, cellH);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, atlasTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas(cellW, cellH));
      crop();
      draw();
    };

    const upload = () => {
      if (video.readyState < 2) return false;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, videoTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
      if (!hasFrame) crop();
      hasFrame = true;
      return true;
    };

    const loop = () => {
      frame = requestAnimationFrame(loop);
      if (!visible) return;
      const moved = video.currentTime !== last && upload();
      if (moved) last = video.currentTime;
      if (moved || busy() || (pointer && !still)) draw();
    };

    const seen = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      if (still) return;
      if (visible) video.play().catch(() => {});
      else video.pause();
    });
    const resize = new ResizeObserver(() => setup());
    const ready = () => {
      if (still && video.currentTime === 0) video.currentTime = 4;
      if (upload()) draw();
    };
    video.addEventListener("loadeddata", ready);
    video.addEventListener("seeked", ready);

    // The visitor's click or tap anywhere over the picture, except on the hero's own links and buttons.
    // Listened for on the window because the hero's text sits above the top of the canvas.
    const poke = (e: PointerEvent) => {
      if (calm || !hasFrame || (e.target as Element | null)?.closest?.("a, button")) return;
      const r = canvas.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      if (x < 0 || x > 1 || y < 0 || y > 1) return;
      fixes.push({ x, y, at: time() });
      if (fixes.length > FIXES) fixes.shift();
    };
    window.addEventListener("pointerdown", poke);

    // The pointer anywhere in the window: the hero's words lie on top of the canvas. Without motion
    // nothing else draws the picture again, so the pointer does.
    const move = (e: PointerEvent) => {
      pointer = { x: e.clientX, y: e.clientY };
      if (still) draw();
    };
    const leave = () => {
      pointer = null;
      draw();
    };
    const up = (e: PointerEvent) => e.pointerType !== "mouse" && leave();
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", move, { passive: true });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    document.documentElement.addEventListener("pointerleave", leave);

    // The atlas is drawn with the mono font, so wait for it before the first layout.
    document.fonts.load(`500 12px "IBM Plex Mono"`).finally(() => {
      if (cancelled) return;
      setup();
      resize.observe(canvas);
      seen.observe(canvas);
      if (!still) video.play().catch(() => {});
      frame = requestAnimationFrame(loop);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      seen.disconnect();
      video.removeEventListener("loadeddata", ready);
      video.removeEventListener("seeked", ready);
      window.removeEventListener("pointerdown", poke);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.documentElement.removeEventListener("pointerleave", leave);
    };
  }, [fx, fy, quiet]);

  return (
    <>
      <video
        ref={videoRef}
        src={src}
        muted
        loop
        playsInline
        autoPlay={plain}
        preload="auto"
        aria-hidden
        className={plain ? `${className ?? ""} object-cover` : "pointer-events-none absolute h-px w-px opacity-0"}
        style={plain ? style : undefined}
      />
      {!plain && (
        // Kane's cursor: an ordinary arrow, its tip on the point it clicks.
        <div
          ref={cursorRef}
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 z-10 opacity-0"
          style={{ marginLeft: -5, marginTop: -2, transition: "transform 0.12s cubic-bezier(0.22, 1, 0.36, 1)" }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" className="drop-shadow-[0_2px_3px_rgba(0,0,0,0.25)]">
            <path
              d="M4 2v17l4.6-4.3 3 6.8 2.9-1.3-3-6.6H18L4 2z"
              fill="#16140f"
              stroke="#fff"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      )}
      {!plain && (
        <canvas
          ref={canvasRef}
          aria-hidden
          className={className}
          style={{ opacity: 0, transition: "opacity 0.9s cubic-bezier(0.22, 1, 0.36, 1)", ...style }}
        />
      )}
    </>
  );
}
