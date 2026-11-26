import { AsciiVideo } from "./AsciiVideo";
import { ArrowRight, ArrowUpRight, Check, GitMerge, GitPullRequest, Play } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { BRANDS } from "./brands";
import { DAWN } from "./dawn";
import { Bugs } from "./Bugs";
import { Mended } from "./Mended";
import { Night } from "./Night";
import { Platforms } from "./Platforms";
import { PullShowcase } from "./PullShowcase";
import { ClaudeMark, TestMuMark } from "./SettingsMarks";
import { Logo, RepoChip } from "./ui";

const REPO = "https://github.com/t1dem/proofed";

const h2 = "max-w-4xl text-[2.2rem] sm:text-balance font-semibold leading-[1.08] tracking-[-0.03em] sm:text-5xl";

function Header() {
  const link = "hidden text-white/60 transition-colors hover:text-white sm:inline";
  return (
    <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-8">
      <a href="/" aria-label="Proofed">
        <Logo size={22} className="text-[17px]" />
      </a>
      <nav className="flex items-center gap-7 text-[14px]">
        <a href="#how" className={link}>
          How it works
        </a>
        <a href="#bugs" className={link}>
          Bugs caught
        </a>
        <a href={REPO} className={link}>
          GitHub
        </a>
        <a href="/app" className="inline-flex h-8 items-center rounded-lg bg-white/[0.08] px-3.5 font-medium text-white transition-colors hover:bg-white/[0.14]">
          Sign in
        </a>
      </nav>
    </header>
  );
}

// The one call to action is white on the night (.raised-white in index.css), with an outline beside it.
const primary = "raised-white inline-flex h-11 shrink-0 select-text items-center gap-2.5 rounded-lg px-5 text-[15px] font-medium";

const glass = "inline-flex h-11 shrink-0 select-text items-center gap-2 rounded-lg border border-white/[0.12] bg-white/[0.05] px-5 text-[15px] font-medium transition-colors hover:bg-white/[0.1]";

// The sun in the dawn clip, in fractions of its frame: a narrow screen keeps it in view.
const SUN: [number, number] = [0.85, 0.56];

// The real app on its sample data, in a window wider than the page's column. On a computer it is the
// app's desktop layout and it works: laid out no narrower than DESK and scaled down when the window
// is. On a phone it is the app's phone layout at its real size, and it works too: its tabs and rows
// answer a tap and it scrolls under a thumb, the page taking over where a screen of it ends. The
// line under it opens the app full screen.
const DESK = 1100;
const PHONE = "(max-width: 767px)";

function AppWindow() {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [phone, setPhone] = useState(() => matchMedia(PHONE).matches);
  const [shown, setShown] = useState(false);
  // The demo app inside outweighs the page around it; its scripts load once the landing
  // has settled, while the frame is still fading in exactly as before.
  const [load, setLoad] = useState(false);
  useEffect(() => {
    const go = () => setLoad(true);
    if (window.requestIdleCallback) {
      const id = window.requestIdleCallback(go, { timeout: 1500 });
      return () => window.cancelIdleCallback(id);
    }
    const t = setTimeout(go, 400);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = new ResizeObserver(([e]) => e && setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    fit.observe(el);
    const media = matchMedia(PHONE);
    const narrow = () => setPhone(media.matches);
    media.addEventListener("change", narrow);
    return () => {
      fit.disconnect();
      media.removeEventListener("change", narrow);
    };
  }, []);
  const scale = phone ? 1 : Math.min(size.w / DESK, 1);
  return (
    <div className="relative overflow-hidden rounded-xl border border-white/[0.1] bg-side shadow-[0_50px_120px_-30px_rgb(0_0_0/0.9)]">
      <div ref={box} className="relative h-[540px] w-full overflow-hidden md:aspect-[16/9] md:h-auto">
        {size.w > 0 && (
          <iframe
            src={load ? "/app?demo" : undefined}
            title="Proofed on sample data"
            onLoad={() => load && setTimeout(() => setShown(true), 250)}
            className={`absolute left-0 top-0 origin-top-left select-none bg-bg transition-opacity duration-700 ${shown ? "opacity-100" : "opacity-0"}`}
            style={{ width: size.w / scale, height: size.h / scale, transform: `scale(${scale})` }}
          />
        )}
      </div>
    </div>
  );
}

// The dawn over a lake, drawn in type. It has no edge of its own: `mask` dissolves it into the page.
function Dawn({ className, mask }: { className: string; mask: string }) {
  return (
    <div aria-hidden className={`select-none w-full ${className}`} style={{ maskImage: mask, maskComposite: "intersect" }}>
      <AsciiVideo src="/clips/hero-dawn.mp4" focus={SUN} quiet className="absolute inset-0 h-full w-full" />
    </div>
  );
}

// The first screen: what Proofed does, then the picture and the app as one thing. The app's window
// stands in front of the dawn, its top edge --at of the way down the picture (--h tall): the sun and
// the ridges stand on the window, the lake runs down beside it, and the picture fades out upwards,
// downwards and to both sides, with no frame around it.
function Hero() {
  return (
    <section>
      <Header />
      <div className="mx-auto w-full max-w-5xl px-4 pt-10 text-center sm:px-8">
        <h1 className="mx-auto max-w-[16em] text-balance text-[2.5rem] font-semibold leading-[1.04] tracking-[-0.04em] max-[359px]:text-[2.15rem] sm:text-6xl lg:text-[4.25rem]">
          Every pull request, clicked through before you merge.
        </h1>
        <p className="mx-auto mt-6 max-w-[590px] text-balance text-[17px] leading-relaxed text-dim sm:text-[18px]">
          Kane CLI tests each pull request in a real browser. Claude or Codex fixes what breaks, and Kane checks the fix before it lands.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <a href="/install" className={primary}>
            <svg viewBox="0 0 24 24" aria-hidden className="size-[18px] fill-current">
              <path d={BRANDS.github} />
            </svg>
            Install on GitHub
          </a>
          <a href="/try/9" className={glass}>
            <Play size={14} fill="currentColor" />
            {/* A phone has room for the two buttons side by side only without the length. */}
            <span>
              Watch a <span className="max-[430px]:hidden">1-minute </span>run
            </span>
          </a>
        </div>
        <p className="mt-5 text-[16px] text-faint sm:text-[14px]">
          Built for the KaneCLI Hackathon.{" "}
          <a href={`${REPO}#for-judges`} className="whitespace-nowrap text-dim underline decoration-faint underline-offset-4 hover:text-fg">
            For judges →
          </a>
        </p>
      </div>
      <div className="relative mx-auto mt-[calc(var(--h)*var(--at)+1rem)] w-full max-w-[1680px] [--at:0.6] [--h:max(220px,min(30vw,504px))] md:[--at:0.45]">
        <Dawn
          className="absolute inset-x-0 top-[calc(var(--h)*var(--at)*-1)] h-(--h)"
          mask="linear-gradient(to right, transparent, #000 26%, #000 84%, transparent), linear-gradient(to bottom, transparent, #000 30%, #000 62%, transparent 92%)"
        />
        <div className="relative mx-auto max-w-[1440px] px-3 sm:px-6">
          <AppWindow />
          <p className="mt-4 text-center text-[16px] md:hidden">
            <a href="/app?demo" className="inline-flex items-center gap-1.5 py-2 font-medium text-dim underline decoration-white/25 underline-offset-4">
              Open it full screen <ArrowRight aria-hidden size={16} />
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}

// The three steps of the README's setup on one tile, each with what it looks like once it is done:
// the keys saved in Proofed, the repos picked for the GitHub App, the setup pull request merged. Each
// is a dark sheet in the sample account's names, standing on the tile's bottom edge under its step.
// The steps' words are there from the start; a sheet's ticks, picks and scenarios arrive once, when
// it is well in view (.draw-* in index.css). On a wide screen the three stand side by side and fill
// in one after another, each its --lag after the first. Narrower, the steps are a band to swipe,
// the next one showing at the edge, and each sheet is a card that fills in as it is reached.
const LAG = ["", "lg:[--lag:1100ms]", "lg:[--lag:2200ms]"];
const BEAT = 300; // between one row of a sheet and the next, ms
const at = (ms: number) => ({ "--t": `calc(var(--lag, 0ms) + ${ms}ms)` }) as CSSProperties;

function useDrawn() {
  const ref = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const seen = new IntersectionObserver(([e]) => e?.isIntersecting && (seen.disconnect(), setDrawn(true)), { threshold: 0.6 });
    seen.observe(el);
    return () => seen.disconnect();
  }, []);
  return [ref, drawn] as const;
}

const line = "flex h-12 items-center gap-3 border-t border-white/[0.07] text-[15px] max-sm:h-11";
const tick = "draw-pop grid size-5 shrink-0 place-items-center rounded-full bg-ok text-[#0b0b0d]";

function Sheet({ ref, drawn, lag, head, children }: { ref: RefObject<HTMLDivElement | null>; drawn: boolean; lag: number; head: ReactNode; children: ReactNode }) {
  return (
    <div
      ref={ref}
      aria-hidden
      data-drawn={drawn || undefined}
      className={`mt-auto rounded-2xl bg-[#0b0b0d] px-5 pb-1.5 pt-2 text-fg shadow-[0_-18px_50px_-22px_rgb(0_0_0/0.5)] lg:rounded-b-none lg:pb-5 xl:px-6 ${LAG[lag]}`}
    >
      <div className="flex h-12 items-center gap-2.5 whitespace-nowrap text-[15px] font-semibold">{head}</div>
      <ul>{children}</ul>
    </div>
  );
}

// Proofed's own keys page: the two TestMu keys and the fixer's token, each saved.
const testmu = (
  <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[#1c1c1c] text-white ring-1 ring-inset ring-white/10">
    <TestMuMark size={12} />
  </span>
);
const claude = (
  <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[#D97757]">
    <ClaudeMark size={17} color="#fff" />
  </span>
);
const KEYS: [string, ReactNode][] = [
  ["TestMu username", testmu],
  ["TestMu access key", testmu],
  ["Claude token", claude],
];

function KeysSheet() {
  const [ref, drawn] = useDrawn();
  return (
    <Sheet
      ref={ref}
      drawn={drawn}
      lag={0}
      head={
        <>
          <img src="/favicon.svg" alt="" className="size-5 rounded-[5px]" />
          Your keys
        </>
      }
    >
      {KEYS.map(([name, mark], i) => (
        <li key={name} className={line}>
          {mark}
          <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
          <span style={at(300 + i * BEAT)} className={tick}>
            <Check size={13} strokeWidth={3.5} />
          </span>
        </li>
      ))}
    </Sheet>
  );
}

// GitHub's install page for the app: which of the account's repos it is installed on.
const REPOS: [string, boolean][] = [
  ["northbean/storefront", true],
  ["northbean/website", true],
  ["northbean/docs-site", false],
];

function InstallSheet() {
  const [ref, drawn] = useDrawn();
  return (
    <Sheet
      ref={ref}
      drawn={drawn}
      lag={1}
      head={
        <>
          <svg viewBox="0 0 24 24" className="size-5 fill-current">
            <path d={BRANDS.github} />
          </svg>
          <span className="flex-1">Install Proofed</span>
          <span className="inline-flex h-7 items-center rounded-md bg-[#238636] px-3 text-[13px] text-white">Install</span>
        </>
      }
    >
      {REPOS.map(([repo, picked], i) => (
        <li key={repo} className={line}>
          <span className="relative size-[18px] shrink-0 rounded-[5px] border border-white/25">
            {picked && (
              <span style={at(300 + i * BEAT)} className="draw-pop absolute -inset-px grid place-items-center rounded-[5px] bg-fg text-[#0b0b0d]">
                <Check size={13} strokeWidth={3.5} />
              </span>
            )}
          </span>
          <RepoChip repo={repo} size={22} round="rounded-md" />
          <span className={`min-w-0 flex-1 truncate font-medium ${picked ? "" : "text-dim"}`}>{repo.split("/")[1]}</span>
        </li>
      ))}
    </Sheet>
  );
}

// The setup pull request in the sample storefront, the repo of the pull request further up the
// page: the store's own three scenarios (.proofed/scenarios in t1dem/proofed-demo-store) arrive one
// by one, each with Kane's pass, and then it is merged.
const SCENARIOS = ["Place an order", "Free shipping from €50", "Promo code total"];

function PullSheet() {
  const [ref, drawn] = useDrawn();
  const [merged, setMerged] = useState(false);
  useEffect(() => {
    if (!drawn || !ref.current) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return setMerged(true);
    const lag = parseFloat(getComputedStyle(ref.current).getPropertyValue("--lag")) || 0;
    const later = setTimeout(() => setMerged(true), lag + 300 + SCENARIOS.length * BEAT + 500);
    return () => clearTimeout(later);
  }, [drawn, ref]);
  return (
    <Sheet
      ref={ref}
      drawn={drawn}
      lag={2}
      head={
        <>
          <span className={`inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[13px] text-white transition-colors duration-500 ${merged ? "bg-[#8250df]" : "bg-[#238636]"}`}>
            {merged ? <GitMerge size={14} strokeWidth={2.25} /> : <GitPullRequest size={14} strokeWidth={2.25} />}
            {merged ? "Merged" : "Open"}
          </span>
          Add Proofed <span className="font-normal text-faint max-[359px]:hidden">#1</span>
        </>
      }
    >
      {SCENARIOS.map((name, i) => (
        <li key={name} style={at(300 + i * BEAT)} className={`draw-rise ${line}`}>
          <span style={at(450 + i * BEAT)} className={tick}>
            <Check size={13} strokeWidth={3.5} />
          </span>
          <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
        </li>
      ))}
    </Sheet>
  );
}

const STEPS: { title: string; body: string; href: string; go: string; sheet: ReactNode }[] = [
  {
    title: "Save your keys",
    body: "Two TestMu keys for Kane, a Claude or OpenAI one for fixes.",
    href: "/app",
    go: "Sign in",
    sheet: <KeysSheet />,
  },
  {
    title: "Install the GitHub App",
    body: "Pick the repos. Proofed opens a setup pull request in each.",
    href: "/install",
    go: "Install on GitHub",
    sheet: <InstallSheet />,
  },
  {
    title: "Review and merge",
    body: "The setup pull request holds only the scenarios Kane passed.",
    href: `${REPO}/blob/main/docs/setup.md`,
    go: "Setup docs",
    sheet: <PullSheet />,
  },
];

function Setup() {
  return (
    <section id="setup" className="py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-8">
        <h2 className={h2}>
          Set it up in your repo.
        </h2>
        <ol
          style={{ "--fill": DAWN.sand } as CSSProperties}
          className="tile mt-12 flex snap-x snap-mandatory scroll-px-5 gap-5 overflow-hidden rounded-3xl p-5 [scrollbar-width:none] max-lg:overflow-x-auto sm:scroll-px-10 sm:gap-8 sm:p-10 lg:grid lg:grid-cols-3 lg:pb-0 xl:px-12 xl:pt-12 [&::-webkit-scrollbar]:hidden"
        >
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex w-[86%] shrink-0 snap-start flex-col gap-7 sm:w-[46%] lg:w-auto">
              <div className="grid grid-cols-[2rem_minmax(0,1fr)] sm:grid-cols-[2.5rem_minmax(0,1fr)]">
                <span className="text-[24px] font-semibold leading-tight tabular-nums text-black/40 max-[359px]:text-[21px] lg:max-xl:text-[21px]">{i + 1}</span>
                <div className="flex flex-col">
                  <p className="text-[24px] font-semibold leading-tight tracking-[-0.025em] max-[359px]:text-[21px] lg:max-xl:text-[21px]">{step.title}</p>
                  <p className="mt-2.5 text-pretty text-[16px] leading-relaxed text-black/65">{step.body}</p>
                  <a href={step.href} className="mt-4 inline-flex items-center gap-1.5 self-start text-[16px] font-semibold underline decoration-transparent underline-offset-4 transition-colors hover:decoration-black sm:text-[15px]">
                    {step.go} <ArrowUpRight aria-hidden size={16} strokeWidth={2.25} />
                  </a>
                </div>
              </div>
              {step.sheet}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// The four places a visitor may still want, in the page's last lines.
const LINKS: [string, string][] = [
  ["GitHub", REPO],
  ["npm", "https://www.npmjs.com/package/proofed-cli"],
  ["Docs", `${REPO}/tree/main/docs`],
  ["Sign in", "/app"],
];

// The page's last word, as one scene: the heading and under it the two ways in, on a night sky
// (Night) that runs from the section's top down to the hero's lake. Nothing is drawn around the
// words; what happens is in the heading, whose last word gets a bug and Kane's fix once, when it is
// reached (Mended). On a phone the heading takes two lines. Kane's cursor flies in from past the
// heading's end, which may be off the screen, so the section clips what sticks out of it.
//
// The padding under the words is the room Night's picture takes: the height it lays its still out
// at (Night's LOW of 16:9 of the width, within its FRAME) times the share of the still between
// where its sky goes black and its FLOOR, and the air between the last line and the first cloud.
// The lake goes out into the page's ground, and the footer is the line after it: the name and the
// links, then the small print.
function Start() {
  const words = useRef<HTMLDivElement>(null);
  return (
    <section className="overflow-x-clip pb-8 sm:pb-10">
      <div className="relative mx-auto max-w-[1680px]">
        <Night
          avoid={words}
          className="absolute inset-0"
          style={{ maskImage: "linear-gradient(to right, transparent, #000 8%, #000 92%, transparent), linear-gradient(to bottom, #000 calc(100% - 3rem), transparent)", maskComposite: "intersect" }}
        />
        <div ref={words} className="relative mx-auto max-w-6xl select-none px-4 pb-[calc(clamp(390px,34.88vw,586px)*0.69+1.5rem)] pt-6 text-center sm:px-8 sm:pt-12">
          <h2 aria-label="Merge with proof." className="select-text text-[3.6rem] font-semibold leading-[0.98] tracking-[-0.05em] max-[359px]:text-[3.1rem] sm:whitespace-nowrap sm:text-[min(calc((100vw-4rem)*0.127),8.6rem)]">
            <span aria-hidden>
              Merge with <br className="sm:hidden" />
              <Mended word="proof" tail="." />
            </span>
          </h2>
          <div className="mt-10 flex flex-wrap justify-center gap-3 sm:mt-12">
            <a href="/install" className={primary}>
              <svg viewBox="0 0 24 24" aria-hidden className="size-[18px] fill-current">
                <path d={BRANDS.github} />
              </svg>
              Install on GitHub
            </a>
            <a href="/try" className={glass}>
              Break it yourself <ArrowRight size={16} />
            </a>
          </div>
          <p className="mx-auto mt-6 max-w-md select-text text-balance text-[16px] leading-relaxed text-white/75">
            A real pull request in the demo store. 8 to 14 minutes, no account.
          </p>
        </div>
      </div>

      <footer className="mx-auto max-w-6xl px-6 sm:px-11">
        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
          <a href="/" aria-label="Proofed">
            <Logo size={22} className="text-[17px]" />
          </a>
          <nav aria-label="Footer" className="-mx-3 flex flex-wrap text-[16px] sm:text-[15px]">
            {LINKS.map(([label, href]) => (
              <a key={label} href={href} className="px-3 py-2 text-dim transition-colors hover:text-fg">
                {label}
              </a>
            ))}
          </nav>
        </div>
        <p className="mt-3 text-[16px] text-dim sm:text-[14px]">MIT licensed.</p>
      </footer>
    </section>
  );
}

export function Landing() {
  return (
    <div className="night min-h-dvh">
      <main>
        <Hero />
        <PullShowcase />
        <Bugs />
        <Setup />
        <Platforms />
        <Start />
      </main>
    </div>
  );
}
