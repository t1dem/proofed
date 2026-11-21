import { useEffect, useRef } from "react";

// A word that gets a bug and its fix, once, when it is reached: what Proofed does to a pull request,
// played on the page's last heading. Its letters turn into red scrambled type, one after another
// from the middle; Kane's cursor flies in and clicks the word; a green ring from the click puts the
// letters back, each green for a moment. A letter keeps its own box while it is scrambled, so
// nothing around the word moves. Without motion the word is just the word. `tail` is what follows
// it and stays with it on its line.

const GLYPHS = "#%@*+=:-";
// The story, in seconds from when the word is reached.
const BREAK = 0.4; // the middle letter breaks
const STEP = 0.2; // and each next one out from it
const FLY = [1.0, 1.85]; // the cursor flies to it
const CLICK = 1.95;
const MEND = 0.085; // each next letter out from the click is put back
const GLOW = 0.7; // and stays green this long
const RING = 0.7; // the ring from the click
const LEAVE = [2.6, 3.3]; // the cursor drifts off and fades
const DONE = Math.max(LEAVE[1]!, CLICK + GLOW + 1);

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);
const progress = (t: number, [a, b]: number[]) => clamp01((t - a!) / (b! - a!));
const easeOut = (x: number) => 1 - (1 - x) ** 3;
const easeInOut = (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);

export function Mended({ word, tail = "" }: { word: string; tail?: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const cursor = useRef<HTMLSpanElement>(null);
  const ring = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = box.current;
    const arrow = cursor.current;
    const circle = ring.current;
    if (!el || !arrow || !circle || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const play = () => {
      const letters = [...el.querySelectorAll<HTMLElement>("[data-letter]")].map((l) => ({ real: l.children[0] as HTMLElement, glyph: l.children[1] as HTMLElement, box: l }));
      const mid = Math.floor(letters.length / 2);
      const from = el.getBoundingClientRect();
      const at = letters[mid]!.box.getBoundingClientRect();
      // The point Kane clicks: the middle letter, a little under its centre.
      const x = at.left - from.left + at.width / 2;
      const y = at.top - from.top + at.height * 0.58;
      // Where the cursor comes from and how wide the ring opens, by the size of the type.
      const reach = from.height;
      const t0 = performance.now();
      const tick = () => {
        const t = (performance.now() - t0) / 1000;
        letters.forEach(({ real, glyph }, i) => {
          const far = Math.abs(i - mid);
          const mended = t - (CLICK + 0.05 + far * MEND);
          const broken = t >= BREAK + far * STEP && mended < 0;
          real.style.opacity = broken ? "0" : "";
          glyph.style.opacity = broken ? "1" : "0";
          glyph.textContent = broken ? GLYPHS[(Math.floor(t * 13 + i * 0.37) * 7 + i * 3) % GLYPHS.length]! : "";
          real.style.color = mended >= 0 && mended < GLOW ? `color-mix(in srgb, var(--color-ok) ${Math.round((1 - mended / GLOW) * 100)}%, currentColor)` : "";
        });
        const fly = easeInOut(progress(t, FLY));
        const leave = easeInOut(progress(t, LEAVE));
        const cx = x + (1 - fly) * reach * 2.6 + leave * reach * 0.8;
        const cy = y + (1 - fly) * reach * 1.9 + leave * reach * 0.6;
        const pressed = t >= CLICK && t < CLICK + 0.16;
        arrow.style.transform = `translate(${cx}px, ${cy}px) scale(${pressed ? 0.82 : 1})`;
        arrow.style.opacity = String(Math.min(progress(t, [FLY[0]!, FLY[0]! + 0.3]), 1 - leave));
        const open = progress(t, [CLICK, CLICK + RING]);
        const size = easeOut(open) * reach * 5;
        circle.style.width = circle.style.height = `${size}px`;
        circle.style.transform = `translate(${x - size / 2}px, ${y - size / 2}px)`;
        circle.style.opacity = open > 0 && open < 1 ? String(0.9 * (1 - open)) : "0";
        if (t < DONE) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };
    // Once the word is well inside the screen, not at its very edge.
    const seen = new IntersectionObserver(([e]) => e?.isIntersecting && (seen.disconnect(), play()), { threshold: 1, rootMargin: "0px 0px -15% 0px" });
    seen.observe(el);
    return () => (seen.disconnect(), cancelAnimationFrame(frame));
  }, [word]);

  return (
    <span ref={box} className="relative inline-block whitespace-nowrap">
      {[...word].map((letter, i) => (
        <span key={i} data-letter className="relative inline-block">
          <span>{letter}</span>
          <span className="absolute inset-0 grid place-items-center font-mono text-[0.72em] font-medium tracking-normal text-bad opacity-0" />
        </span>
      ))}
      {tail}
      <span ref={ring} className="pointer-events-none absolute left-0 top-0 rounded-full border-2 border-ok opacity-0" />
      {/* Kane's cursor: an ordinary arrow, its tip on the point it clicks. */}
      <span ref={cursor} className="pointer-events-none absolute left-0 top-0 z-10 opacity-0" style={{ marginLeft: -6, marginTop: -3, transition: "transform 0.12s cubic-bezier(0.22, 1, 0.36, 1)" }}>
        <svg width="34" height="34" viewBox="0 0 24 24" className="block drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">
          <path d="M4 2v17l4.6-4.3 3 6.8 2.9-1.3-3-6.6H18L4 2z" fill="#16140f" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </span>
    </span>
  );
}
