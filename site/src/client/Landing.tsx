import { AsciiVideo } from "./AsciiVideo";
import { ArrowRight, ArrowUpRight, Check, GitMerge, GitPullRequest, Play, Workflow } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { BRANDS } from "./brands";
import { DAWN } from "./dawn";
import { Bugs } from "./Bugs";
import { Mended } from "./Mended";
import { Platforms } from "./Platforms";
import { PullShowcase } from "./PullShowcase";
import { Logo } from "./ui";

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
const primary = "raised-white inline-flex h-11 shrink-0 items-center gap-2.5 rounded-lg px-5 text-[15px] font-medium";

const glass = "inline-flex h-11 shrink-0 items-center gap-2 rounded-lg border border-white/[0.12] bg-white/[0.05] px-5 text-[15px] font-medium transition-colors hover:bg-white/[0.1]";

// The sun in the dawn clip, in fractions of its frame: a narrow screen keeps it in view.
const SUN: [number, number] = [0.85, 0.56];

// The real app on its sample data, in a window wider than the page's column. On a computer it is the
// app's desktop layout and it works: laid out no narrower than DESK and scaled down when the window
// is. On a phone it is the app's phone layout at its real size, as a picture: a pane that scrolls
// inside the page would trap the thumb.
const DESK = 1100;
const PHONE = "(max-width: 767px)";

function AppWindow() {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [phone, setPhone] = useState(() => matchMedia(PHONE).matches);
  const [shown, setShown] = useState(false);
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
    <div className="overflow-hidden rounded-xl border border-white/[0.1] bg-side shadow-[0_50px_120px_-30px_rgb(0_0_0/0.9)]">
      <div ref={box} className="relative h-[540px] w-full overflow-hidden md:aspect-[16/9] md:h-auto">
        {size.w > 0 && (
          <iframe
            src="/app?demo"
            title="Proofed on sample data"
            inert={phone}
            tabIndex={phone ? -1 : undefined}
            onLoad={() => setTimeout(() => setShown(true), 250)}
            className={`absolute left-0 top-0 origin-top-left bg-bg transition-opacity duration-700 ${shown ? "opacity-100" : "opacity-0"} ${phone ? "pointer-events-none" : ""}`}
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
    <div aria-hidden className={`pointer-events-none w-full ${className}`} style={{ maskImage: mask, maskComposite: "intersect" }}>
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
        </div>
      </div>
    </section>
  );
}

// The three steps of the README's setup on one tile, and what they end in beside them: the setup pull
// request, as a sheet that comes up from the tile's corner. It is the sample storefront's, the repo
// of the pull request further up the page: the workflow and the store's own three scenarios, each
// with Kane's pass. It fills in once, when the tile is reached (.draw-* in index.css): the pull
// request is open with its workflow, the scenarios arrive one by one, and then it is merged. The
// steps' words are there from the start.
const STEPS: { title: string; body: ReactNode; href: string; go: string }[] = [
  {
    title: "Save your keys",
    body: (
      <>
        Sign in and save two TestMu keys for Kane, and a token from <code className="whitespace-nowrap font-mono text-[0.88em] text-[#111]">claude setup-token</code> or an
        OpenAI key for fixes. Runs use your own accounts.
      </>
    ),
    href: "/app",
    go: "Sign in",
  },
  {
    title: "Install the GitHub App",
    body: "Pick the repos. Proofed opens a setup pull request in each one and stores the keys as encrypted Actions secrets.",
    href: "/install",
    go: "Install on GitHub",
  },
  {
    title: "Review and merge",
    body: "The setup PR holds the workflow and up to five scenarios Claude or Codex wrote. Only the ones Kane passed are in it.",
    href: `${REPO}/blob/main/docs/setup.md`,
    go: "Setup docs",
  },
];

// The scenarios in it: the one every setup starts with (home.md) and the demo store's own three
// (.proofed/scenarios in t1dem/proofed-demo-store), by their names.
const SCENARIOS = ["Home page loads", "Place an order", "Free shipping from €50", "Promo code total"];
// When a scenario arrives and when the pull request is merged, in ms from when the tile is reached.
const ARRIVE = (i: number) => 450 + i * 420;
const MERGE = ARRIVE(SCENARIOS.length) + 500;

function Setup() {
  // The sheet is what is watched for: on a phone it is under the steps, a screen below the tile's top.
  const sheet = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState(false);
  const [merged, setMerged] = useState(false);
  useEffect(() => {
    const el = sheet.current;
    if (!el) return;
    let later = 0;
    const seen = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting) return;
        seen.disconnect();
        setDrawn(true);
        if (matchMedia("(prefers-reduced-motion: reduce)").matches) setMerged(true);
        else later = window.setTimeout(() => setMerged(true), MERGE);
      },
      { threshold: 0.5 },
    );
    seen.observe(el);
    return () => (seen.disconnect(), clearTimeout(later));
  }, []);
  const row = "flex items-center gap-3.5 border-t border-white/[0.07] py-4 text-[17px] sm:gap-4 sm:py-5 sm:text-[19px]";
  return (
    <section id="setup" className="py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-8">
        <h2 className={h2}>
          Set it up in your repo. <span className="text-faint">Three steps.</span>
        </h2>
        <div data-drawn={drawn || undefined} style={{ "--fill": DAWN.sand } as CSSProperties} className="tile mt-12 grid overflow-hidden rounded-3xl lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <ol className="p-6 sm:p-10 xl:p-12">
            {STEPS.map((step, i) => (
              <li key={step.title} className="grid grid-cols-[2rem_minmax(0,1fr)] border-black/10 py-7 first:pt-0 last:pb-0 sm:grid-cols-[2.5rem_minmax(0,1fr)] [&:not(:first-child)]:border-t">
                <span className="text-[24px] font-semibold leading-tight tabular-nums text-black/40 xl:text-[26px]">{i + 1}</span>
                <div className="flex flex-col">
                  <p className="text-[24px] font-semibold leading-tight tracking-[-0.025em] xl:text-[26px]">{step.title}</p>
                  <p className="mt-2.5 text-pretty text-[16px] leading-relaxed text-black/65">{step.body}</p>
                  <a href={step.href} className="mt-4 inline-flex items-center gap-1.5 self-start text-[16px] font-semibold underline decoration-transparent underline-offset-4 transition-colors hover:decoration-black sm:text-[15px]">
                    {step.go} <ArrowUpRight aria-hidden size={16} strokeWidth={2.25} />
                  </a>
                </div>
              </li>
            ))}
          </ol>

          <div ref={sheet} aria-hidden className="flex px-3 sm:px-6 lg:pl-0 lg:pr-0 lg:pt-12">
            <div className="flex-1 rounded-t-3xl bg-[#0b0b0d] px-6 pb-6 pt-7 text-fg shadow-[0_-20px_60px_-20px_rgb(0_0_0/0.45)] sm:px-10 sm:pb-8 sm:pt-10 lg:rounded-tr-none">
              <p className="flex items-center gap-3 text-[16px] font-medium text-dim">
                <span className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[14px] font-semibold text-white transition-colors duration-500 ${merged ? "bg-[#8250df]" : "bg-[#238636]"}`}>
                  {merged ? <GitMerge size={15} strokeWidth={2.25} /> : <GitPullRequest size={15} strokeWidth={2.25} />}
                  {merged ? "Merged" : "Open"}
                </span>
                storefront #1
              </p>
              <p className="mt-6 text-[34px] font-semibold leading-none tracking-[-0.035em] sm:text-[44px]">Add Proofed</p>
              <p className="mt-5 flex items-center gap-2.5 text-[16px] text-dim">
                <img src="/favicon.svg" alt="" className="size-[22px] rounded-md" />
                proofed-by-kane
              </p>

              <ul className="mt-8">
                <li className={row}>
                  <Workflow size={24} strokeWidth={2} className="shrink-0 text-dim" />
                  <span className="min-w-0 truncate font-mono text-[0.88em]">
                    <span className="text-faint max-sm:hidden">.github/workflows/</span>proofed.yml
                  </span>
                </li>
                {SCENARIOS.map((name, i) => (
                  <li key={name} style={{ "--t": `${ARRIVE(i)}ms` } as CSSProperties} className={`draw-rise ${row}`}>
                    <span style={{ "--t": `${ARRIVE(i) + 180}ms` } as CSSProperties} className="draw-pop grid size-6 shrink-0 place-items-center rounded-full bg-ok text-[#0b0b0d]">
                      <Check size={15} strokeWidth={3.5} />
                    </span>
                    <span className="min-w-0 flex-1 font-medium">{name}</span>
                    <span className="shrink-0 text-[16px] text-dim">Kane passed</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
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

// The page's last word, on the page itself and as wide as its column: the heading, and under it the
// two ways in. Nothing is drawn around it; what happens is in the heading, whose last word gets a
// bug and Kane's fix once, when it is reached (Mended). On a phone the heading takes two lines. The
// footer follows: the name and the links, then the small print. Kane's cursor flies in from past
// the heading's end, which may be off the screen, so the section clips what sticks out of it.
function Start() {
  return (
    <section className="overflow-x-clip pb-8 pt-6 sm:pb-10 sm:pt-12">
      <div className="mx-auto max-w-6xl px-4 text-center sm:px-8">
        <h2 aria-label="Merge with proof." className="text-[3.6rem] font-semibold leading-[0.98] tracking-[-0.05em] max-[359px]:text-[3.1rem] sm:whitespace-nowrap sm:text-[min(calc((100vw-4rem)*0.127),8.6rem)]">
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
        <p className="mx-auto mt-6 max-w-md text-[16px] leading-relaxed text-white/75">
          Break it yourself opens a real pull request in the demo store. It takes 8 to 14 minutes and needs no account.
        </p>

        <footer className="mt-24 px-2 text-left sm:mt-36 sm:px-3">
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
          <p className="mt-3 text-[16px] text-dim sm:text-[14px]">MIT licensed. Built for the KaneCLI Hackathon, November 2026.</p>
        </footer>
      </div>
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
