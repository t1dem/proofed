import { useCallback, useState } from "react";
import { AsciiVideo } from "./AsciiVideo";
import { CliInstall } from "./CliInstall";
import { Replay } from "./Replay";
import {
  ALL_DONE_AT,
  ALL_LOOP,
  ALL_RESET,
  ALL_REST,
  drawAll,
  drawInstall,
  drawScenario,
  drawSecrets,
  GlyphScene,
  INSTALL_LOOP,
  SCENARIO_LOOP,
  SECRETS_LOOP,
  drawWordmark,
  WORDMARK_LOOP,
} from "./SetupScenes";

const REPO = "https://github.com/t1dem/proofed";
const DEMO_PR = "https://github.com/t1dem/proofed-demo-store/pull/12#issuecomment-6900830885";

function Header() {
  return (
    <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-8">
      <a href="/" className="font-serif text-2xl">
        Proofed
      </a>
      <nav className="flex items-center gap-6 text-[15px]">
        <a href="#replay" className="hidden hover:underline sm:inline">
          How it works
        </a>
        <a href="#setup" className="hidden hover:underline sm:inline">
          Set up
        </a>
        <a href={REPO} className="hidden hover:underline sm:inline">
          GitHub
        </a>
        <a href="/app" className="font-medium hover:underline">
          Sign in
        </a>
      </nav>
    </header>
  );
}

// Mountains and a lake at dawn, generated in Google Flow for this hero (original in site/media-src/).
// The pale sky drops out to paper; the sun, low over the right-hand ridge, is at (0.84, 0.43) of the frame.
const SUN: [number, number] = [0.84, 0.43];

function Hero() {
  return (
    <section className="relative overflow-hidden lg:min-h-[calc(100svh-72px)]">
      <div className="relative z-10 mx-auto max-w-6xl px-4 pt-12 sm:px-8 sm:pt-20 lg:pt-[12vh]">
        <h1 className="max-w-4xl font-serif text-[2.6rem] leading-[1.05] tracking-tight sm:text-7xl">
          Every pull request, run in Chrome before you merge it.
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink/85 sm:text-xl">
          Proofed runs the user flows your diff touches in a real Chrome, posts the recording on the PR, and lets Claude or Codex fix what
          broke. A fix is pushed only after Proofed has watched it pass.
        </p>
        <div className="mt-9 flex flex-wrap gap-3">
          <a
            href="/try"
            className="inline-flex min-h-12 items-center rounded-full bg-ink px-6 font-medium text-paper transition hover:bg-ink/85"
          >
            Break it yourself
          </a>
          <a
            href="/install"
            className="inline-flex min-h-12 items-center rounded-full border border-ink/25 bg-paper px-6 font-medium transition hover:border-ink"
          >
            Install on GitHub
          </a>
          <CliInstall />
        </div>
      </div>
      {/* The picture sits low on the right and dissolves into the paper at its edges (see .hero-art). */}
      <div className="hero-art relative mt-2 h-[340px] lg:absolute lg:bottom-0 lg:right-0 lg:mt-0 lg:h-[92%] lg:w-[74%]">
        <AsciiVideo src="/clips/hero-dawn.mp4" focus={SUN} className="absolute inset-0 h-full w-full" />
      </div>
    </section>
  );
}

const SETUP = [
  {
    title: "Install the GitHub app",
    body: "Pick the repos. Proofed opens a pull request in each that adds the workflow and generates scenarios for your app.",
    scene: <GlyphScene draw={drawInstall} loop={INSTALL_LOOP} rest={4.5} label="A plug pushed into a socket, which lights up green" />,
  },
  {
    title: "Add three secrets",
    body: (
      <>
        Proofed drives Chrome with Kane CLI: two keys come from TestMu, one from{" "}
        <code className="font-mono text-[0.9em]">claude setup-token</code>. You can also save an OpenAI API key for Codex. Runs and fixes use your own accounts.
      </>
    ),
    scene: <GlyphScene draw={drawSecrets} loop={SECRETS_LOOP} rest={5} label="Three keys in a padlock, locked and green" />,
  },
  {
    title: "Review the generated scenarios",
    body: (
      <>
        Your selected provider writes up to five scenarios. Kane checks each in Chrome, and only the ones that pass are committed to the setup PR. Review them before merging.
      </>
    ),
    scene: <GlyphScene draw={drawScenario} loop={SCENARIO_LOOP} rest={6} label="A page of four sentences, each ticked, with a green stamp" />,
  },
];

function Setup() {
  // How many steps the wide picture has finished; each finished step's label turns green.
  const [done, setDone] = useState(0);
  const onFrame = useCallback((t: number) => setDone(t >= ALL_RESET ? 0 : ALL_DONE_AT.filter((d) => t >= d).length), []);

  return (
    <section id="setup" className="py-20 sm:py-28">
      {/* The heading keeps the page's column; the picture below is wider than it. */}
      <div className="mx-auto max-w-6xl px-4 sm:px-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <h2 className="max-w-2xl font-serif text-4xl leading-tight sm:text-6xl">Set it up in your repo.</h2>
          <div className="flex shrink-0 flex-wrap gap-3">
            <a
              href="/install"
              className="inline-flex min-h-12 items-center rounded-full bg-ink px-6 font-medium text-paper transition hover:bg-ink/85"
            >
              Install on GitHub
            </a>
            <CliInstall />
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-4 sm:px-8">
        {/* On a wide screen the three steps are one picture, done in order by one cursor; on a phone each
            step keeps its own. */}
        <div className="mt-12 md:overflow-hidden md:rounded-[2rem] md:border md:border-ink/10 md:bg-card lg:mt-16">
          <div className="hidden h-[23rem] bg-paper md:block">
            <GlyphScene
              draw={drawAll}
              loop={ALL_LOOP}
              rest={ALL_REST}
              width={360}
              onFrame={onFrame}
              label="A plug pushed into a socket, three keys locked in a padlock, and a page of ticked sentences with a green stamp"
            />
          </div>
          <ol className="grid gap-5 md:grid-cols-3 md:gap-10 md:px-10 md:pb-10 md:pt-8">
            {SETUP.map((step, i) => (
              <li key={step.title} className="overflow-hidden rounded-3xl border border-ink/10 bg-card md:overflow-visible md:rounded-none md:border-0 md:bg-transparent">
                <div className="h-64 bg-paper md:hidden">{step.scene}</div>
                <div className="px-6 pb-7 pt-6 md:p-0">
                  <p className={`font-serif text-[15px] transition-colors duration-500 ${done > i ? "text-pass" : "text-muted"}`}>Step {i + 1}</p>
                  <h3 className="mt-1 font-serif text-[1.7rem] leading-tight">{step.title}</h3>
                  <p className="mt-2.5 text-[15.5px] leading-relaxed text-ink/80">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

const FOOTER_LINKS = [
  {
    title: "Proofed",
    links: [
      ["How it works", "#replay"],
      ["Set up", "#setup"],
      ["Break it yourself", "/try"],
      ["Install on GitHub", "/install"],
      ["Sign in", "/app"],
    ],
  },
  {
    title: "Source",
    links: [
      ["Proofed on GitHub", REPO],
      ["proofed-cli on npm", "https://www.npmjs.com/package/proofed-cli"],
      ["The demo store's PR #12", DEMO_PR],
      ["Kane CLI", "https://github.com/LambdaTest/kane-cli"],
    ],
  },
];

function Footer() {
  return (
    <footer className="mx-auto max-w-7xl px-4 pb-6 pt-8 sm:px-8 sm:pb-8 sm:pt-12">
      <div className="relative overflow-hidden rounded-[2rem] bg-card">
        <div className="relative z-10 px-6 pt-10 sm:px-10 sm:pt-12">
          <div className="grid gap-10 md:grid-cols-[1.6fr_1fr_1fr]">
            <div>
              <a href="/" className="font-serif text-4xl">
                Proofed
              </a>
              <p className="mt-3 max-w-xs leading-relaxed text-ink/80">Every pull request, run in Chrome before you merge it.</p>
            </div>
            {FOOTER_LINKS.map((col) => (
              <nav key={col.title} aria-label={col.title}>
                <p className="text-[15px] text-muted">{col.title}</p>
                <ul className="mt-3 space-y-2.5">
                  {col.links.map(([label, href]) => (
                    <li key={label}>
                      <a href={href} className="hover:underline hover:underline-offset-4">
                        {label}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
          <p className="mt-12 text-[14px] text-muted">Runs on Kane CLI, Claude Code and OpenAI Codex.</p>
        </div>
        {/* The name, big and printed in type, bleeding off the bottom of the card. */}
        <div aria-hidden className="relative -mb-[3%] h-[clamp(110px,24vw,330px)]">
          <GlyphScene draw={drawWordmark} loop={WORDMARK_LOOP} rest={6} width={360} label="" />
        </div>
      </div>
    </footer>
  );
}

export function Landing() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <Replay />
        <Setup />
      </main>
      <Footer />
    </>
  );
}
