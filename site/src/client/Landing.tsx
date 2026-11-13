import { useEffect, useRef, useState } from "react";
import { Clip, Replay, Status } from "./Replay";

const REPO = "https://github.com/t1dem/proofed";
const PR = "https://github.com/t1dem/proofed-demo-store/pull/2";

const scenario = `---
name: Free shipping from €50
paths: [src/pricing.ts, src/pages/Cart.tsx]
---
Add House Espresso and Paper Filters to the bag and open the bag.
Check that shipping is €4.90 and the total is €49.40.
Press + next to Paper Filters once.
Check that shipping is now Free and the total is €51.00.`;

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

function Hero() {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-20 pt-12 sm:px-8 sm:pt-20">
      <h1 className="max-w-4xl font-serif text-[2.6rem] leading-[1.05] tracking-tight sm:text-7xl">
        Every pull request, run in Chrome before it gets merged.
      </h1>
      <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink/85 sm:text-xl">
        Proofed runs the user flows your diff touches with Kane CLI, posts the recording on the PR, and lets Claude fix what
        broke. A fix is pushed only after Kane has watched it pass.
      </p>
      <div className="mt-9 flex flex-wrap gap-3">
        <a
          href="/install"
          className="inline-flex min-h-12 items-center rounded-full bg-ink px-6 font-medium text-paper transition hover:bg-ink/85"
        >
          Install on GitHub
        </a>
        <a
          href={PR}
          className="inline-flex min-h-12 items-center rounded-full border border-ink/25 px-6 font-medium transition hover:border-ink"
        >
          See a real PR
        </a>
      </div>
      <p className="mt-5 text-[15px] text-muted">Runs in your own GitHub Actions, with your TestMu and Claude keys.</p>
      <HeroClip />
    </section>
  );
}

// Kane catching PR #2's bug, on a loop. Paused while scrolled away.
function HeroClip() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), { threshold: 0.2 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="mt-14 space-y-4">
      <Clip
        src="/clips/fail.mp4"
        poster="/clips/fail.jpg"
        active={visible}
        loop
        note={
          <>
            Kane expected shipping €4.90 and a total of €49.40.{" "}
            <span className="text-[#ff9b8f]">The bag shows Free and €44.50.</span>
          </>
        }
      />
      <Status pass={false}>
        2 of 3 broke on{" "}
        <a href={PR} className="underline underline-offset-4">
          PR #2
        </a>
        : Place an order, Free shipping from €50
      </Status>
    </div>
  );
}

function Setup() {
  return (
    <section id="setup" className="border-t border-line py-20 sm:py-28">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-8 lg:grid-cols-2 lg:gap-16">
        <div>
          <h2 className="font-serif text-4xl leading-tight sm:text-5xl">Set it up in your repo.</h2>
          <ol className="mt-10 space-y-8">
            <li>
              <h3 className="text-lg font-semibold">Install the GitHub app</h3>
              <p className="mt-1.5 leading-relaxed text-ink/85">
                Pick the repos. Proofed opens a pull request in each that adds two workflows and an example scenario.
              </p>
            </li>
            <li>
              <h3 className="text-lg font-semibold">Add three secrets</h3>
              <p className="mt-1.5 leading-relaxed text-ink/85">
                <code className="font-mono text-[0.9em]">LT_USERNAME</code> and <code className="font-mono text-[0.9em]">LT_ACCESS_KEY</code>{" "}
                from TestMu, and <code className="font-mono text-[0.9em]">CLAUDE_CODE_OAUTH_TOKEN</code> from{" "}
                <code className="font-mono text-[0.9em]">claude setup-token</code>. Kane credits and Claude usage come from your accounts.
              </p>
            </li>
            <li>
              <h3 className="text-lg font-semibold">Describe your flows in plain English</h3>
              <p className="mt-1.5 leading-relaxed text-ink/85">
                One Markdown file per flow. <code className="font-mono text-[0.9em]">paths</code> says which files it guards, so a PR
                only runs the flows it can break.
              </p>
            </li>
          </ol>
          <a
            href="/install"
            className="mt-10 inline-flex min-h-12 items-center rounded-full bg-ink px-6 font-medium text-paper transition hover:bg-ink/85"
          >
            Install on GitHub
          </a>
        </div>
        <figure className="self-start overflow-hidden rounded-xl border border-line bg-card lg:mt-24">
          <figcaption className="border-b border-line px-4 py-2.5 font-mono text-[13px] text-muted">
            .proofed/scenarios/free-shipping.md
          </figcaption>
          <pre className="overflow-x-auto whitespace-pre-wrap p-4 font-mono text-[13px] leading-6 sm:text-sm">{scenario}</pre>
        </figure>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-10 text-[15px] text-muted sm:flex-row sm:justify-between sm:px-8">
        <p>
          Built on{" "}
          <a href="https://github.com/LambdaTest/kane-cli" className="underline underline-offset-4">
            Kane CLI
          </a>{" "}
          for the Kane CLI hackathon, November 2026.
        </p>
        <a href={REPO} className="underline underline-offset-4">
          Source on GitHub
        </a>
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
