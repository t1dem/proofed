import { useEffect, useRef, type CSSProperties, type RefObject } from "react";

// The lake of the hero's dawn after dark, in the same type. The page starts at first light and its
// tiles run from daylight to dusk; this is where it ends. It is one still of the hero's clip, not a
// second video: the sky goes black upwards and is set with stars that flicker, the ridges stand dark
// against what light is left along them, and where the sun was the moon comes up. Under the type is
// a wash of the still in the same blue, as the hero has its footage.
//
// Two things move in it besides the stars. Clouds drift over the ridges, type with a wash of their
// own, and put out the stars they pass. The lake has small waves: streaks of lighter and darker
// type that slide along it, longer and faster towards the shore the visitor stands on.
//
// Hovering the picture scrambles the type under the pointer, in its own colours, for as long as the
// pointer is there; empty sky has no type to scramble. A finger has no hover: the scramble follows
// it while it touches, then lets go. A tap or a click also sends a ring of scramble out from where
// it landed, so a phone, where a touch is over in a moment, has something to see.

// Light to dense, the hero's ramp (AsciiVideo).
const RAMP = " .,:-=+*#%@";
// What the type under the pointer is scrambled into: any glyph at all, not the picture's few.
const SCRAMBLE = ".'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
const STILL = "/clips/hero-dawn.jpg";
// How far down the still the picture goes, in fractions of its height: under that is only more lake.
// That line stands on the canvas's bottom edge, and whatever the canvas has above the ridges is sky.
const FLOOR = 0.92;
// The still is laid out as wide as the canvas and LOW of its own height: a long low shore, not a wall
// of dark hills. It is this tall at least, px, and no taller than it gets on the widest canvas. On a
// phone that would leave a third of its width, most of it the dark near shore: there it is no wider
// than WIDEST canvases, around FOCUS, so the lake and the far ridges are in the picture too.
const LOW = 0.62;
const FRAME = { min: 390, max: 586 };
const WIDEST = 1.3;
// The point of the still's width a narrow canvas is centred on: the lake to the left of it, the moon to the right.
const FOCUS = 0.72;
// Where the sky is black and where it is as light as it gets, in fractions of the still's height:
// the second is about the top of the ridges. Stars are only above STARS, where no ridge reaches.
const DUSK = [0.23, 0.44];
const STARS = 0.33;
// The clouds' band of the sky and where the lake starts, in the same fractions. The band begins
// under the last line that lies on the sky, so no cloud ever has a hole cut in it for a word.
const CLOUDS = [0.22, 0.41];
const SHORE = [0.73, 0.77];
// The page's ground (.night in index.css): the wash ends in it, so the picture has no top edge.
const PAPER = [8, 8, 10];
const WIND = 1.5; // the clouds' drift, cells a second
const PUFF = 28; // a cloud's grain, cells: they repeat every few of these past the canvas's width
const SWELL = 2.2; // the waves' slide at the near shore, cells a second
const REACH = 5; // how far around the pointer the type scrambles, in cell widths
// A tap's ring: how far it opens and how thick it starts, in cell widths, and how long it lasts, seconds.
const RING = { opens: 30, thick: 5, lasts: 0.9 };

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
// A repeatable 0..1 for a cell, so the picture is the same on every layout.
const hash = (x: number, y: number) => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
};
// Soft noise over a grid of such numbers; with `every`, it repeats after that many steps along x.
const noise = (x: number, y: number, every = 0) => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const at = (a: number, b: number) => hash(every ? ((a % every) + every) % every : a, b);
  const sx = smooth(0, 1, x - xi);
  const sy = smooth(0, 1, y - yi);
  const top = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * sx;
  const bottom = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * sx;
  return top + (bottom - top) * sy;
};
const mix = (a: number[], b: number[], k: number) => a.map((v, i) => v + (b[i]! - v) * k);
const rgb = (c: number[], alpha = 1) => `rgb(${c.map(Math.round).join(" ")} / ${alpha})`;

const DIM = [78, 96, 142];
const LIT = [190, 206, 238];
const MOON = [238, 241, 250];
const CLOUD = [150, 168, 214];

// What a cell is when nothing is happening to it.
const TYPE = 0;
const STAR = 1;
const CLEAR = 2; // under the footer's words: nothing is ever drawn there

// `avoid` holds the words that lie on the sky: the cells under its heading, links, buttons and lines stay empty.
export function Night({ avoid, className, style }: { avoid: RefObject<HTMLElement | null>; className?: string; style?: CSSProperties }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const washRef = useRef<HTMLCanvasElement>(null);
  const cloudRef = useRef<HTMLCanvasElement>(null);
  const typeRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const under = washRef.current;
    const haze = cloudRef.current;
    const canvas = typeRef.current;
    const wash = under?.getContext("2d");
    const ctx = canvas?.getContext("2d");
    if (!root || !under || !haze || !canvas || !wash || !ctx) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

    // The still's size and brightness, and the still as the night has it, for the wash.
    let FW = 0;
    let FH = 0;
    let lum = new Float32Array(0);
    const night = document.createElement("canvas");

    let cols = 0;
    let rows = 0;
    let cw = 0;
    let ch = 0;
    // The picture at rest.
    let kind = new Uint8Array(0);
    let glyph = new Uint8Array(0); // index in RAMP
    let shade = new Float32Array(0); // type: how lit, 0..1, over 1 for the moon; a star: its brightness
    let grain = new Float32Array(0); // a cell's own 0..1: what it rounds its glyph by
    // What a cloud or a wave has made of a cell for now: its glyph, how lit, and whether its star is out.
    let shown = new Uint8Array(0);
    let light = new Float32Array(0);
    let veiled = new Uint8Array(0);
    let room = new Float32Array(0); // how much of a cloud or a wave shows in the cell, 0..1
    let held = new Uint8Array(0); // under the pointer: 2 is scrambled, 1 is next to it and drawn with it
    let stars: number[] = [];
    let sky: number[] = []; // the cells clouds pass
    let lake: number[] = [];
    // The clouds: a strip of sky `wide` cells long that comes round again, `tall` rows from row `high`.
    let clouds = new Float32Array(0);
    let wide = 0;
    let tall = 0;
    let high = 0;
    let shore = 0; // the lake's first row
    let patch: number[] = []; // the cells under the pointer and next to them
    let pointer: { x: number; y: number } | null = null; // where it is in the window
    let rings: { x: number; y: number; at: number }[] = []; // taps, in cells of the canvas

    let frame = 0;
    let visible = false;
    let cancelled = false;
    const born = performance.now();
    const time = () => (performance.now() - born) / 1000;

    const wipe = (i: number) => ctx.clearRect((i % cols) * cw, Math.floor(i / cols) * ch, cw, ch);

    const draw = (i: number, now: number) => {
      const star = kind[i] === STAR && !veiled[i];
      if (!star && !shown[i]) return;
      if (star) {
        const flicker = still ? 0.8 : 0.6 + 0.4 * Math.sin(now * (0.5 + 1.6 * hash(i, 3)) + hash(i, 7) * 6.283);
        ctx.fillStyle = rgb(MOON, shade[i]! * flicker);
      } else ctx.fillStyle = rgb(light[i]! > 1 ? MOON : mix(DIM, LIT, light[i]!));
      const x = (i % cols) * cw + cw / 2;
      const y = Math.floor(i / cols) * ch + ch / 2;
      if (held[i] !== 2) return void ctx.fillText(RAMP[star ? glyph[i]! : shown[i]!]!, x, y);
      // Scrambled: another glyph twelve times a second, knocked a little out of its column.
      const roll = Math.floor(now * 12);
      ctx.fillText(SCRAMBLE[Math.floor(hash(i + roll * 13.7, roll * 7.3) * SCRAMBLE.length)]!, x + (hash(roll * 3.1, i + roll) - 0.5) * cw * 1.6, y);
    };

    const paint = (i: number, now: number) => {
      wipe(i);
      draw(i, now);
    };

    // The scramble under the pointer. A scrambled glyph sticks out of its cell, so the cells around
    // the patch are wiped and drawn with it, every frame, and nothing else draws them meanwhile.
    const hover = (now: number) => {
      const old = patch;
      patch = [];
      for (const i of old) {
        held[i] = 0;
        wipe(i);
      }
      // Scrambles the cells `from` to `to` cell widths away from a point of the canvas, in cells.
      const scramble = (px: number, py: number, from: number, to: number) => {
        const down = Math.ceil(((to + 2) * cw) / ch);
        for (let r = Math.max(Math.floor(py) - down, 0); r <= Math.min(Math.floor(py) + down, rows - 1); r++) {
          for (let c = Math.max(Math.floor(px - to) - 2, 0); c <= Math.min(Math.floor(px + to) + 2, cols - 1); c++) {
            const i = r * cols + c;
            const far = Math.hypot(c + 0.5 - px, ((r + 0.5 - py) * ch) / cw);
            if (far > to + 1.5 || far < from - 1.5) continue;
            if (!held[i]) (patch.push(i), wipe(i));
            held[i] = Math.max(held[i]!, far < to && far >= from && kind[i] !== CLEAR ? 2 : 1);
          }
        }
      };
      const box = pointer && canvas.getBoundingClientRect();
      if (pointer && box && pointer.x >= box.left && pointer.x <= box.right && pointer.y >= box.top && pointer.y <= box.bottom) {
        const k = canvas.width / box.width;
        scramble(((pointer.x - box.left) * k) / cw, ((pointer.y - box.top) * k) / ch, 0, REACH);
      }
      // A tap's ring: it opens fast, slows, and thins out as it goes.
      rings = rings.filter((ring) => now - ring.at < RING.lasts);
      for (const ring of rings) {
        const k = (now - ring.at) / RING.lasts;
        const r = RING.opens * (1 - (1 - k) ** 3);
        scramble(ring.x, ring.y, r - RING.thick * (1 - k), r);
      }
      for (const i of old) if (!held[i]) draw(i, now);
      for (const i of patch) if (held[i] === 1) draw(i, now);
      for (const i of patch) if (held[i] === 2) draw(i, now);
    };

    // A cell as a cloud or a wave has it now. It is drawn again only if that changed what it shows.
    const set = (i: number, g: number, l: number, veil: number, now: number, draw: boolean) => {
      if (shown[i] === g && veiled[i] === veil && Math.abs(light[i]! - l) < 0.06) return;
      shown[i] = g;
      light[i] = l;
      veiled[i] = veil;
      if (draw && !held[i]) paint(i, now);
    };

    // The clouds and the waves at time `now`.
    const weather = (now: number, draw: boolean) => {
      const blown = now * WIND;
      for (const i of sky) {
        const x = ((((i % cols) - blown) % wide) + wide) % wide;
        const x0 = Math.floor(x);
        const row = (Math.floor(i / cols) - high) * wide;
        const thick = (clouds[row + x0]! + (clouds[row + ((x0 + 1) % wide)]! - clouds[row + x0]!) * (x - x0)) * room[i]!;
        const more = Math.floor(thick * 4.2 + grain[i]!);
        const base = kind[i] === STAR ? 0 : glyph[i]!;
        if (more) set(i, Math.min(base + more, 6), Math.min(Math.max(shade[i]!, 0.3) + thick * 0.45, 1), 1, now, draw);
        else set(i, base, shade[i]!, 0, now, draw);
      }
      for (const i of lake) {
        const c = i % cols;
        const r = Math.floor(i / cols);
        const near = (r - shore) / Math.max(rows - shore, 1);
        const w = noise((c + now * SWELL * (0.45 + 0.55 * near)) / (8 + 10 * near), r * 0.83 + now * 0.1);
        const crest = smooth(0.55, 0.85, w) * room[i]!;
        const trough = smooth(0.45, 0.15, w) * room[i]!;
        const g = Math.min(Math.max(glyph[i]! + Math.floor(crest * 2.6 - trough * 1.6 + grain[i]!), 0), 5);
        set(i, g, Math.min(Math.max(shade[i]!, 0.25) + crest * 0.4, 1), 0, now, draw);
      }
      haze.style.transform = `translateX(${((((blown % wide) + wide) % wide) - wide) * (cw / canvas.width) * canvas.clientWidth}px)`;
    };

    const setup = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h || !FW) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      // The hero's cells, on whole device pixels so that one can be wiped without touching the next.
      ch = Math.round((w >= 700 ? 9 : 8) * dpr);
      cw = Math.round(ch * 0.6);
      cols = Math.ceil(canvas.width / cw);
      rows = Math.ceil(canvas.height / ch);
      const n = cols * rows;
      kind = new Uint8Array(n);
      glyph = new Uint8Array(n);
      shade = new Float32Array(n);
      grain = new Float32Array(n);
      veiled = new Uint8Array(n);
      room = new Float32Array(n);
      held = new Uint8Array(n);
      stars = [];
      sky = [];
      lake = [];
      patch = [];

      // Where the still lies, device px: as wide as the canvas or wider, its FLOOR on the canvas's bottom.
      const fh = Math.min(Math.max((canvas.width * FH * LOW) / FW, FRAME.min * dpr), FRAME.max * dpr);
      const fw = Math.min((fh * FW) / FH / LOW, Math.max(canvas.width * WIDEST, canvas.width));
      const ox = Math.min(Math.max(FOCUS * fw - canvas.width / 2, 0), fw - canvas.width);
      const oy = FLOOR * fh - canvas.height;
      under.width = canvas.width;
      under.height = canvas.height;
      wash.drawImage(night, -ox, -oy, fw, fh);
      const rowOf = (v: number) => Math.min(Math.max(Math.round((v * fh - oy) / ch), 0), rows);
      high = rowOf(CLOUDS[0]!);
      tall = rowOf(CLOUDS[1]!) - high;
      shore = rowOf(SHORE[0]!);

      const box = canvas.getBoundingClientRect();
      const kept = [...(avoid.current?.querySelectorAll("h2, a, p") ?? [])].map((el) => {
        const r = el.getBoundingClientRect();
        return [(r.left - box.left - 6) * dpr, (r.top - box.top - 4) * dpr, (r.right - box.left + 6) * dpr, (r.bottom - box.top + 4) * dpr];
      });

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const x = (c + 0.5) * cw;
          const y = (r + 0.5) * ch;
          if (kept.some(([l, t, rt, b]) => x + cw / 2 > l! && x - cw / 2 < rt! && y + ch / 2 > t! && y - ch / 2 < b!)) {
            kind[i] = CLEAR;
            continue;
          }
          const u = Math.min((ox + x) / fw, 0.999);
          const v = (oy + y) / fh;
          const l = lum[Math.max(Math.floor(v * FH), 0) * FW + Math.floor(u * FW)]!;
          const lit = smooth(0.08, 0.95, l) ** 1.3;
          const dusk = smooth(DUSK[0]!, DUSK[1]!, v);
          // The moon's light is the brightest of the still, where the sky has not gone black yet.
          const moon = smooth(0.9, 1, l) * Math.min(dusk * 3, 1);
          // Finer than the dawn's: the wash carries the light, and only the moon is dense.
          const tone = Math.max(lit * 0.36 * dusk ** 1.6, moon);
          // Rounded by chance, so the sky thins out into single dots instead of ending on a line, and
          // then a step of jitter, so an even patch reads as grain, not a field of one glyph.
          grain[i] = hash(c * 1.7, r * 1.7);
          let index = Math.floor(tone * (RAMP.length - 1) + grain[i]!);
          if (index >= 2) index = Math.min(index + Math.floor((hash(c * 2.3, r * 0.9) - 0.5) * 3 + 0.5), RAMP.length - 1);
          // Clouds pass where the still has sky, not in front of a ridge, and not over the moon;
          // waves run on the lake, plainest where it is light.
          if (r >= high && r < high + tall) {
            room[i] = smooth(0.4, 0.58, l) * (1 - moon);
            if (room[i]! > 0.02) sky.push(i);
          } else if (r >= shore) {
            room[i] = smooth(SHORE[0]!, SHORE[1]!, v) * (0.35 + 0.65 * lit);
            lake.push(i);
          }
          if (index) {
            glyph[i] = index;
            shade[i] = moon > 0.25 ? 2 : (0.3 + 0.7 * lit) * (0.45 + 0.55 * dusk);
            continue;
          }
          // Stars in the empty sky, coming in from the top, where the section before this one ends.
          if (v > STARS || hash(c + 11, r + 5) > 0.026 * smooth(0, 0.2, r / rows)) continue;
          const size = hash(c + 3, r + 17);
          kind[i] = STAR;
          glyph[i] = RAMP.indexOf(size > 0.93 ? "*" : size > 0.7 ? "+" : ".");
          shade[i] = size > 0.93 ? 0.95 : size > 0.7 ? 0.7 : 0.55;
          stars.push(i);
        }
      }
      shown = glyph.slice();
      light = shade.slice();

      // The clouds' strip: long soft shapes, thickest in the middle of their band and gone at its
      // edges. Their wash is the same strip, a pixel for a cell, laid twice end to end, blurred and
      // slid along under the type.
      wide = (Math.ceil(cols / PUFF) + 3) * PUFF;
      clouds = new Float32Array(wide * Math.max(tall, 1));
      haze.width = wide * 2;
      haze.height = Math.max(tall, 1);
      const mist = haze.getContext("2d")!;
      for (let r = 0; r < tall; r++) {
        const band = Math.sin((Math.PI * (r + 0.5)) / tall) ** 1.5;
        for (let c = 0; c < wide; c++) {
          const puff = 0.55 * noise(c / PUFF, r / 4.5, wide / PUFF) + 0.3 * noise((c * 2) / PUFF, r / 2.2 + 9, (wide * 2) / PUFF) + 0.15 * noise((c * 4) / PUFF, r / 1.1 + 31, (wide * 4) / PUFF);
          const thick = smooth(0.5, 0.72, puff) * band;
          clouds[r * wide + c] = thick;
          mist.fillStyle = rgb(CLOUD, thick * 0.3);
          mist.fillRect(c, r, 1, 1);
          mist.fillRect(c + wide, r, 1, 1);
        }
      }
      haze.style.top = `${(high * ch) / dpr}px`;
      haze.style.width = `${(wide * 2 * cw) / dpr}px`;
      haze.style.height = `${(tall * ch) / dpr}px`;

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `500 ${ch * 0.86}px "IBM Plex Mono", ui-monospace, monospace`;
      const now = time();
      weather(now, false);
      for (let i = 0; i < n; i++) if (shown[i] || kind[i] === STAR) paint(i, now);
      root.style.opacity = "1";
    };

    // Only what changes is drawn again: the patch under the pointer every frame, and about twelve
    // times a second the stars and whatever a cloud or a wave has just reached or left.
    let ticked = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      const now = time();
      hover(now);
      if (now - ticked < 0.08) return;
      ticked = now;
      for (const i of stars) if (!held[i] && !veiled[i]) paint(i, now);
      weather(now, true);
    };

    // The pointer anywhere in the window: the footer's words lie on top of the canvas, and the page
    // can scroll under a pointer that does not move. Without motion nothing else redraws the patch.
    const move = (e: PointerEvent) => {
      pointer = { x: e.clientX, y: e.clientY };
      if (still && cols) hover(time());
    };
    const leave = () => {
      pointer = null;
      if (still && cols) hover(time());
    };
    const up = (e: PointerEvent) => e.pointerType !== "mouse" && leave();
    const tap = (e: PointerEvent) => {
      move(e);
      const box = canvas.getBoundingClientRect();
      if (still || !cols || e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) return;
      const k = canvas.width / box.width;
      rings.push({ x: ((e.clientX - box.left) * k) / cw, y: ((e.clientY - box.top) * k) / ch, at: time() });
    };

    const seen = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      cancelAnimationFrame(frame);
      if (visible && !still) frame = requestAnimationFrame(loop);
    });
    const resize = new ResizeObserver(() => setup());

    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      FW = img.naturalWidth;
      FH = img.naturalHeight;
      const c = document.createElement("canvas");
      c.width = FW;
      c.height = FH;
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0);
      const data = g.getImageData(0, 0, FW, FH);
      const px = data.data;
      lum = new Float32Array(FW * FH);
      for (let i = 0; i < lum.length; i++) lum[i] = (0.2126 * px[i * 4]! + 0.7152 * px[i * 4 + 1]! + 0.0722 * px[i * 4 + 2]!) / 255;
      // The wash: the still in the night's blue, going into the page's ground towards the top of the sky.
      for (let i = 0; i < lum.length; i++) {
        const l = lum[i]!;
        const k = 0.62 * smooth(DUSK[0]!, DUSK[1]!, Math.floor(i / FW) / FH);
        const moon = smooth(0.85, 1, l);
        [48 + 110 * moon, 68 + 100 * moon, 124 + 76 * moon].forEach((c, j) => (px[i * 4 + j] = PAPER[j]! + (c * l - PAPER[j]!) * k));
      }
      night.width = FW;
      night.height = FH;
      night.getContext("2d")!.putImageData(data, 0, 0);
      // The type is drawn with the mono font, so wait for it before the first layout.
      document.fonts.load(`500 12px "IBM Plex Mono"`).finally(() => {
        if (cancelled) return;
        setup();
        resize.observe(canvas);
        if (avoid.current) resize.observe(avoid.current);
        seen.observe(canvas);
        window.addEventListener("pointermove", move, { passive: true });
        window.addEventListener("pointerdown", tap, { passive: true });
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
        document.documentElement.addEventListener("pointerleave", leave);
      });
    };
    img.src = STILL;

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      seen.disconnect();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", tap);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.documentElement.removeEventListener("pointerleave", leave);
    };
  }, [avoid]);

  return (
    <div ref={rootRef} aria-hidden className={`overflow-hidden ${className ?? ""}`} style={{ opacity: 0, transition: "opacity 0.9s cubic-bezier(0.22, 1, 0.36, 1)", ...style }}>
      <canvas ref={washRef} className="absolute inset-0 h-full w-full" />
      <canvas ref={cloudRef} className="absolute left-0 blur-[6px]" />
      <canvas ref={typeRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
