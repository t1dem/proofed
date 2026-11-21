import { ArrowUpRight, CircleX, GitMerge } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { BRANDS, type Brand } from "./brands";
import { DAWN } from "./dawn";

// The README's nine regressions: merged pull requests from open-source projects that shipped a bug the
// maintainers fixed later. Each was replayed with Proofed; Kane caught every one and checked every fix.
// The section is Kane's own recordings of the nine, on two screens in the app's dark frame: a phone
// for the Android apps and a wide screen for the web and Electron ones. One recording plays at a
// time and the other screen waits, dimmed. Under the screens is what the recording on now shows and
// its two pull requests: the project's, merged, and our replay with Kane's report. Under the frame
// are the nine projects, a column per platform, each with how many days its bug stayed; the one on
// screen is in its platform's colour of the dawn. The recordings play one after another from when
// the frame is reached, a platform after another, until the visitor picks a project. Narrower than
// lg there is one screen, whichever is playing, and the columns are a strip to swipe.
// `clip` is the recording in /clips/bugs (.mp4 and its first frame, .jpg); `days` is how long after
// the pull request the maintainers' fix came; `replay` is our copy, with Kane's report.

type Bug = { clip: string; upstream: string; broke: string; days: number; replay: string };

const PLATFORMS: { name: string; brand: Brand; fill: string; phone?: boolean; bugs: Bug[] }[] = [
  {
    name: "Web",
    brand: "chrome",
    fill: DAWN.blue,
    bugs: [
      { clip: "omni-tools", upstream: "https://github.com/iib0011/omni-tools/pull/32", broke: "1, 2 and 4 on separate lines add up to 0 instead of 7", days: 567, replay: "https://github.com/t1dem/omni-tools/pull/1" },
      { clip: "frontend-mini-challenges", upstream: "https://github.com/sadanandpai/frontend-mini-challenges/pull/264", broke: "A deleted task stays in the list", days: 28, replay: "https://github.com/t1dem/frontend-mini-challenges/pull/1" },
      { clip: "excalidraw", upstream: "https://github.com/excalidraw/excalidraw/pull/11974", broke: "The main menu stays open after a click on the canvas", days: 12, replay: "https://github.com/t1dem/excalidraw/pull/1" },
    ],
  },
  {
    name: "Android",
    brand: "android",
    fill: DAWN.gold,
    phone: true,
    bugs: [
      { clip: "anki-android", upstream: "https://github.com/ankidroid/Anki-Android/pull/20889", broke: "A deck picked in the card browser search doesn't change the filter", days: 180, replay: "https://github.com/t1dem/Anki-Android/pull/1" },
      { clip: "opencalc", upstream: "https://github.com/Darkempire78/OpenCalc/pull/520", broke: "The decimal point in the first number of 2×0.5 is ignored", days: 81, replay: "https://github.com/t1dem/OpenCalc/pull/1" },
      { clip: "quillpad", upstream: "https://github.com/quillpad/quillpad/pull/396", broke: "Back in a note sends the app to the background instead of the notes list", days: 24, replay: "https://github.com/t1dem/quillpad/pull/1" },
    ],
  },
  {
    name: "Electron",
    brand: "electron",
    fill: DAWN.clay,
    bugs: [
      { clip: "zettlr-pandoc", upstream: "https://github.com/Zettlr/Zettlr/pull/6031", broke: "An empty Pandoc span turns off highlighting in the note", days: 211, replay: "https://github.com/t1dem/zettlr-pandoc/pull/1" },
      { clip: "marktext", upstream: "https://github.com/marktext/marktext/pull/5276", broke: "A folded heading unfolds after switching tabs", days: 24, replay: "https://github.com/t1dem/marktext/pull/1" },
      { clip: "zettlr", upstream: "https://github.com/Zettlr/Zettlr/pull/6001", broke: "A blank line between paragraphs loses its ¶ mark", days: 7, replay: "https://github.com/t1dem/Zettlr/pull/1" },
    ],
  },
];

const PER = 3;
// All nine in a row, a platform after another: bug `b` of platform `p` is at `p * PER + b`.
const BUGS = PLATFORMS.flatMap((p) => p.bugs.map((b) => ({ ...b, phone: !!p.phone })));
// The order they play in by themselves: each platform's longest-lived bug first, then their second ones.
const ORDER = BUGS.map((_, i) => (i % PLATFORMS.length) * PER + Math.floor(i / PLATFORMS.length));

// "https://github.com/excalidraw/excalidraw/pull/11974" as its owner, its repository and its number.
function parts(upstream: string) {
  const [owner = "", name = "", , n = ""] = new URL(upstream).pathname.slice(1).split("/");
  return { owner, name, n };
}

const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const out = "inline-flex items-center gap-1.5 whitespace-nowrap text-[16px] text-dim underline decoration-white/20 underline-offset-4 transition-colors hover:text-fg sm:text-[14.5px]";

export function Bugs() {
  const box = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLUListElement>(null);
  // A recording of its own for every bug, so a screen can pass from one to the next without a gap.
  const clips = useRef<(HTMLVideoElement | null)[]>([]);
  // The bug whose recording is on, and the bug each screen holds: its own last one.
  const [at, setAt] = useState(0);
  const [held, setHeld] = useState({ wide: 0, phone: BUGS.findIndex((b) => b.phone) });
  // Playing through by itself, until the visitor picks a project.
  const [auto, setAuto] = useState(true);
  // Nothing plays while the frame is off the screen, or before a pick if the visitor asked for no
  // motion. The recordings that aren't on a screen yet get their first frames once it has been reached.
  const [seen, setSeen] = useState(false);
  const [reached, setReached] = useState(false);
  const [moving, setMoving] = useState(() => !still());
  const later = useRef(0);
  const bug = BUGS[at]!;

  const show = (i: number) => {
    // From its start: it may have been played before.
    const v = clips.current[i];
    if (v && v.currentTime) v.currentTime = 0;
    setAt(i);
    setHeld((h) => ({ ...h, [BUGS[i]!.phone ? "phone" : "wide"]: i }));
  };
  const pick = (i: number) => {
    clearTimeout(later.current);
    setAuto(false);
    setMoving(true);
    show(i);
    // Started in the click itself, for where the browser only lets a video start from one.
    clips.current[i]?.play().catch(() => {});
    // The projects are under the screens: bring the screens back if they have gone off the top.
    if ((box.current?.getBoundingClientRect().top ?? 0) < 0) box.current?.scrollIntoView({ behavior: still() ? "auto" : "smooth" });
  };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => (setSeen(!!e?.isIntersecting), e?.isIntersecting && setReached(true)), { threshold: 0.5 });
    io.observe(el);
    return () => (io.disconnect(), clearTimeout(later.current));
  }, []);
  // The recording that is on plays while the frame is seen; the others stay where they stopped.
  useEffect(() => {
    clips.current.forEach((v, i) => {
      if (!v) return;
      if (i === at && seen && moving && !v.ended) v.play().catch(() => {});
      else v.pause();
    });
  }, [at, seen, moving]);
  // On a phone the strip follows the recording to its platform's column.
  useEffect(() => {
    const ul = strip.current;
    const col = ul?.children[Math.floor(at / PER)] as HTMLElement | undefined;
    if (ul && col && ul.scrollWidth > ul.clientWidth) ul.scrollTo({ left: col.offsetLeft - parseFloat(getComputedStyle(ul).scrollPaddingLeft || "0"), behavior: still() ? "auto" : "smooth" });
  }, [at]);

  const ended = () => {
    if (auto) later.current = window.setTimeout(() => show(ORDER[(ORDER.indexOf(at) + 1) % ORDER.length]!), 1400);
  };
  // A screen's recordings lie one on another. The one it holds comes in over the one before, which
  // stays under it until it is covered.
  const screen = (which: "wide" | "phone") =>
    BUGS.map((b, i) => {
      if (b.phone !== (which === "phone")) return null;
      const on = held[which] === i;
      return (
        <video
          key={b.clip}
          ref={(v) => void (clips.current[i] = v)}
          src={`/clips/bugs/${b.clip}.mp4`}
          poster={on || reached ? `/clips/bugs/${b.clip}.jpg` : undefined}
          muted
          playsInline
          preload="none"
          onEnded={ended}
          aria-label={`Kane's recording: ${b.broke}`}
          aria-hidden={!on}
          className={`absolute inset-0 size-full transition-opacity ${on ? "z-10 duration-500" : "opacity-0 delay-500 duration-0"}`}
        />
      );
    });
  // Narrower than lg the two screens are one on another and only the playing one is seen.
  const slot = (on: boolean) => `absolute inset-0 flex items-center justify-center transition-opacity duration-500 lg:relative lg:inset-auto ${on ? "" : "max-lg:pointer-events-none max-lg:opacity-0 lg:opacity-35"}`;
  const { owner, name, n } = parts(bug.upstream);

  return (
    <section id="bugs" className="py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-8">
        <h2 className="max-w-4xl text-[2.2rem] sm:text-balance font-semibold leading-[1.08] tracking-[-0.03em] sm:text-5xl">
          Nine merged PRs shipped a bug. <span className="text-faint">Kane caught all nine.</span>
        </h2>
        <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-dim">
          We replayed each one with Proofed. The number is how many days the bug lived before a fix.
        </p>

        <div ref={box} className="mt-12 scroll-mt-4 overflow-hidden rounded-3xl border border-edge bg-side">
          <div className="relative aspect-square sm:aspect-video lg:grid lg:aspect-auto lg:grid-cols-[23%_minmax(0,1fr)]">
            <div className={slot(bug.phone)}>
              <div className="relative aspect-[9/20] h-[calc(100%-2rem)] overflow-hidden rounded-[1.25rem] border border-edge bg-black lg:absolute lg:h-[calc(100%-2.5rem)]">{screen("phone")}</div>
            </div>
            <div className={`${slot(!bug.phone)} lg:border-l lg:border-edge`}>
              <div className="relative aspect-video w-full overflow-hidden bg-black">{screen("wide")}</div>
            </div>
          </div>

          <div className="flex min-h-[9.5rem] flex-col justify-center gap-x-8 gap-y-3 border-t border-edge px-4 py-4 sm:min-h-[7rem] sm:px-5 lg:min-h-[4.5rem] lg:flex-row lg:items-center lg:justify-between">
            <p className="flex min-w-0 gap-2.5 text-[17px] font-medium leading-snug">
              <CircleX aria-label="Failed" size={19} strokeWidth={2.25} className="mt-[2px] shrink-0 text-bad" />
              <span className="text-pretty">{bug.broke}</span>
            </p>
            <p className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2">
              <a href={bug.upstream} title="The merged pull request" className={out}>
                <span role="img" aria-label="Merged" className="grid size-5 place-items-center rounded-full bg-[#8250df] text-white">
                  <GitMerge size={12} strokeWidth={2.5} />
                </span>
                {owner}/{name} #{n}
              </a>
              <a href={bug.replay} title="Our replay of it, with Kane's report" className={out}>
                Kane's report <ArrowUpRight aria-hidden size={15} strokeWidth={2.25} />
              </a>
            </p>
          </div>
        </div>

        <ul ref={strip} className="relative mt-3 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto [scrollbar-width:none] max-lg:-mx-4 max-lg:px-4 sm:scroll-px-8 sm:max-lg:-mx-8 sm:max-lg:px-8 lg:grid lg:grid-cols-3 lg:overflow-visible">
          {PLATFORMS.map((p, pi) => (
            <li key={p.name} style={{ "--fill": p.fill } as CSSProperties} className="w-[88%] max-w-[400px] shrink-0 snap-start lg:w-auto lg:max-w-none">
              <p className="flex items-center gap-2 px-1 pb-3 pt-4 text-[15px] font-semibold text-dim">
                <svg viewBox="0 0 24 24" aria-hidden className="size-5 fill-current">
                  <path d={BRANDS[p.brand]} />
                </svg>
                {p.name}
              </p>
              <ul className="grid gap-2">
                {p.bugs.map((b, bi) => {
                  const i = pi * PER + bi;
                  const on = i === at;
                  const { owner, name, n } = parts(b.upstream);
                  return (
                    <li key={b.upstream}>
                      <button
                        type="button"
                        onClick={() => pick(i)}
                        aria-pressed={on}
                        title={b.broke}
                        className={`relative flex h-16 w-full cursor-pointer items-center gap-3 rounded-2xl border border-edge bg-panel px-3.5 text-left transition-colors duration-300 ${on ? "text-[#111]" : "hover:bg-hover"}`}
                      >
                        {/* The platform's colour is a layer of its own: a gradient can't fade in as a background. */}
                        <span aria-hidden className={`tile absolute -inset-px rounded-2xl transition-opacity duration-300 ${on ? "" : "opacity-0"}`} />
                        <img src={`/avatars/${owner.toLowerCase()}.jpg`} alt="" width={40} height={40} loading="lazy" className="relative size-8 shrink-0 rounded-lg" />
                        <span className="relative line-clamp-2 min-w-0 flex-1 text-[16px] font-semibold leading-tight [overflow-wrap:anywhere]">
                          {name} <span className={`font-normal transition-colors duration-300 ${on ? "text-black/55" : "text-faint"}`}>#{n}</span>
                        </span>
                        <span className="relative flex shrink-0 items-baseline gap-1.5">
                          <span className="text-[24px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{b.days}</span>
                          <span className={`text-[14px] font-medium transition-colors duration-300 ${on ? "text-black/65" : "text-dim"}`}>days</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
